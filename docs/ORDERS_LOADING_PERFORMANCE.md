# Orders loading performance — 23 November 2026

## 28 November: retained throttling, shared ciphertext cache and earlier filtering

The lazy application content-store wrapper constructed a new store for every operation, discarding
its instance cache. It now passes one bounded in-memory encrypted-envelope cache per API instance.
Entries are namespaced by a non-exported digest of encryption/storage configuration and CID,
expire after 30 seconds, and are capped at 64 small envelopes (about 32 MB of encoded ciphertext).
Large media coalesces only while in flight. Failed downloads are evicted. Temporary encryption keys
are still cleared after each operation; plaintext, permissions and authorization grants are never
cached. Each caller still decrypts and validates the authoritative hash and binding. No new business
files or database were introduced.

Manufacturer catalogue builds previously enriched other Manufacturers' products and discarded them
at the final role filter. Indexed Manufacturer parameters now skip that work early, with actual
batch-owner checks when needed. Order/shipment detail paths retain their context. The Supplier
ingredients screen retains its existing stock and location loading: switching it blindly to the
lighter catalogue-only scope would lose custody availability and receiving-location information.

| Controlled local workload                                                   | Before | After |
| --------------------------------------------------------------------------- | -----: | ----: |
| Cold Manufacturer catalogue, 20 unrelated product events: mock getter reads |    110 |     9 |
| Same workload: unrelated product getter reads                               |     80 |     0 |
| Same workload: repeat mock getter reads                                     |      0 |     0 |
| Three concurrent operations using fresh IPFS stores: downloads              |      3 |     1 |
| Same IPFS operations repeated within TTL: downloads                         |      3 |     0 |

The cold catalogue service timing was 17.7 ms before / 11.1 ms after; Express roundtrip was
88 / 90 ms, so these timings establish no reliable HTTP speedup. The primary evidence is avoided
work with unchanged returned visibility. The mocked 10 ms IPFS fixture measured 52 / 53 ms cold
and 14 / 2 ms repeat; startup/JIT noise dominates the first request. These are not live RPC counts,
Sepolia/IPFS latency, authenticated Render page timings or a provider throughput benchmark.

Public `/api/health` checks returned 200 from both supplied Render origins: `tracechain-cunk`
(504 ms) and `tracechain-web` (335 ms). Both identified as `tracechain-api` and reported healthy
ordinary providers with zero rate-limit counts, but eight historical log-provider rate limits.
These cumulative metrics are not a measurement of errors during a page request. No authenticated
Render session was available; complete first/repeat page latency, RPC count, queue wait, scan duration
and IPFS retrieval duration on Render remain unmeasured. No hosted deployment was performed.

Orders and operational-data responses now report per-request `Server-Timing`: total handler
duration (`orders`), RPC transport count/duration, scheduler queue wait, event-page count/duration,
IPFS download count/duration, endpoint roles and failover. Operational instrumentation preserves its
existing latest-read semantics. Concurrent durations overlap; they must not be summed into API
latency. Shared work is attributed to the initiating request. RPC duration/queue measurements cover
completed scheduled attempts; failed attempts still appear in the existing safe RPC diagnostics and
aggregate retry/rate-limit metrics. No business payloads or RPC URLs are included.

After rollout, compare the signed-in browser Network timings and `Server-Timing` for
`/api/blockchain/operations` and each `/api/orders?...` request on the Manufacturer overview and
Supplier ingredients screen: cold after restart, repeat navigation, then explicit Refresh separately.
The existing event index already deduplicates simultaneous scans and reuses validated historical
pages; its regression tests cover catch-up, reorg/reset and outage recovery. No second index was added.

Keep the supplied throttle settings until provider/account capacity is measured. The implemented
scheduler shares one next-start clock per endpoint: 500 ms ordinary spacing permits at most about
two starts/second per endpoint, while a bulk start adds at least the configured 1,000 ms gap;
concurrency two does not remove those gaps. A ten-request JSON batch and Multicall still consume
provider-specific capacity. Actual plan limits and other account traffic were unavailable, so there
is no evidence for a numeric increase. Remaining costs are cold history catch-up, fresh authorization,
full detail/stock reads, large media and remote throttling/IPFS latency. No contract redeployment.

## Multicall follow-up

### Focused screens and background display refresh

The latest change removes another source of full `/orders` requests:

- Shipment **lists** use `scope=shipment-workspace`. Only batches referenced by the company's
  orders/intake/product transfers are enriched. They omit private order notes, decision documents,
  evidence documents, unrelated product inventory/ingredient links and company-logo downloads.
  Opening a shipment/delivery or composing a transfer still loads the existing full action context.
