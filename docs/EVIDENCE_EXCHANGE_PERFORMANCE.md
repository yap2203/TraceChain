# Evidence Exchange loading performance

## Measured

`GET /api/orders/information-requests`, signed in as the Supplier test company, 5 requests
(4 shared custody-offer requests and 1 shared delivery request), local API, 2026-11-27:

|                 | Run 1                                               | Run 2  | Run 3  |
| --------------- | --------------------------------------------------- | ------ | ------ |
| Before          | 25.3 s                                              | 40.9 s | 17.1 s |
| After fixes 1–3 | not measured yet: the API restart ended the session |        |        |

## Why it was slow

`informationRequests()` (`apps/api/src/modules/orders/orders.service.ts`) rebuilt every row
from the chain and IPFS, one row after another:

- `listSharedCompanyRequests` loaded each shared request in sequence. Each load is a
  registry read, an IPFS fetch, decryption and a hash check.
- Each row then loaded the same request again, through `companyIdentityProofOutcome` →
  `requireWorkflow`, only to read its status.
- Each custody row called `offerView()` to get the item name. That made a batch read, a
  company directory lookup, a full `LocationRegistered` event scan and location decryption.

## Done (fixes 1–3)

1. **No second load.** Shared rows take their status from the record they were already
   loaded and hash-checked with. Local records still go through
   `companyIdentityProofOutcome`. Test: `orders.test.ts`, "lists shared company requests
   from their single verified load".
2. **Parallel.** Shared requests load in parallel (`listSharedCompanyRequests`), and so do
   the rows. Chain reads batch through the multicall layer.
3. **Item name only.** A custody row reads only its batch summary (`offerBatchSummary`) for
   the item name. It no longer builds the full offer view.

The response shape is unchanged. No contract, schema or stored-format change.

## Remaining options, not implemented

| #   | Option                                                                                                                       | Effort | Notes                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | **Cache decrypted shared requests by on-chain `requestHash`** for a few minutes                                              | Medium | Safe: a cached record is used only while the hash read from the registry still matches. Removes most IPFS fetches and decryption on repeat loads. Keep it server-side and in memory; never cache plaintext on disk. |
| 5   | **Lighter detail page** (`InformationRequestsWorkspace`): use the list row already loaded instead of fetching the list again | Medium | Skip the full `getOrders` call for `custody` and `delivery` contexts (it is only needed for `order`). Load the custody offer and the proof status in parallel instead of one after the other.                       |
| 6   | **Query only the viewer's evidence records** instead of `listEvidence()` across all companies                                | Medium | Needs a repository query by requester/supplier wallet. Grows with total platform usage, not with the user's own requests.                                                                                           |
| 7   | **Bound the parallel IPFS reads** (a `shortcut:` comment marks the spot in `listSharedCompanyRequests`)                      | Small  | Add a limit of about 6 at a time, or pagination, once lists reach dozens of requests. A public IPFS gateway may rate-limit unbounded bursts.                                                                        |
| 8   | **Paginate the list endpoint**                                                                                               | Medium | The page already paginates on the client. Server pagination only pays off together with 6.                                                                                                                          |

Recommended next: **5**, then **4**. Measure again after each.
