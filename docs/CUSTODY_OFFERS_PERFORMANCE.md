# Custody offers loading performance

## Measured

Signed in as the Distributor test company, 7 custody offers, local API, 2026-11-28:

| Request                                                        | Before       | After step 1                                        |
| -------------------------------------------------------------- | ------------ | --------------------------------------------------- |
| `GET /api/orders/custody-offers`                               | 6.5 s, 3.3 s | not measured yet: the API restart ended the session |
| `GET /api/orders` (full orders state, also loaded by the page) | 3.2 s        | unchanged                                           |

The page waits for both requests, so it shows nothing until the slower one finishes.

## Why it was slow

`listCustodyOffers` (`apps/api/src/modules/orders/orders.service.ts`) builds every offer from
the database, encrypted records and the chain, and it did so almost entirely in sequence:

- `CustodyOffers.list()` looked up the offers one after another.
- Each lookup (`lookup()`) ran its integrity reads in sequence:
  - batch registration;
  - the batch itself;
  - both location owners;
  - the shipment, if one exists.
- Each offer view (`offerView()`) then ran about ten more steps in sequence:
  - the batch summary, which reads the batch again and decrypts its metadata;
  - the company directory;
  - location events;
  - two location names and two location addresses, each a database read and a decryption.

## Done (step 1)

- **Offers in parallel.** Offers are looked up in parallel. Chain reads are batched by the
  multicall layer.
- **Reads in parallel within each lookup.** The batch and both location-owner reads run
  together. The registration check still runs first, so a stale offer from a reset chain is
  dropped before a read that would fail (a test covers this).
- **Offer view in parallel.** The batch summary, directory and location events run together,
  followed by the four location lookups together.

Every integrity check is unchanged. The response shape and stored formats are unchanged, and
there is no contract change. API tests: 256 pass.

## Remaining options, not implemented

| #   | Option                                                                                                                                 | Effort       | Notes                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | **Skip the full orders state on the Distributor's offer pages** (`CustodyOffersWorkspace` with `receiver`)                             | Small–medium | The Distributor uses it only for `actor` and location labels, which the offers already carry. The sender needs it only for the "New custody offer" form, not on an offer detail page. Removes a 3.2 s request from those views. |
| 3   | **Refresh one offer after an action** (`getCustodyOffer`) instead of the whole list plus the orders state                              | Small        | Accept, reject and update currently reload everything.                                                                                                                                                                          |
| 4   | **Don't read the batch twice.** `lookup()` already reads it; pass it to `offerView` instead of reading it again in `offerBatchSummary` | Small        | Saves one chain read and the metadata decryption per offer.                                                                                                                                                                     |
| 5   | **Per-request memo for locations and batch summaries**                                                                                 | Medium       | Offers share the same sites and batches. Each one currently repeats the same database reads and decryptions. Memoise them within a single request only, never across users or requests.                                         |
| 6   | **Query only the viewer's offers** instead of `listPrivate('transfers')` across all companies                                          | Medium       | Needs a repository query by participant wallet. Cost grows with total platform usage.                                                                                                                                           |
| 7   | **Paginate** the offer list on the server                                                                                              | Medium       | Only worthwhile together with 6.                                                                                                                                                                                                |

Recommended next: **2**, then **3**. Measure again after each.