- Custody inventory uses `scope=custody-inventory`, reading its warehouse positions and product
  balances without order, listing or road-shipment scans. Supplier and Manufacturer ownership and
  Distributor custody are filtered server-side before returning inventory or enriching its batches.
- Manufacturer/Distributor/Retailer overviews, Retailer evidence requests and product history use
  `scope=catalogue`: item listings and registered batches with metadata, seller names and logos only.
  No order, shipment, transfer, logistics, location, product-inventory or ingredient-link reads.
  Distributors fall back to the full build because their catalogue visibility comes from orders and
  custody. Same 40-order / 20-batch mock workload: full 2,675 ms / 205 reads / 9 event queries vs
  catalogue 166 ms / 44 reads / 3 event queries cold, 4 ms / 0 reads repeat; identical 20 rows.
- Company-information inboxes use their dedicated endpoint without loading the Orders workspace.
  Legacy company-proof context is fetched only when a record opens (order detail where applicable).
- Summary, shipment-list and inventory snapshots are fresh for five seconds after completion. For
  up to two minutes they can return immediately while one background refresh runs. The UI labels
  saved data, refresh failures and update time, then polls only while refresh is pending. There is
  failure backoff and no overlapping poll. Explicit Refresh waits for a current read. Preparation
  invalidates affected service snapshots, and confirmed-write UI reloads bypass them.
- Authorization and deployment checks run **before every snapshot read**. No cached list is used
  for permissions, proof verification or transaction/stock preflight. Keys include chain, deployment,
  wallet and role. There are at most 64 entries per reader; returned values are cloned. No private
  snapshot files or database were added. Existing event-index checkpoint/reorg handling runs on
  refresh; snapshots themselves are display data, not a claim of a latest-block result.

**Local read model (2026-11-26).** Order-page builds (`OrdersService.state`) run their contract
view reads through `ReadModelGateway` (`apps/api/src/modules/orders/read-model.ts`). Results are kept
in memory and in `<TRACECHAIN_DATA_DIR>/read-model/orders.json` (public view results only; private
payloads are decrypted per request and never stored there). Before each build the per-contract
event indexes are brought to the confirmed head; each newly confirmed log drops only the cached
reads whose identifier arguments appear in its topics or data, plus reads keyed by bytes32 ids in
those results (e.g. a transfer's batch) and argument-less reads. Reorgs clear everything; entries
also expire after 10 minutes; if events cannot be synced the build reads the live chain; `refresh`
bypasses the cache. Actions, permission checks and transaction preflight never use it. Benchmark at
100 ms simulated latency: full workspace 18.6 s before batching → 1.1 s batched → **0.44 s / 0
contract reads** warm.

Re-ran the existing 40-order / 20-batch mock workload: full workspace cold/repeat **2,649 / 2,652 ms**,
205 getter reads and 9 event queries each; summary cold/repeat **414 / 6 ms**, 103 / 0 getter reads
and 2 / 0 event queries. Both use zero IPFS downloads in this fixture. The summary cold improvement
was already implemented previously; this iteration extends its reuse beyond five seconds through
background refresh. A separate empty-custody fixture reduced 11 getter reads / 11 event queries to
1 / 0, then 0 / 0 on repeat. Mock authorization has no RPC latency; these are **not live Sepolia,
authenticated browser-paint or Pinata measurements**. The tests prove immediate stale rows while
a deferred refresh remains pending, failure labelling, hard expiry, invalidation and company isolation.

Remaining costs: initial loads after API restart, full shipment/transfer details, other legacy full
workspace callers, metadata searches, live authorization and slow/throttled RPC or IPFS. No persistent
read model or startup prewarming has been added. Re-test the normal Orders/Shipments/Inventory screens
with the same signed-in wallet; compare initial visit, navigation back and explicit Refresh separately.

The alternative to serialized getter requests is enabled through `RPC_MULTICALL_ENABLED=true`.
It uses the [official existing Sepolia Multicall3 deployment](https://github.com/mds1/multicall3/blob/main/deployments.json)
at `0xcA11bde05977b3631167028862bE2a173976CA11`. The adapter checks runtime hash
`0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891` before use.
Only whitelisted explicit-argument getters on the configured TraceChain contracts and discovered
delivery children qualify. No call with `from`, value/gas overrides, state overrides, unknown
selectors/targets, historical/pending tags or a write method qualifies. This matters because an
aggregate changes the EVM `msg.sender`; caller-dependent simulations must remain direct.

Reads collect for 15 ms in groups of at most 32. The existing scheduler/retries apply to the outer
RPC; each subcall retains its own return bytes or revert. Results and authorization grants are never
cached. A different/missing runtime falls back to direct reads; a failed RPC remains an error.
Disable with `RPC_MULTICALL_ENABLED=false` and restart the API. No TraceChain redeployment is needed.

Live tests on the configured deployment: six getters through one direct RPC returned in **282 ms**.
In the integrated Supplier pipeline at two transports / 200 ms spacing, authorization took 2,358 ms,
ingredient chain checks 5,488 ms, and operations 7,184 ms first / 959 ms repeat. Operations followed
ingredient discovery and shared its event index. Five aggregates grouped eleven getters and the
whole probe recorded **zero rate-limit errors and retries**. These timings exclude authenticated
HTTP, off-chain content and browser rendering, so they do not establish whole-page load times.
Existing log pacing is still 1,200 ms. Earlier pacing-only measurements below are historical.

Orders previously called the complete `/api/orders` workspace endpoint before showing a row.
That path still read ItemListed, OrderRequested, locations, shipments, transfers, inventory
initializations, ingredient registrations and product registrations; it also enriched catalogue
batches with inventory, product links, private order/decision/location content and company branding.
Existing RPC in-flight coalescing, bounded concurrency/backoff and incremental confirmed event
indexes did not remove this unnecessary work. Frontend in-flight deduplication already existed.

## Local comparison

The same authenticated-session double, deployment double and deterministic set of **40 orders /
20 catalogue batches** were used before and after. Each mocked contract/event operation awaited
2 ms (Windows timer scheduling affects actual elapsed time). Measurements go through Express and
Supertest, including serialization. This is a synthetic regression workload, not a Sepolia benchmark.

| Path / load                                 | API elapsed | Mock contract reads | Event gateway queries | IPFS downloads | Rows returned |
| ------------------------------------------- | ----------: | ------------------: | --------------------: | -------------: | ------------: |
| Previous complete workspace, cold           |    2,674 ms |                 205 |                     9 |              0 |            40 |
| Previous complete workspace, repeat         |    2,544 ms |                 205 |                     9 |              0 |            40 |
| Summary first page, cold                    |      419 ms |                 103 |                     2 |              0 |            20 |
| Summary first page, repeat within 5 seconds |        7 ms |                   0 |                     0 |              0 |            20 |

Cold API time fell approximately 84%; mock contract reads fell approximately 50%.
Gateway event-query counts are **not** raw RPC log-scan counts: the real gateway's existing index
can serve a repeated query without an `eth_getLogs` page. These doubles do not exercise network
batching, deployment assertions, live SIWE authorization latency or live directory/IPFS latency.
The workload has no remotely pinned private content; zero IPFS downloads is not a measured
improvement in Pinata performance. A separate real AES-GCM storage test confirms two concurrent
envelope retrievals share one mocked gateway download, and failed downloads remain retryable.

Live authenticated Sepolia/IPFS end-to-end and browser first-usable-list timings were unavailable
in this run. No wallet session was fabricated and no user credential was extracted for benchmarking.
An earlier live dashboard probe exceeded 45 seconds; it is a different workload and is not used as
the baseline here. No public transaction, deployment or upload is part of this work.

## Runtime behavior

- Supplier, Manufacturer and Retailer request lists use `GET /api/orders?scope=order-list`.
  It returns 20 summaries by default (maximum 50), current status inputs, exact quantities/units,
  chain item labels, public order references and verified company display names.
- `page`, `pageSize`, `direction`, `status`, `search` and `sort` operate across the entire authorized
  set **before** pagination. Ties use order IDs. Newest/oldest use request blocks; updated uses the
  existing on-chain decision timestamp. Human item names and batch-reference searches resolve the
  existing verified metadata on demand; this can cost additional reads. Initial labels can be the
  contract's generic “Registered ingredient/product”; full detail retains its existing enrichment.
- Only request and listing events are needed for the summary path. It does not load the whole
  catalogue, compute available stock, read product ingredient links, or decrypt order notes,
  decisions, supporting documents or evidence for the initial list. Directory resolution may still
  retrieve authorized company identity metadata through its existing implementation.
- Summary snapshots are display-only, expire five seconds after completion, coalesce in-flight
  requests and are bounded to 64 wallet/role contexts within one chain/deployment-bound service.
  Authentication and deployment checks run before every request, including cache hits.
- `refresh=1` bypasses a snapshot. Confirmed frontend writes request a fresh read; preparation
  invalidates snapshots. There is no cached authorization grant or stock decision. Company/credential
  lifecycle, ownership, permissions and stock continue to be checked before protected actions.
- Existing event indexes remain rebuildable from the chain and validate their checkpoint hash to
  handle reorganizations. A cached display can lag for up to five seconds; refresh bypasses it.
  Failed rebuilds return an error rather than an empty or stale successful response.
- Opening a row uses `scope=order-detail&orderId=...`, checks participation before private data,
  and narrows orders/catalogue batches to the selected request. This path retains existing logistics,
  location and directory context for delivery actions; it is not a minimal history-only endpoint.
  Distributor delivery queues retain their specialized complete-context path.
- `CatalogueImage` now waits until near the viewport **before fetching**; native `loading=lazy`
  alone previously deferred rendering while the Blob download still started immediately. This
  applies to all existing catalogue, inventory and order screens using that component. Missing or
  failed media stays a fallback and does not block the order row.
- Retailer Product history no longer reloads its catalogue/traceability calls solely because an
  unchanged transfer array has a new identity; actual record changes still trigger loading.
- Encrypted IPFS envelopes share concurrent downloads and retain small completed envelopes for
  30 seconds, scoped to their configured store. Retention is capped at 64 entries / approximately
  32 MB; large media only shares in-flight downloads. Failed fetches are not retained.
  Each consumer still authorizes, decrypts and checks integrity/context. No plaintext or authorization cache
  or new local persistence was introduced. This benefits all services using the encrypted store.

## Follow-up: slow inventory and operations requests

The reported real Network timings (inventory 24–39 s, operations 13.6 s, ingredients 12–24 s,
complete Orders about 72 s) are different endpoints from the paginated order-list benchmark.
Inspection found that every session authorization also performed display-name enrichment, which
enumerated all issuance wallets and loaded approved application profiles. The protected Orders,
operations and ingredient checks now skip that presentation work while still rechecking the chain.
Login/session presentation retains company names. Single-wallet and multi-wallet directory queries
now restrict profile loading and authorization to those wallets. Independent deployment wiring reads
run in parallel. Supplier batch detail uses supplier-inventory instead of the complete Orders loader,
and concurrent ingredient-list requests share a wallet-session-scoped pending request.

Two live read-only provider samples returned HTTP 200: eth_chainId 902 ms and eth_blockNumber
301 ms. This is not an endpoint benchmark or a throughput guarantee. Live authenticated before/after
endpoint timing remains unmeasured; the above Network values are user-provided observations.

- Authenticated in-flight order/media requests are scoped to the wallet-session generation and
  discarded after session changes. Responses are not retained as a frontend completed-data cache.
- Shared RPC transport owns bounded read retries, honors numeric/date HTTP `Retry-After`, and
  fails rather than waiting/retrying headers beyond its one-minute retry-delay bound. Ethers' extra
  automatic HTTP retries are disabled, including for transaction submissions. Compatible batching
  and the existing individual-read fallback remain available; active RPC configuration is unchanged.

## Observe a real account

API Orders responses expose `Server-Timing`: elapsed API time, RPC transport attempts, actual log
pages and encrypted IPFS downloads. Counts contain no URLs, wallets, IDs, tokens or document data.
Concurrent coalesced work is charged to its initiating request, so sum overlapping requests when
comparing totals. Browser media downloads are separate authenticated requests.

In browser DevTools, preserve Network requests, open Orders with a signed-in wallet, and inspect
the `scope=order-list` response and `Server-Timing`. The Performance API records
`TraceChain Orders: usable list` after the summary commits to the DOM; this excludes login and
does not wait for optional images. Repeat navigation within five seconds, then use Refresh data.
Use the same wallet/deployment/data for comparison. Do not export cookies, tokens or response bodies.

Reproduce the local API comparison from the root in PowerShell:

```powershell
npx.cmd vitest run src/modules/orders/orders.test.ts -t 'Orders list performance workload' --root apps/api --reporter verbose --silent false
$env:ORDERS_BENCHMARK_PATH = '/api/orders?scope=order-list'
npx.cmd vitest run src/modules/orders/orders.test.ts -t 'Orders list performance workload' --root apps/api --reporter verbose --silent false
Remove-Item Env:ORDERS_BENCHMARK_PATH
```

Validation covers global pagination/status sorting, refresh after status change, snapshot expiry,
failed rebuild/retry, current authorization after a cached read, foreign company/detail denial,
lazy row detail, viewport media behavior, wallet-session isolation, encrypted download deduplication,
and Retry-After. Existing contract preflight and confirmed-event reorganization tests remain in use.
No database, dependency installation, environment change or contract redeployment is required.

Checks completed: full API suite **486 passed**, full frontend suite **417 passed**, shared/API
builds, frontend typecheck and production build passed. Existing bundle-size and third-party
directive build warnings remain.
