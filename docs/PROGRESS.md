# Project Progress

## 2026-11-21 - Portable administrator and company presentation keystores

- Added a strict version-1 System Admin JSON keystore using scrypt (N=16384, r=8, p=1) and
  AES-256-GCM with fresh salt/IV plus authenticated format/version/purpose. It contains the existing
  IPFS encryption key, Veramo KMS secret and encrypted Veramo issuer store without exposing raw key
  material or adding a separate password verifier.
- The API now boots locked, leaves SIWE/health/Admin unlock available and returns `KEYSTORE_LOCKED`
  for protected operations. Correctly unlocked material is retained only in the running process;
  manual lock and restart clear it. Only the SIWE-authenticated current on-chain System Admin may
  initialize, import, export or lock, and failed unlock attempts are rate-limited.
- Added the Admin keystore workspace, no-store upload/download endpoints and a non-destructive,
  interactive `keystore:migrate` command. It imports current environment keys and the legacy Veramo
  private store, verifies the encrypted output, and deletes or rewrites nothing.
- Upgraded company presentation-signing recovery to a separate per-company portable scrypt/AES-GCM
  keystore while retaining import compatibility for existing encrypted recovery kits.
- Added password confirmation to Admin and presentation-keystore downloads. New presentation keys
  are now downloaded and explicitly confirmed before company binding. Veramo issuer-store changes
  expose **Backup required** and prevent manual Admin lock until an updated export succeeds.
- Added crypto tampering/size/access/restart tests, existing IPFS decryption and issuer-signing
  migration coverage, locked API coverage, Admin UI coverage and simulated cross-device company-key
  restoration. No contract, address, chain record, environment value or workflow journal was changed.

## 2026-11-20 - Cross-device encrypted company application manifests

- Replaced new registration `local://` profile references with a canonical version-1 application
  manifest encrypted through the existing AES-256-GCM IPFS content store. Separate encrypted
  attachment references bind file kind, name, MIME type, size and exact byte hash.
- Added two applicant-wallet signatures: complete content authorization before storage and final
  application/chain/registry/role/CID/hash binding before unsigned transaction preparation. Admin
  review treats on-chain fields as authoritative and validates manifest context and integrity.
- Made local metadata/document/logo records legacy caches rather than normal discovery sources.
  Authorized Admin review, approved stakeholder branding, current company identity and credential
  discovery can resolve through chain references and encrypted content on a fresh backend configured
  with the same addresses, gateway and encryption key.
- Added stable same-form retry behavior, explicit upload/signature/transaction/confirmation states,
  duplicate blocking after broadcast, manifest retrieval/error handling, bounded attachment reads,
  and a read-only `applications:assess-legacy` command. Existing journals are preserved.
- Added focused manifest integrity/context/fresh-backend/retry tests and remote stakeholder-directory
  coverage. No contract, deployment, chain record or environment value was changed.

## 2026-11-20 - Optimize RPC, event indexing and operational dashboards

- Replaced the serialized fixed-delay API RPC queue with configurable bounded concurrency,
  safe read batching, in-flight deduplication, measured queue/duration/rate-limit counters and
  a separate bulk-log ceiling that retains capacity for authentication reads. Transactions remain
  unbatched, non-retried and protected from duplicate frontend submission.
- Added confirmed-block incremental in-memory event indexes per provider/chain/contract/filter.
  Refreshes fetch only new blocks; checkpoint hashes rebuild after reorgs, lower heads rebuild after
  Hardhat resets, and process restarts safely reconstruct complete history.
- Scoped operational event filters by Supplier/Manufacturer/evidence participant before record
  reads, filtered transfer events before getters, bounded record workers and retained explicit Admin
  visibility. Login application status now uses the indexed applicant event instead of scanning all
  applications.
- Parallelized independent login and blockchain authorization reads without caching grants or
  credential lifecycle results. Fresh role, subject, expiry and effective credential status checks
  remain mandatory.
- Added a wallet/network-isolated frontend operational query cache with request coalescing, a short
  five-second data reuse window, refresh invalidation after existing confirmed transaction flows and
  cache clearing at logout.
- Added RPC batching/priority/metric, confirmed-block/reorg/reset/filter-index, applicant lookup,
  stakeholder filtering and frontend cache-isolation/coalescing regression coverage. No Solidity
  contracts or deployment addresses changed.

## 2026-11-20 - Share RPC transport and distinguish authorization outages

- Replaced seven independent API gateway providers with one provider per configured
  RPC/network. Added public-network request pacing, disabled JSON-RPC batches, coalesced
  identical in-flight reads with per-request response IDs, and bounded throttling retries
  to two backoffs (1 s, 2 s). Never retries/deduplicates transaction submissions; local
  chain 31337 retains ordinary transport. No completed stock/authorization cache added
  beyond ethers' existing short request cache.
- Coalesced concurrent authorization refreshes per wallet without sharing sessions or
  persisting a prior grant as fallback. A later fresh request still sees suspension or
  revocation. Orders/branding, ingredient authorization guards and blockchain operations
  now distinguish UNAVAILABLE (503) from denied authorization (403). Kept wallet-only
  session inspection and offline credential verification working independently.
- Live read-only Sepolia check ran authorization, operations, ingredient deployment/list
  and order deployment together: all succeeded in 7.1 s without RPC errors. This is a
  verification sample, not a guaranteed page latency; throughput still depends on the
  provider's service/quota and current request volume. No public transaction was sent.
- Added transport retry/deduplication/no-write-retry tests, concurrent authorization /
  fresh suspension coverage and affected endpoint 503 regression checks. All 424 API
  tests across 37 files, API type check and API production build passed.

## 2026-11-20 - Reduce Supplier ingredient-grid loading work

- Found the ingredient grid was requesting the full orders state, which also loaded
  all products, shipments, location details, logistics histories and company branding.
- Added a validated Supplier-only inventory scope on the existing orders endpoint and
  switched the grid to it. Filters foreign event owners before detail reads and checks
  current item/batch ownership; excludes unrelated product/shipment/location event scans.
  Reuses real batch metadata, credential states and the existing remaining-stock logic.
- Added positions-only logistics reads to retain owned custody quantities/warehouse
  labels without shipment or product histories. Resolves only relevant company names;
  avoids full directory/branding reads. Scope-specific frontend request coalescing keeps
  inventory responses separate from the full orders workspace. No stock/authorization
  caching or permission changes were introduced.
- Verified stock parity with full state, fewer gateway calls, foreign-owner/role denial,
  scope validation, custody quantity preservation and frontend inventory requests.
  All 172 orders API tests and 49 relevant frontend tests passed. API/web type checks
  and production builds passed; existing Vite chunk/directive warnings remain. Actual
  page latency still depends on RPC performance and the number of owned batches/orders.

## 2026-11-20 - Avoid RPC throttling on operational data reads

- Reproduced operations failure against Sepolia: parallel historical deployment-block
  discovery caused Infura Too Many Requests / ethers BAD_DATA responses. The previous
  paginated log fix alone did not prevent this initial discovery workload.
- Added CHAIN_EVENT_START_BLOCK support. configure:sepolia now verifies the first
  registry's creation receipt against its deployed address and saves that block with
  the verified suite configuration. Verification checks run sequentially without RPC
  batching to avoid a verification-time burst. Successfully updated the active .env;
  confirmed creation block is 12174274. No secrets or public transactions changed.
- Event pagination uses that lower bound instead of historical code searches; empty
  configuration retains discovery and local 31337 retains reset-safe genesis reads.
- Coalesced in-flight operations reads per wallet, without caching completed/error
  results or sharing company-scoped data across wallets. Operations RPC failures now
  return safe readable 503 responses, including a specific busy-provider message.
- Verified two simultaneous live read-only Sepolia operations calls succeed. All 344
  relevant API tests, API build and API/contracts type checks passed, including new
  configured-block validation, duplicate-read isolation/retry and error-response tests.

## 2026-11-20 - Make event history reads compatible with Sepolia RPC limits

- Reproduced ingredient-list 503 with the active RPC: deployed contract getters/code
  were valid, but the genesis-to-head log request exceeded the provider's 10,000-block
  range limit. No address or contract-version mismatch was found in those checks.
- Added a shared event reader that discovers immutable registry creation blocks using
  historical code reads, caches successful lower-bound lookups per provider/address,
  and reads complete event histories in inclusive, non-overlapping 5,000-block pages.
  Failed discovery is retryable; failed pages propagate errors. Chain 31337 bypasses
  creation caching and scans from zero to support local resets.
- Replaced all direct API gateway queryFilter calls in ingredient batches, operational
  blockchain data, orders, production/evidence, custody and product traceability.
  Preserved exact event filters, wallet restrictions and chronological event order.
- Verified a real read-only Sepolia ingredient scan succeeds (zero registered events
  in the configured registry at verification time). Added six regression tests for
  pagination boundaries, new events, failures/retry, missing contracts and local resets.
  All 334 relevant API tests, API type check and API build passed. No contract changes,
  redeployment, public transactions or environment/secret changes were required.

## 2026-11-20 - Initialize authority in the isolated Sepolia runtime directory

- Confirmed the configured authority alias, valid KMS secret format and Admin wallet
  were present, but the new active Sepolia Veramo directory had no authority identity.
- Ran the existing SSI bootstrap for the configured directory. Created its encrypted
  issuer key store and local encrypted Admin credential; preserved the old local runtime
  directory and existing secrets. No blockchain transaction or IPFS upload was sent.
- Documented per-directory initialization and the current encrypted storage paths.
- Verified a second bootstrap reused the same DID, credential ID and hash with
  authorityDidCreated=false and credentialIssued=false; no duplicate was issued.

## 2026-11-20 - Refresh API workspace dependencies before development startup

- Diagnosed the missing visibleIngredientClaims runtime export as stale shared dist
  output: the source exported the function while Node's package import did not.
- Rebuilt shared/SSI and added API predev dependency builds so both root dev:api and
  direct API workspace development refresh compiled exports before starting tsx.
  Documented restarting the API after shared/SSI source changes.
- Verified the real Node package import resolves the function, shared disclosure-policy
  tests pass (six tests), 16 API ingredient-batch tests pass, and shared/SSI builds
  plus API type check/build pass.

## 2026-11-20 - Recover interrupted IngredientRegistry deployment journal

- Investigated HHE10410: the earlier RPC rejection left a TRANSACTION_PREPARE_SEND
  for IngredientRegistry nonce 65 without a TRANSACTION_SEND/hash. Read-only Sepolia
  checks returned chain 11155111 and latest/pending wallet nonce 65, confirming that
  nonce was unused at recovery time.
- Backed up the existing journal inside the ignored deployment directory, then used
  the supported Ignition wipe command for only TraceChain#IngredientRegistry.
  Verified the journal retains the exact earlier content plus the single WIPE_APPLY
  event and that deployed addresses remain present. No contracts, keys or other
  future records were removed; no public transaction was submitted.
- Deployment can now resume with the existing tracechain-sepolia ID and the transaction
  queue. No runtime code changed in this recovery; build/test results above remain
  those from the preceding transaction-queue implementation.

## 2026-11-20 - Serialize Sepolia delegated-account deployment transactions

- Added a Sepolia-only Hardhat network hook that queues transaction submissions,
  waits for the previous receipt and checks the sender's latest/pending nonce before
  sending. Supports ordinary and locally signed raw transactions. Returns submitted
  hashes immediately so Ignition can journal them; stops after five minutes waiting
  without automatically replacing or resending a pending transaction.
- Preserved the TraceChain module graph, future IDs, deployment journal, existing
  addresses and keystore. This avoids incompatible dependency changes to already
  initialized futures in the interrupted deployment. Other networks and read requests
  retain their existing behavior. No public transaction was submitted by this change.
- Added regression coverage for mining gates, pending transactions from a prior run,
  signed raw transactions, RPC rejection/retry and network/read bypass behavior.
- Validation: Hardhat build, contracts TypeScript check and 22 Mocha tests passed
  (four queue tests plus 18 existing TraceChain integration tests).

## 2026-11-20 - Prepare active Sepolia deployment configuration

- Switched root `.env`/example to Sepolia 11155111 and reused the configured Sepolia RPC;
  a read-only provider check returned HTTP 200 / chain 11155111. Removed active local
  contract/Admin values pending verified deployment. App URLs remain localhost because
  this changes the contract network, not web hosting. Existing encryption/Pinata secrets
  and all local records/keys/journals remain intact.
- Hardhat loads root `.env`, shares the active Sepolia RPC and explicitly checks chain ID.
  SSI reuses that RPC on Sepolia, while local contract testing still requires a separate
  Sepolia DID-resolution RPC. Frontend defaults target Sepolia; isolated tests remain local.
- Added `TRACECHAIN_DATA_DIR` and routed issuer, workflow, receipt, application-document and
  backend DIDComm files through it. Active Sepolia uses `.tracechain/sepolia`; the default
  still preserves existing `.tracechain` paths when no directory is selected. No files
  are moved/deleted and no local chain records are migrated.
- Added root/workspace `deploy:sepolia` and `configure:sepolia` commands. Successful complete
  Ignition deployment triggers read-only chain/code/wiring verification, then an atomic
  seven-address/Admin update. Incomplete deployment fails without changing configuration.
- Verified existing local Hardhat build and contract type checks, all-workspace type checks,
  and 389 API tests including new RPC-fallback/data-isolation coverage. All workspace
  production builds and 36 frontend configuration/authentication tests passed. The address command
  correctly refused a missing Sepolia manifest. No production Hardhat keystore was found,
  so no public deployment or transaction was attempted. A funded Sepolia wallet must be
  configured in Hardhat before running the documented deployment command.

## 2026-11-20 - Complete ingredient processing/quality field removal

- Removed retired processing/date-context and laboratory-quality fields from the
  ingredient registration DTO, credential write path, Supplier review/detail responses
  and new Manufacturer/Retailer evidence-request validation.
- Kept legacy credential/request parsers for cryptographic and stored-record compatibility,
  while filtering retired values from current API responses, evidence reviews and shared
  claim rendering. Legacy unfinished registrations are compared through their current-field
  projection so they can resume without resending or displaying retired values.
- Added API, shared-policy and frontend regression coverage. Contracts remain unchanged.

## 2026-11-19 - Simplify ingredient processing and quality inputs

- Removed processing country/location, date-type selection, laboratory/quality evidence
  and internal quality remarks from new ingredient creation and its normal review.
  Retained origin, production date, expiry, explicit allergens, certifications and files.
  Removed the unused laboratory editor component.
- Removed processing/quality choices and the Quality template from new evidence-request
  forms. Existing credentials, request policies and private document verification remain
  supported for compatibility. Superseded by the 2026-11-20 hardening above: old
  registrations now ignore these retired fields instead of displaying or resending them.
- Updated creation/legacy-resume and request-template regression coverage plus the README
  and policy/creation documentation. No contract, storage, environment or login change.

## 2026-11-19 - Version 2 Company and Ingredient disclosure policy

- Implemented the user-supplied policy across the normal Company order/delivery and
  ingredient-linked proof entry points, Manufacturer/Retailer evidence composers and
  catalogue requests. Shared request controls distinguish mandatory identity context,
  Required and Optional fields. Company registration number/country are one selection
  group; company name is always included. Application reference is absent from defaults.
- Added optional registration-country collection and Admin ISO-country review. New normal
  issuance requires country and signs Company Role schema v2. Derived selective identity
  attestations use a distinct v2 VCT and are issued only after verifying the original VC
  and exact hash, with source credential ID/validity and holder binding. Legacy sources
  missing country cannot satisfy required country requests and show replacement guidance.
- Added explicit Ingredient v2 schemas/VCT, processing country, signed production/processing
  date meaning, structured exact-batch laboratory reports/results, internal remarks and
  separately selected encrypted laboratory files. Reused existing source-region/city,
  facility/address, allergen, certification and document fields without duplicate aliases.
  Creation, persisted workflow resume, owner read models and consent/review support them.
- New Ingredient HTTP requests use policy v2 with Basic traceability, Food suitability,
  Certification, Quality or Custom templates; type/scope requirements do not expose the
  Supplier's undisclosed entries. Policy participates in the encrypted/on-chain request
  commitment. Contains/May contain needs details; Unknown fails food requests by default.
  Complete certificate/laboratory context is required with selected documents, while
  unselected entries/files/private references remain withheld.
- Ingredient holder key binding adds exact request, purpose, batch and expiry context;
  verification checks the original issuer JWT, source hash, signatures, requirements,
  current roles/credential status, certificate scope/validity and exact tested batch.
  Private file reads reverify and match exact signed entry association/hash/CID. Company
  proofs compare disclosed values and source validity/reference to the verified VC and
  current company authorization. Explicit preview/consent is required; missing data,
  changed preview source or unmet policy cannot be accepted. Existing View/Verify/Accept,
  login, holder signing and backend DIDComm responsibilities remain separate.
- Added real-signature regressions for Manufacturer/Retailer Company proofs, registration
  grouping/legacy missing country, independently disclosed laboratory and certification
  entries/files, hidden fields, wrong request/purpose/expiry, and file-entry authorization.
  UI regressions check template/requirement choices and the exact grouped claims passed to
  signing. Existing replay, wrong holder/verifier/challenge/batch, revoked authorization,
  source failure and explicit decline tests remain in place.
- Validation: 397 frontend, 386 API, 25 SSI, 34 shared and 18 local contract tests passed.
  Frontend suite used `--maxWorkers=4` after an unrestricted concurrent run hit Windows
  resource-related timeouts; the complete limited-worker run passed. Production build and
  all workspace type checks passed. Existing Vite bundle/directive warnings remain.
- Isolated Chrome checked creation, expanded laboratory fields, review and Company/
  Ingredient request controls at 375px, 768px and 1440px without horizontal overflow.
  Synthetic screenshots are ignored under `.tracechain/ui-review/ingredient-*.png`.
  No real MetaMask approval or live Pinata upload was performed.
- No contract implementation/migration, new dependency, database service, environment
  change, commit, push or public deployment. General replacement/reissuance UI remains
  missing; old signed records are not mutated. The existing five-minute holder-proof
  freshness window is explicit. Details, versions, field mappings and manual tests:
  [DISCLOSURE_POLICY.md](DISCLOSURE_POLICY.md).

## 2026-11-19 - Standard country dropdown layout

- Ingredient origin now uses a full-width field: flag and country name inside one
  clickable trigger, arrow on the right, and a matching-width searchable menu.
  Removed the separate phone-style flag trigger and outside country label. The
  phone input retains its compact selector. No dependency change.
- Validation: 37 ingredient/registration frontend tests and frontend TypeScript/production
  build passed. Existing Vite bundle/directive warnings remain.

## 2026-11-19 - Country flags in ingredient origin selection

- Added bundled SVG flags beside country names in the searchable ingredient-origin
  dropdown and selected value. Reused the installed `react-phone-number-input/flags`
  export; no dependency installation or external flag-image requests are required.
- Preserved ISO values, searchable names, keyboard behavior and the existing theme.
  Regression coverage checks flags in both the dropdown option and selected trigger.
- Validation: 21 ingredient frontend tests and the frontend TypeScript/production build
  passed. Existing Vite bundle/directive warnings remain.

## 2026-11-19 - Three-step Supplier ingredient creation and granular certification evidence

- Replaced the normal Add ingredient form with Batch details, Origin and certifications,
  and Listing and review. Reused existing navigation, form fields, step progress, theme,
  country selector, extraction, storage and transaction services. Values survive step
  navigation; inline errors focus the first invalid field. Extracted values remain editable
  and require review. Optional price/basis/image stay separate from signed claims.
- Added exact BigInt kg→g and litre→mL normalization for new structured registrations,
  whole each/g/mL validation, searchable ISO origin, separate processing/private source
  fields and explicit allergen declarations. Existing registered units, origin text,
  certification strings and JWT credentials are preserved.
- Added repeatable stable-ID certification cards with issuer/reference/dates/scope and
  multiple PDF/image files. New entries require at least one supporting file. Browser/API
  enforce file limits; API validates signatures, PDF structure/page count and image dimensions.
  Uploads use existing AES-256-GCM Pinata storage and a durable encrypted attachment index.
  Preview/download, upload progress, failure/retry and entry/file removal are implemented.
- Extended SSI schemas and presentation consent/review to support independent source claims,
  complete certification entries and individually selected file descriptors. File disclosure
  requires its parent context. Required generic certification/file claims require actual
  selected data. Whole-file disclosure is explicit; Supplier signatures are not presented as
  independent certification-authority checks. Legacy JWT sharing stays full disclosure with
  preview/consent, and unavailable structured claims fail honestly.
- Added owner-only unfinished-workflow retrieval and attachment retrieval, plus requester
  document access gated by request parties, verified presentation, current Supplier
  authorization, expiry and matching signed CID/hash. Requesters cannot retrieve unshared
  source credential claims. SD presentations must match the registered source credential.
- Registration locks duplicate submissions and resumes persisted workflows. Confirmed stages
  are reread rather than resent; optional image/readback failures do not invite duplicate
  registration. The chooser can resume prepared registrations after reload, including stored
  files. Removed/abandoned files may leave encrypted orphan pins; automatic cleanup and
  distributed/multi-process issuance locking are not implemented.
- Changed files span Supplier batch creation/detail/transaction/API components, the reusable
  certification editor/claim renderer, Supplier/Manufacturer/Retailer presentation screens,
  ingredient-batches/production-flow/orders API modules, encrypted-store timeout, shared
  ingredient types/normalization, SSI credential schemas/issuance/disclosure and regression
  tests. Contract changes are tests only. Detailed schema, routes, storage, compatibility,
  manual test flow and limitations: [INGREDIENT_CREATION.md](INGREDIENT_CREATION.md).
- Validation: full frontend 394 tests, full API 382 tests, SSI 25 tests and shared source
  30 tests passed. `npm run build` and `npm run typecheck` passed. Hardhat build and contract
  TypeScript passed; `hardhat test test/TraceChain.ts` passed 18 tests, including canonical
  g/mL and legacy litre integration. Windows Hardhat build required execution outside the
  sandbox because the sandbox blocked Node's OS user lookup. Existing Vite bundle/directive
  warnings remain. No Solidity implementation change, contract redeployment, dependency,
  environment variable, public deployment, commit or push.
- Isolated Chrome review checked all three steps and expanded certification layout at 375px,
  768px and 1440px without horizontal page overflow. Manual navigation confirmed retained
  values, ISO selection, explicit allergens and `1.25 kg → 1250 g` review. Ignored screenshots:
  `.tracechain/ui-review/ingredient-*.png`. Live Pinata uploads and real MetaMask approvals
  were not exercised. Existing signed claims are not editable/replaced by this feature;
  backend decryption remains server-managed.

## 2026-11-19 - Combine company management controls visually

- Replaced the separate Company access card and collapsed Advanced credential controls with one Company management card containing visible, labelled Company access and Issued credential groups, individual status badges and a subtle separator. Removed the obsolete disclosure styling.
- Per the user's clarification, combined only the presentation: each action continues to target its own existing contract record/API. Preserved explicit confirmations, Admin/wallet/stale-state checks, duplicate guards and matching chain rereads. No combined transaction, contract, API, storage or deployment change.
- Validation: 38 company-detail/access-control tests and the frontend production build/TypeScript check passed. Updated regression coverage for both visible groups within the same management card and read-only page opening.

## 2026-11-19 - Company access first, advanced credential lifecycle controls

- Made Company access the primary Admin company-detail lifecycle section. Moved credential-specific controls into a collapsed Advanced credential controls disclosure with the requested helper text and a separately visible credential status. Disclosure opening is read-only. Company confirmations name the company; advanced confirmations additionally identify the exact credential. Administrator stakeholder controls are not offered because the contract rejects them.
- Verified StakeholderRegistry `_changeStatus`: revocation removes the role, and both revoked and System Admin records reject further lifecycle changes. Preserved distinct stakeholder/credential APIs and contracts. Added fresh Admin-session, signer/account and stale-record checks before lifecycle submission, synchronous duplicate guards, receipt-status checks and matching-result rereads before claiming success. A mined transaction with stale/unavailable rereads stays unconfirmed in the UI and offers a refresh without resending.
- Audited protected operations: StakeholderRegistry `_authorizedRole` requires current stakeholder lifecycle and linked Company Role credential validity; `hasPermission` also enforces role/individual settings. Production-flow `getAccess` checks current company role/status/hash, credential effective status and permission. Company VP verification checks issuer/holder signatures, challenge, audience, request/purpose, wallet/role, validity, source hash and current chain access. Order identity attestations rerun verification rather than trusting a stored VERIFIED state. No production API or Solidity implementation change was required.
- Labelled successful proof verification times as historical and kept business acceptance separate. Added API cases for suspended/revoked company plus Active credential, suspended/revoked/expired credential plus Active company, denied permissions, unauthorized lifecycle preparation and a previously verified signed proof followed by lost authorization. Historical verification records are retained; authorization restoration permits a fresh verification.
- Validation: all 387 frontend tests, 81 blockchain/production-flow API tests and 17 local TraceChain contract tests passed, as did frontend/API/contracts TypeScript checks and the frontend production build. Added contract regression coverage for independent company/credential states, reactivation and terminal stakeholder revocation. Isolated Chrome confirmed the primary section order, initially collapsed advanced controls and no page overflow at 375px, 768px and 1440px, including long identifiers and the mobile revoke dialog. Local screenshots are .tracechain/ui-review/company-access-review-*.png. No redeployment, public transaction, login, issuance or storage change. Live MetaMask rejection/account changes are simulated in UI tests; existing Vite warnings remain.

## 2026-11-19 - Merge Stakeholders into Manage companies

- Combined company/credential administration into Manage companies: moved Supplier, Manufacturer, Distributor and Retailer count cards and role filters into the list, added company/registration/wallet search and company-access status filtering, retained credential lifecycle totals and labelled credential status separately from company access. Filter selections survive opening and returning from company detail; an empty filtered result has a distinct state.
- Removed the duplicate Stakeholders sidebar entry and obsolete standalone stakeholder view. Old stakeholder/access-control URLs and internal links resolve to Manage companies; role permissions and the permission matrix remain separate. Updated overview shortcuts and navigation metadata.
- Preserved both contract lifecycle operations in the unified company detail: stakeholder wallet access uses the existing stakeholder lifecycle API, while credential lifecycle actions continue to use the credential API. Both use explicit confirmation, existing authorized-wallet checks, successful receipts and record refresh; no API, contract, deployment or storage change.
- Validation: 378 frontend tests passed, including role counts/filter/search interaction, filter retention, legacy route aliases and distinct stakeholder vs credential transaction preparation. Frontend TypeScript and production build passed. Existing Vite warnings remain. No live transactions were sent.

## 2026-11-19 - Readable Admin company detail and permission management

- Replaced the wide credential record and tall action panel with a centered 1280px detail layout: actual company name/logo fallback, responsive identity description list, explicit SGT dates, accessible full-wallet expansion/copy, collapsed wrapping technical identifiers, compact copy/download controls and separate lifecycle management. Missing metadata displays unavailable; registry lifecycle and unperformed cryptographic verification are labelled separately.
- Kept the existing Admin APIs and contract checks. Company-specific permanent revocation requires a reason and explicit consent before MetaMask. Lifecycle and per-permission writes show wallet/submitted/confirmed/failure states, check receipt success and reread actual records. A failed read after confirmation prevents accidental resubmission. Existing confirmed data remains visible during refresh; pending overrides do not replace persisted access.
- Added direct company links via the credentialId query parameter and retained the selected detail after refresh. Permission columns, override indicators, selects, status badges and the accessible mobile scroll region now use consistent spacing. No API, contract, login, permission model, storage or deployment changes.
- Validation: all 376 frontend tests, 46 blockchain API tests, frontend TypeScript check and production build passed. Twenty focused new tests cover lifecycle states, missing/long identifiers, copying/download data, explicit revocation consent, wallet rejection, failed receipts/wrong chain, confirmed-but-unavailable reads, persisted permissions, empty/error states and list/direct navigation. Existing Admin/ownership restrictions remain covered by the workspace and blockchain suites.
- Isolated Chrome renders using synthetic API responses checked 375px, 768px and 1440px widths plus long identifiers/company names and mobile revocation confirmation. No page-level horizontal overflow after anchoring screen-reader permission labels; the table scrolls within its own region on mobile. Screenshots are local review artifacts in .tracechain/ui-review/admin-company-*.png. No real lifecycle or permission transactions were sent; live RPC/MetaMask behavior still depends on the configured chain and authorized wallet. Existing Vite chunk-size and dependency directive warnings remain.

## 2026-11-19 - Open native date pickers from field clicks

- Added one shared click handler for date, datetime-local, time, month and week inputs. Applied it to public/workspace shared Inputs and the three remaining standalone receipt/evidence date inputs. Retained consumer click cancellation, keyboard entry and validation; skip disabled/read-only/text fields and fall back to native behavior when showPicker is missing or restricted.
- Validation: all 341 frontend tests and the production build/TypeScript check passed. Added eight interaction checks covering both input families, date/time types, keyboard changes, constraints, read-only/disabled inputs and browser restrictions. Isolated Chrome trusted clicks invoked actual native date and datetime-local pickers without errors; no forms were submitted. Existing Vite warnings remain.
- Preserved the existing registration-page and package-lock edits. No dependency, API, contract, environment or data changes.

## 2026-11-19 - Diagnose Hardhat builtin node loading failure

- Confirmed Hardhat 3.21.1 and its built-in node plugin are installed with deduplicated workspace dependencies. Read-only `hardhat node --help --show-stack-traces` succeeded outside the sandbox; loading the actual node task failed because Windows Application Control denied the installed EDR 0.25.0 native binary. The outer HHE200 message is misleading for this failure.
- Verified the Windows engine package/binary exists and the nested error names the denied file. The official `@nomicfoundation/edr-wasm32-wasi@0.25.0` registry lookup returned 404, so no supported published WASM fallback was installed. Documented the issue and approved-environment options in README.
- No config, dependency, security-policy, environment, blockchain state or deployment changes. Full node startup and contract execution remain blocked by the Windows policy; compilation/compiler WASM preferences do not address this native-engine load. Preserved the existing registration-page edit.

## 2026-11-19 - Human-readable company evidence sharing

- Replaced the Supplier company-claim checkbox form with accessible required/optional toggle rows, readable claim labels and role values, compact technical-value previews, copy/show-full controls and a selected-claim summary. Required request claims stay enabled and locked; unavailable required values prevent signing.
- Consolidated the response into one review flow: load the request, select optional claims, review recipient/purpose/expiry/claims in a confirmation modal, then explicitly sign and share. Decline and refresh remain secondary actions in a responsive sticky footer, and expired requests cannot enter the signing flow.
- Preserved the existing selective-disclosure/full-credential presentation creation, holder key check, recipient/challenge/expiry binding, encrypted submission, API calls and custody separation. Full technical claim values remain available in collapsed Technical details.

## 2026-11-19 - Compact shared information-request inbox

- Redesigned the shared received/sent company-evidence request cards for Supplier, Manufacturer, Distributor and Retailer with registered company names and logos, a compact participant route, aligned request facts, readable status/deadline badges and a prominent next-action row. Raw request IDs, references and workflow status remain in collapsed Technical details.
- Tightened the page header, category tabs, guidance, search and status-filter spacing. Category and status tabs remain keyboard accessible and now scroll horizontally at narrow widths instead of overflowing.
- Preserved the existing request selection, evidence sharing, privacy, permission, API and blockchain behavior. Request creation times are shown when supplied by the existing data shape; legacy records without that timestamp display `Not recorded` rather than an invented date.

## 2026-11-19 - Compact company evidence request details

- Redesigned the shared Supplier, Manufacturer, Distributor and Retailer company-evidence detail presentation with a compact header, breadcrumb, counted Company/Ingredient tabs, user-facing evidence statuses and a responsive request card with clear next actions. Raw workflow values and identifiers remain available only in collapsed Technical details.
- Custody-linked evidence details now load and present the authorized offer context: item, batch reference, requesting company, quantity, readable offer state and a direct custody-offer link. A single information banner clarifies that evidence sharing, custody acceptance and stock movement remain separate.
- Preserved the existing encrypted proof request, selective presentation, verification, permission and MetaMask transaction flows. Not-requested Supplier views show no action required with a small secondary refresh; pending and completed states expose their existing review/share or evidence-result controls.

## 2026-11-19 - Shared company profile and location management UI

- Reorganized the shared Supplier, Manufacturer, Distributor and Retailer Profile page around registered operational locations. Added compact real-data summaries, bounded responsive location cards, role-specific capability presentation, collapsed technical identifiers and compact skeleton, error and empty states.
- Moved the add-location workflow into a focused responsive modal with grouped name, address, capability and review sections. Existing owner checks, MetaMask transactions, Distributor warehouse registration and encrypted presentation updates remain unchanged; successful saves close the modal and refresh the authoritative list.
- Moved private registration documents below locations into a collapsed shared disclosure with the authorized document count and privacy guidance. Existing view, download, supplemental upload, authorization and object-URL cleanup behavior is preserved.

## 2026-11-17 - Correct empty-location centering on wide screens

- Fixed the remaining unlayered fixed-column rule that kept the empty state centered over only three 360 px tracks. An explicit empty-grid modifier now creates one full-width track; populated location-card layout stays unchanged.
- Corrected visual verification to compare the icon center with the full location form/content width, rather than with its own wrapper. Chrome at 2148/1440/768/375 px (with a 240 px sidebar offset on desktop) measured zero center difference and no horizontal overflow. The wide-screen screenshot was inspected. Three Profile tests and the frontend production build/type check passed.

## 2026-11-17 - Stacked location fields and end wallet-message trial

- Profile location setup now uses one full-width column at every viewport: name, address, then the existing right-aligned register action. The empty-state wrapper spans all location-grid columns so its map icon and message are centered across the section.
- Removed the optional transaction-preview signature flow, formatter/tests/exports and unused prepared-transaction ABI metadata. Normal MetaMask transaction confirmation remains, along with SIWE and registration ownership signatures, network checks, request snapshots, duplicate-request coalescing and the Admin workflow lock. Required multi-transaction operations remain separate.
- Validation: all 333 frontend and 358 API tests passed; root production build/type compilation passed. Chrome at 1440/768/375 px verified stacked full-width fields, centered map icon (zero center offset), right-aligned register action and no horizontal overflow. Direct-send tests confirm no extra signMessage request. No live signatures, transactions or contract changes.

## 2026-11-17 - Profile location form layout

- Scoped a dedicated location-form layout to Profile: top-aligned fields, 40/60 name/address columns, and the register action on its own full-span right-aligned row. Stack fields below 600 px of available workspace width. Preserved the separate pickup-time form layout.
- Validation: three Profile tests and frontend production build/type checking passed. Chrome at 1440/768/375 px verified equal field top alignment on larger layouts, full-width stacked fields on mobile, action placement below both controls, right alignment and no horizontal overflow. Synthetic profile data only; no location transaction was submitted.

## 2026-11-17 - Shorter wallet messages and duplicate-request guards

- Shortened trial signatures to purpose, up to six key values and essential website/wallet/network/contract/value information. Removed raw technical arguments and separate nonce/time/format explanations; one reference commits to the complete call and context, including omitted fields. Kept the distinction between message signing and real transaction execution explicit.
- Coalesce concurrent identical wallet requests so repeated calls share one preview and one transaction prompt. Guard Admin approval/rejection through confirmation and refresh with a synchronous workflow lock. Required approval and credential-registration transactions remain separate; their two signature/transaction pairs can legitimately produce four MetaMask prompts in this trial.
- Validation: 59 shared and 336 frontend tests passed; root production build and TypeScript compilation passed. Added tests for a single request under concurrent calls and binding omitted hash/CID arguments. Existing signature cancellation, wrong-wallet/network, exact-call and issuance tests remain passing. No real signatures, transactions or contract changes.

## 2026-11-17 - Readable MetaMask previews for all contract actions (trial)

- Added a shared ABI-based wallet-action formatter and named ABI fragments on prepared transactions from all web transaction gateways. Preview messages decode actual calldata, retain exact large quantities and identifiers, translate roles/units/permissions/dates where known, quote arbitrary strings and bind website, wallet, chain, target, ETH value, call fingerprint and a fresh request/time.
- Central web sender now requests a readable personal-message signature inside MetaMask, verifies it locally against the connected wallet, rechecks the network, then requests the unchanged real transaction. Rejecting the first prompt prevents sending; rejecting the second preserves normal wallet cancellation. Preview signatures are discarded without API submission, logs or persistence and do not establish login/authorization. No app review dialog was reintroduced.
- SIWE and Company Role ownership signatures remain separate. Multi-step issuance repeats the preview/transaction pair per contract call. No contract change/redeployment or new environment variable is required.
- Validation: 57 shared, 358 API and 335 frontend tests passed; shared/API/frontend type checking and root production build passed. Tests cover named argument decoding, units, UTC dates, exact large quantities, nested arrays, string injection, unknown/mismatched methods, preview cancellation, wrong signer, network changes, request snapshot and exact final transaction bytes. Existing build warnings remain. No real wallet signing or transactions were performed.

## 2026-11-17 - Remove the extra transaction-review dialog

- Removed the added TraceChain wallet-review dialog, its styles/tests and unused API transaction-review metadata/helper. Existing business approval/confirmation screens now proceed directly to MetaMask. Preserved named ABI parameters, exact calldata, network checks, local nonce handling, readable application ownership signatures and SIWE.
- Clarified the earlier implementation: the user wanted readable content inside MetaMask, not another app confirmation. Standard transaction RPC supplies transaction parameters rather than arbitrary confirmation prose; message-signature text remains under application control. No Snap, replacement signing flow, contract change or deployment was introduced.
- Validation: all 332 frontend and 358 API tests passed; root production build/type compilation passed. Added direct-send/cancellation/network/snapshot coverage to the existing transaction tests and confirmed no runtime references to the deleted review remain. Existing build warnings remain.

## 2026-11-17 - Centered document previews

- Centered image previews in both application-document review and local registration review with a dedicated media region. Preserve aspect ratio and limit images to the available width and viewport height.
- Moved application-document Download into a separate right-aligned row below the image/PDF, with spacing and an icon. Existing authorized retrieval, downloads and object-URL cleanup remain unchanged.
- Validation: eleven relevant registration/document/application tests and frontend production build (including TypeScript checks) passed. Chrome at 1440/375 px verified zero horizontal center offset, the download row below the image and no page overflow using a synthetic image. Existing build warnings remain.

## 2026-11-17 - Positive actions on the right

- Reordered actual JSX action controls across approvals, delivery acceptance, custody, evidence, receipts, registration, company credentials and batch dialogs. Negative/secondary choices precede affirmative actions: Reject then Approve, Decline then Accept and Cancel then Save/Confirm. Contextual information actions precede paired decisions so Reject/Approve remain adjacent.
- Preserved right alignment, responsive wrapping, handlers and authorization. Source order also matches keyboard/screen-reader order; no CSS visual-order workaround. Destructive confirmation dialogs retain Cancel before their explicit confirmation.
- Validation: all 334 frontend tests and frontend production build, including TypeScript checks, passed. Existing Vite warnings remain; no API or contract changes.

## 2026-11-17 - Right-aligned page and modal actions

- Applied a shared responsive action-row layout to approval/rejection, save/cancel, evidence, batch, order, shipment, document-related and export action groups across stakeholder pages and workspace dialogs. Right-aligned standalone form submission actions and registration footer controls; retained top-left page Back navigation.
- Removed conflicting full-width/flex-grow action-button settings, including modal confirmations. Actions keep natural widths, wrap when necessary and remain within the page/dialog. Shared public-modal footers use the same layout. Navigation, filters, input controls and action handlers are unchanged.
- Validation: all 334 frontend tests, frontend type checking and production build passed. Chrome at 1440/375 px checked page actions and both modal implementations: right alignment matched their content edges, no horizontal overflow, and approval/rejection/cancel labels remained visible. Synthetic preview only; no signing or transactions. Existing Vite warnings remain.

## 2026-11-17 - Readable wallet signatures and transaction review

- Replaced the raw JSON company-application ownership message with a shared readable v2 format: company, registration number, role and wallet first, then exact bound references. Omitted absent optional location/logo lines; retained signed profile/document fingerprints and quoted user strings to prevent misleading line injection. SIWE remains unchanged.
- Added API review metadata derived from actual ABI-encoded contract calls across Admin, ingredient, production, evidence, orders, delivery and receipt gateways. Added parameter names to existing write ABI fragments without changing selectors or calldata.
- All web contract sends now open a cancellable review before MetaMask. The review shows action, exact named values, wallet/network/contract/ETH amount and collapsed technical fields. Check the data fingerprint, snapshot the reviewed request and recheck the wallet network before sending. Cancellation never calls the signer. Existing nonce handling and real MetaMask transaction confirmation remain.
- Added keyboard focus handling, responsive scrollable review content and unique modal title IDs for nested confirmations. Chrome at 1440/375 px verified dialogs fit the viewport with no horizontal overflow and Cancel completes without a wallet action.
- Validation: 49 shared, 360 API and 334 frontend tests passed; shared/API/frontend type checks and the root production build passed. Tests cover all application-field signature bindings, line injection, ABI decoding, exact large quantities, cancellation, modified call data, request mutation and network changes. Existing build warnings remain. No live signatures/transactions, contract changes or deployments were performed. Restart API and refresh browser together; old in-progress application signatures must be regenerated.

## 2026-11-17 - Button icon alignment and spacing

- Scoped registration document metadata selectors to the file-details column, preventing Preview labels from inheriting top margins and metadata typography.
- Standardized shared public/workspace button content to centered icon/text rows with 6 px spacing, zero content margins and nonshrinking block SVGs. Applied the same spacing to custom QR/download/scanner actions; excluded the shared Back control from traceability action styling. Preserved navigation/card layouts and button actions.
- All 328 frontend tests and the production build (including TypeScript checks) passed. Isolated Chrome previews at 1440/375 px verified shared buttons have zero icon/label center offset, 6 px gaps and no horizontal overflow; native QR/download text differed by at most 0.5 px. No real documents, signing or transactions were used. Existing build warnings remain.

## 2026-11-17 - Consistent Back navigation and deferred location setup

- Added one shared left-chevron page-navigation control with a top-left row across workspace details, requests, shipments, traceability and registration. Kept bottom form-step navigation in place.
- Removed dispatch/receiving name and address fields from new registration state, validation, review and submitted payload. The third step is Wallet & identity. Profile location setup and legacy application metadata remain supported; logistics still requires registered locations.
- Updated registration/navigation tests and documentation. All 328 frontend tests, frontend type checking and production build passed. Existing Vite bundle-size and dependency directive warnings remain. No API, contract, stored record or authorization changes.

## 2026-11-17 - Local document review and explicit final submission

- Added per-file local PDF/image preview, filename/type-purpose/size review and a selected-file download fallback. Preview URLs are revoked on close/replacement/unmount; preview performs no upload or signing. Change documents preserves selected files and resets the declaration on returning to Review.
- Separated Continue and Submit button identities so a click cannot reuse a button whose type changes to submit during React reconciliation. Final submission requires the actual marked Submit button as submitter and the declaration; Continue only opens Review.
- Seventeen relevant UI tests, frontend type checking and production build passed. Isolated Chrome at 1440/375 px reached Review with three preview buttons, disabled Submit pending declaration, zero wallet signing requests, zero application preparation calls and no horizontal overflow; PDF preview dialogs opened at both sizes. Synthetic local files only; no application was submitted.

## 2026-11-17 - Clickable registration steps and centered button icons

- Replaced static progress items with accessible buttons. Backward jumps retain entries; forward jumps validate prerequisites and open the first incomplete section rather than bypassing required fields or documents. Navigation is disabled during wallet selection/submission.
- Added a trailing-icon slot to the shared public Button and separated registration Continue/Back/wallet icons from their text. Normalized label line height and SVG display for vertical centering.
- All 328 frontend tests, frontend type checking and production build passed. Chrome at 1440/375 px measured zero vertical center difference between Continue text and icon, five selectable steps and no horizontal overflow; desktop screenshot inspected.

## 2026-11-17 - Short five-step registration wizard

- Split the long information page into Company details, Contact & representative and Location & wallet, followed by Supporting documents and Review & submit. Render only the current page, validate only its fields before Continue and preserve data/files/wallet on Back. Final submission still validates the complete application.
- Updated the five-position responsive progress indicator, current-step count and heading focus/scroll behavior. Existing category groups, phone/wallet controls, encrypted upload and signed registration logic remain in place.
- Browser checks at 1440/375 px found one category on the first page, two on the contact page and no horizontal overflow. First-page cards measured approximately 764/947 px high, substantially shorter than the prior all-fields page; desktop screenshot inspected. All sixteen relevant registration/navigation tests, frontend type checking and production build passed. No API, contract, environment or stored-record changes.

## 2026-11-17 - Categorized company registration

- Grouped the first registration step into Company details, Contact details, Dispatch & receiving location, Authorised representative, and Wallet & digital identity. Added semantic fieldsets/legends with themed icons and separated legal business details from physical delivery details.
- Preserved field values, required validation, phone/wallet/document behavior and the three-step submission flow. Contact controls remain aligned; groups stack on mobile without horizontal overflow.
- Validation: fifteen registration/navigation tests and frontend type checking passed. Headless Chrome checks at 1440/375 px verified five named groups, no overflow and equal contact-field heights; both screenshots inspected.

## 2026-11-17 - Named physical dispatch and receiving addresses

- Added separate location-name and physical-address entry to registration, Profile add/edit and legacy shipment location setup. Registration binds the address into the wallet signature and stores only encrypted address details; approved Profile drafts include the address. New UI location registration requires both values.
- Location creation/edits keep addresses in existing encrypted private records; owner-only patches preserve the address on legacy name-only edits. Relevant authorized location selectors, production selection and custody routes display name/address while public traceability/catalogue projections remain private-address free. Existing records show a missing-address explanation.
- Existing location IDs, stock, contracts and historical movement records are preserved. Current profile edits do not move goods; use a new location for a different physical site.
- Validation: all 358 API and 325 frontend tests passed with four workers. Shared/API/frontend type checks and the root production build passed. Added tests for signed address binding, encrypted registration persistence, owner-only address editing, address preservation on label-only edits, registration drafts and separate required name/address entry. Tests use synthetic data and simulated pinning; no live files, chain records or keys were changed. Existing Vite bundle/directive warnings remain.

## 2026-11-17 - Consistent required-field markers

- Added shared RequiredLabel/RequiredMarker rendering for public inputs/selects and workspace FormField inputs/selects/textareas. Existing label asterisks are colored without duplication; required public fields without a marker receive one.
- Updated custom registration phone/address/wallet/document, legacy document reattachment, production-location and receipt/evidence-dialog labels. Optional fields and validation rules are preserved. Source audit found no remaining raw JSX asterisks outside the shared marker component.
- Validation: all 324 frontend tests passed with four workers after one phone-selector timeout in the unrestricted parallel run; frontend type checking and production build passed. Headless Chrome confirmed all ten visible registration markers use the same red color, optional logo remains unmarked, and email/phone heights and top coordinates remain aligned.

## 2026-11-17 - Registration phone-field alignment

- Prevented registration grid fields from stretching to a neighbour's helper/error rows and normalized single-line controls to 44 px, preserving multiline address height. Removed extra phone-container vertical padding so the flag and number align with email.
- Country selection no longer automatically focuses/blurs the empty number input or marks it touched; phone validation still runs when the actual phone input is blurred.
- Headless Chrome measurements at 1440 px showed identical email/phone top coordinates, 44 px heights and 455 px widths. At 375 px both controls were 44 px high and 278 px wide with no horizontal overflow; desktop screenshot inspected. Frontend type checking passed.

## 2026-11-17 - Flag and country-name phone dropdown

- Replaced the native phone-country dropdown with a page-specific searchable selector that uses bundled SVG flags. Options display flag plus country name; the closed trigger displays only the selected flag and dropdown arrow, with the country still available to assistive technology.
- Preserved react-phone-number-input formatting/validation and added keyboard selection, Escape/outside-click dismissal, and responsive bounded popup sizing. Fourteen relevant registration/navigation tests and frontend type checking passed. No backend or storage changes.

## 2026-11-17 - International registration phone input

- Installed react-phone-number-input in the web workspace and updated the lockfile. Replaced the sole system phone-entry field (registration contact number) with a country selector, local SVG flags, E.164 form values and max-metadata country-aware validation instead of the generic digit-count regex. Default country is Malaysia; international selection remains available.
- Retained theme colors/field sizing and added accessible required/invalid feedback. Updated registration fixtures to valid international numbers and tested Malaysia/US selection and invalid-number recovery. Thirteen relevant registration/navigation tests passed.

## 2026-11-17 - Explicit registration wallet selection

- Connect MetaMask now requests wallet account permissions before reading the selected account; existing connections can be changed explicitly. Added pending instructions, a success announcement and Change account label, cancellation/pending-request messages and a synchronous duplicate-request guard. The selected wallet is preserved if the user cancels.
- Eleven relevant registration/navigation tests passed, including three new account-selection tests; frontend type checking passed. Tests simulate wallet RPC responses; actual extension popup appearance remains controlled by MetaMask. No login, contract, IPFS or key changes.

## 2026-11-17 — Cross-role workspace UI consistency

- Added one shared stakeholder-overview presentation for Supplier, Manufacturer, Distributor and
  Retailer dashboards, with compact role-specific metrics, readable attention and activity records,
  company/item media fallbacks, explicit review actions and technical identifiers kept secondary.
- Consolidated shipment list presentation across stakeholder routes with four status summaries,
  counted tabs, search, expandable filters, sorting, readable quantities, company routes, logistics
  facts and read-only Review shipment actions. Information requests now share compact request cards,
  party context, next-action wording, filtering and collapsed identifiers; Retailer received products,
  company locations and authenticated traceability received matching responsive presentations.
- Improved stakeholder and Administrator audit readability with record tabs, search, business-first
  cards, summary metrics and collapsed identifiers. Receipt discrepancy management now uses the
  shared page header and summary cards. Existing transaction preparation, MetaMask actions, API
  calls, authorization, QR validation, contracts and deployment state were not changed.

## 2026-11-17 — Manufacturer product presentation and production location

- Added a Product presentation step to real Manufacturer product creation. The stable production
  location selected for accepted ingredient consumption is now also sent as the product's on-chain
  location, while its readable name, optional category, description and indicative currency/unit
  price are integrity-bound in the existing encrypted off-chain product metadata.
- Manufacturers can preview, replace or remove an optional PNG/JPEG/WebP image before submission.
  After the product transaction is confirmed, the image is byte-validated by the API and saved via
  the existing encrypted catalogue-media store. Authenticated responses expose only the safe product
  media route and allowlisted public presentation fields; raw images, CIDs and ciphertext remain
  private.
- Manufacturer list/detail views now display the saved image, readable production location,
  description, category and formatted indicative price. Authenticated custody/catalogue consumers
  receive the same safe summary, and public traceability receives only intended textual presentation
  fields. Existing products keep honest missing-value fallbacks. Product presentation editing remains
  unavailable because the deployed product record has no versioned metadata-update operation; no
  Solidity, deployment, environment or existing chain data changed.

## 2026-11-17 — Compact Manufacturer product inventory

- Replaced the oversized Manufacturer product cards with the existing Supplier/custody inventory
  presentation: compact summary cards, one responsive filter toolbar, a remembered List/Grid
  selector, stable left-aligned three-column cards, compact full-width rows and independent Show
  more/Show less details. Existing detail, transfer, refresh and create navigation remain unchanged.
- Product rows now use the shared authenticated catalogue-image fallback, readable company identity,
  status badges, date/price formatters and collapsed Technical details. Search covers product name,
  batch reference and batch ID; status, expiry, archived visibility and sorting remain client-side and
  do not refetch or change authoritative records.
- Extended the shared operational unit formatter to decode safe bytes32 and custom named units. For
  example, encoded `each` displays as `80 each`, custom `boxes` displays as `25 boxes`, and malformed
  values fall back to `units` while the raw value stays in Technical details. All 312 frontend tests,
  frontend type checking, changed-file formatting and the production build pass. Existing Vite
  bundle/directive warnings remain; no API, contract, environment, deployment or chain data changed.

## 2026-11-17 — Exact-balance product production recovery

- Fixed Manufacturer product confirmation when production consumes the final accepted unit at a
  location. New production still rejects only quantities greater than the exact bigint balance;
  confirmed-product readback now checks the product batch and its stored ingredient links before
  applying pre-transaction availability rules, so a legitimate zero remaining balance is retained
  as historical traceability rather than reported as insufficient stock.
- The product form keeps exact integer unit conversion, displays a locally known zero remaining
  balance when positive-stock queries omit the consumed batch, and treats a mined transaction with
  temporarily unavailable readback as confirmed/pending refresh. The creation action is removed in
  that state and Refresh records performs a read-only idempotent check without another MetaMask
  transaction.
- Regression coverage includes partial, exact and excessive API quantities, zero-balance product
  readback with preserved ingredient links, decimal conversion, duplicate-submission prevention and
  exact on-chain consumption. All 25 production-flow API tests, 308 frontend tests and 62 contract
  tests pass; monorepo type checking and the production build pass. The initial sandboxed Hardhat
  launch hit the known Windows `uv_os_get_passwd` error and the unchanged isolated suite passed
  outside that sandbox. No contract source, deployment, environment or chain state changed.

## 2026-11-16 - Consolidate company management

- Renamed the Admin Company credentials navigation/page to Manage companies. Individual permission editing now exists only inside the selected company Manage details; removed the separate Permissions sidebar entry, Access Control tab and company picker. Role permissions and the permission matrix remain separate.
- Existing /admin/permissions/companies and /admin/personal links resolve to Manage companies. The established /admin/credentials URL remains compatible. Preserved credential lifecycle actions and exact-wallet MetaMask confirmation, with no API/contract changes.
- Validation: ten relevant company permission/navigation/login tests and frontend type checking passed.

## 2026-11-16 - Individual permissions in credential management

- Added the existing individual company permission editor directly to Company Credentials Manage details, locked to the credential subject wallet. Extracted one shared component for the existing Access Control page and credential details; Allow/Deny/Inherit and explicit MetaMask confirmation use the same API/contracts. Role defaults remain separate.
- Normalize role names to exclude System Admin for both enum and display names; revoked/unregistered wallets cannot be selected. Added Refresh permissions for read failures and confirmed-transaction refresh recovery without resending.
- Validation: five relevant UI tests and frontend type checking passed; includes selected-credential wallet binding, confirmation before write and protected Admin handling. No API, contract, deployment or permission-state changes.

## 2026-11-17 — Compact Manufacturer ingredient-order detail

- Replaced the duplicated Manufacturer order-detail headings and generic stacked request card with
  one ingredient-led header, the shared responsive four-stage workflow timeline and a compact
  current-stage / next-action panel. Refreshing and viewing remain read-only.
- Consolidated authenticated ingredient, Supplier, quantity, fulfilment, route, shipment, receipt
  and company-evidence presentation into a compact summary and balanced detail panels. Shipment
  receipt actions appear only for a real linked shipment, while orders awaiting dispatch show an
  explicit waiting state. Wallets, location IDs, hashes and contract references remain inside
  collapsed Technical details.
- Reused the shared company avatar, catalogue image, badge, button, route timeline, alert and
  technical-detail components, including responsive horizontal-to-vertical timeline behaviour.
  Added focused shipment/no-shipment, evidence-separation, status-stage, image-fallback,
  company-name, route, quantity and read-only coverage. All 302 frontend tests, frontend type
  checking, changed-file formatting and the production build pass.

## 2026-11-16 — Distributor ingredient-delivery workspace

- Replaced the Distributor Ingredient deliveries route's plain arranged-order rows and generic
  shipment table with navigation-style status summaries, connected counted tabs, compact search /
  sort controls, expandable detailed filters and structured delivery cards using real ingredient,
  company, warehouse, route, timing and vehicle data. Cards use the shared responsive route timeline
  for Supplier → Distributor warehouse → Manufacturer without changing status calculations.
- Added a read-only review step before physical dispatch, with the shared responsive four-stage
  workflow timeline, company avatars, ingredient imagery, evidence state, explicit MetaMask notice
  and collapsed Technical details. Record dispatch now continues into a matching workflow screen
  with a compact Supplier-to-Distributor-to-Manufacturer route, separate pickup-to-receiving bar,
  conditional missing-location action, structured logistics fields and the existing validated
  MetaMask submission. Opening either step remains read-only and does not prepare or sign.
- Added focused coverage for delivery cards, names, quantity, image fallback, summary/tab filtering,
  expandable company/warehouse filters, status-dependent actions, safe timing fallbacks, responsive
  structure, conditional route actions, true and filtered empty states and transaction safety. All
  300 frontend tests, frontend type checking, focused formatting and the production build pass.

## 2026-11-16 — Consistent custody inventory presentation

- Aligned Distributor Ingredient custody with Supplier My ingredients using the existing compact
  summary cards, combined filters, remembered List/Grid selector, stable three-column grid,
  full-width list rows, authenticated catalogue images, company avatars, status badges and
  independent Show more/Show less interaction.
- Extended the already shared custody-inventory page for Distributor product, Supplier-owned and
  Manufacturer-owned custody records with role-specific wording while preserving their original
  API datasets, wallet scoping, quantity calculations, route parameters and read-only actions.
  Expanded rows use already-loaded data and keep wallets, batch IDs, position IDs and location IDs
  inside collapsed Technical details.
- Extracted only the genuinely shared inventory summary, view-toggle, fact and expand controls for
  Supplier and custody consumers. Added coverage for every shared consumer, view persistence,
  filter preservation, independent expansion and private-stock isolation. All 293 frontend tests,
  frontend type checking and the production build pass after rebuilding the shared workspace's
  generated declarations.

## 2026-11-16 - Admin approval without credential download

- Removed the automatic plaintext Company Role VC download and its helper from application approval. Renamed the approved-application action to Complete credential activation, preserving resumable registry writes. Successful issuance closes the dialog and tells Admin that the company accesses its credential through My Company Identity.
- Preserved encrypted credential storage/retrieval, existing exports/backups and holder recovery. No API, contract or key changes. Five application UI tests passed, including new/resumed approvals without file downloads; frontend type checking passed.

## 2026-11-16 - Registration document storage and review

- Fixed registration hashing filenames without uploading bytes. PDF/PNG/JPEG supporting document contents now participate in the applicant signature, undergo size/type/signature validation and are encrypted before IPFS pinning. Pinning failure prevents transaction preparation.
- Added owner/current-Admin review routes, sandboxed preview/download in Admin application details and company Profile, and pending-applicant review on Login. Added applicant-only legacy reattachment; saved sets cannot be overwritten and original application hashes are preserved.
- Files are stored in encrypted IPFS and an ignored encrypted local cache. No keys, credentials, contracts or old documents were changed. Historical hashes cannot recover missing document bytes.
- Validation: all 345 API tests and 262 frontend tests passed; shared/API/frontend type checks and root production build passed. Six new API security/storage tests and three document UI tests cover separate-company denial, current/pending-owner access, immutable legacy attachment, encrypted restart persistence, signature substitution, malformed/oversized files, storage failure and explicit preview. Tests use temporary encrypted stores and simulated IPFS; no real supporting documents were uploaded. Existing Vite chunk/directive warnings remain.

## 2026-11-16 — Resilient shipment QR image decoding

- Reproduced ZXing's message-less `NotFoundException` in `GridSampler.checkAndNudgePoints` for a
  dense downloaded 57-module shipment QR rendered at 10 pixels per module. The same unchanged
  payload decodes after nearest-neighbour downscaling, confirming an image-sampling failure rather
  than a payload, shipment or authorization problem.
- Hardened the shared QR image reader while retaining the original decode attempt. It now waits for
  image loading, flattens transparency onto white, retries bounded aspect-ratio-preserving sizes and
  a high-contrast variant, optionally uses `BarcodeDetector`, and releases all object URLs, images
  and temporary canvases. Camera scanning and post-decode chain, contract, shipment, recipient and
  status validation remain unchanged.
- Warehouse-arrival uploads now distinguish unreadable/corrupted images from malformed labels and
  shipment/chain/contract mismatches, and show the selected filename with **Shipment QR verified**
  before receipt confirmation is enabled. Added real generated PNG/JPEG/WebP and cleanup regression
  coverage; all 284 frontend tests, frontend type checking and the production build pass.

## 2026-11-16 — Unified transaction workflow details

- Standardized active order, ingredient-delivery, product-delivery, shipment-tracking and Retailer
  receipt details around the same responsive circular progress flow, compact summary, information /
  next-action panels and collapsed Technical details hierarchy.
- Shipment details now reuse one role-aware presentation for Supplier, Manufacturer, Distributor and
  Retailer routes. Existing QR verification, image upload, camera, MetaMask, evidence, inventory and
  role-specific controls are unchanged; the superseded duplicate shipment-detail markup was removed.
- Added focused Retailer receipt coverage. All 271 frontend tests, repository type checking and the
  production build pass. The repository-wide formatter still reports its existing unrelated baseline;
  every file changed for this UI update passes the focused Prettier check.

## 2026-11-16 — Ingredient photo review preview

- Replaced the Supplier ingredient-registration review's filename-only optional-image row with a
  local preview of the already selected file. The contained 200 × 150 px thumbnail shows the whole
  image, keeps the filename below it and returns to ingredient information through Change photo
  without clearing other form values.
- Object URLs are revoked on replacement and unmount. No-photo registration remains supported, and
  image validation, post-registration upload and blockchain registration behavior are unchanged.

## 2026-11-16 — Registration document-selection feedback

- Refined the shared registration document-upload card for all three required proofs and optional
  certifications. Empty cards retain upload guidance; valid PDFs/images show a checkmark, explicit
  **File selected** label, safe wrapping filename and Change file action; rejected files show a
  slot-local validation error without a success state.
- Added a live required-document counter that excludes optional certifications. Selection and
  replacement state survives review-step navigation, remains keyboard accessible and uses icons and
  labels in addition to color. Document storage and submission behavior are unchanged.

## 2026-11-16 ? Remove browser backend-key backup tools

- Removed the Admin audit backup panel, dialogs and dedicated frontend API client. No separate backup page/navigation route was found. Retained audit JSON/CSV exports and printing.
- Removed the dedicated POST /api/ssi/storage-key-backup route, controller, service methods and app secret-export/pin-check wiring after confirming no other workflow uses them. Retained server-only backup-format/pin-check helpers for operator use and existing backup compatibility.
- Preserved environment secrets, encrypted local stores, downloaded backups, credential issuance/verification, IPFS retrieval, SIWE and holder recovery. Added retired-endpoint and Admin audit UI regression coverage.
- Validation: all 334 API tests and 250 frontend tests passed; API/frontend type checks and production builds passed. Live local API returned 404 for both export and restore-check payloads on the retired endpoint. Existing Vite bundle-size/dependency-directive warnings remain. No secrets, encrypted stores or backup files were changed.

## 2026-11-16 — Windows compiler launch fix

- Confirmed Windows Application Control blocks the cached native Solidity 0.8.34 executable, causing Hardhat's compiler subprocess `spawn UNKNOWN` failure. Configured `preferWasm` for both build profiles on Windows, preserving the compiler version, viaIR and per-contract optimizer overrides. No node_modules edits or security-policy changes.
- Validation: forced compilation passed for 15 Solidity files with solc 0.8.34; all 61 contract tests passed (3 Solidity and 58 Mocha); contract TypeScript checking passed. No deployment, environment, account or chain-data change.

## 2026-11-16 — Encrypted SSI cache and separate storage/holder recovery

- Audited plaintext VC-store dependencies: Admin bootstrap and export use IDataStore queries. Moved the Veramo data plugin to an AES-GCM encrypted cache while retaining public DID/key metadata and existing encrypted issuer keys. Migrated the current local public store after encrypted write/read-back; verified zero readable credential/claim/presentation/message collections remain.
- Added authenticated registry-CID retrieval through the configured IPFS gateway for Company Identity, including fresh-session retrieval without a local VC journal/cache. Hash/wallet mismatches fail closed; an unavailable gateway does not silently use cached ciphertext. Existing manual cryptographic/lifecycle verification and SIWE login architecture remain separate.
- Added Admin Audit-report controls to download a portable scrypt/AES-GCM backend-key backup and upload it for restore/pinned-credential checks. No terminal or plaintext key export; only currently authorized Admin can use it. The backup excludes Pinata tokens, MetaMask and holder keys. Verification does not change configuration. No user-password backup is claimed before Admin download.
- Added migration/restart/preservation, encryption/wrong-key/tamper/gateway, same-wallet two-session SIWE retrieval, Admin backup-access and no-terminal UI tests. Extended holder recovery tests to sign a new bound selective presentation with the recovered key and reject an unrelated key. Automated Pinata tests use simulated HTTP with real encryption; live results are recorded separately.
- Added `docs/STORAGE_AND_RECOVERY.md` and optional backend `IPFS_GATEWAY_URL` configuration. Contracts, issued credential contents/IDs, roles, wallet records and stock are preserved. Public-media publishing and moving historical vehicle fields off-chain remain outside this storage-recovery stage.
- Validation: 25 SSI, 334 API and 251 frontend tests passed; root type checking and production build passed. Four backup-dialog mobile/desktop browser checks passed. Live read-only IPFS recovery matched 41 pinned credentials; 4 non-IPFS/unsupported references were skipped. Actual portable backup creation remains an explicit Admin UI download with the user's password, not a claimed automatic export.

## 2026-11-16 — Company-logo review hardening

- Required an applicant-wallet signature for every registration, including applications without a
  logo. The signed message binds the application ID and every submitted field, plus the validated
  logo digest when present. Signature and image-byte validation now finish before metadata or media
  persistence; rejected submissions leave no records. Identical retries are no-ops, while any changed
  signed input conflicts even if it reuses the same profile hash.
- Serialized the complete application-metadata JSON read–modify–write cycle per file while retaining
  temporary-file rename persistence. Concurrent saves through separate repository instances no longer
  lose either application, and existing records remain readable.
- Added shared company-branding state and media revisions. Replacing a logo updates My company
  identity and the workspace header immediately, uses the unchanged authenticated endpoint, bypasses
  an older in-flight media promise and preserves initials fallback. Pending/rejected visibility and
  exact active-application checks remain unchanged.

## 2026-11-16 — Application-bound company branding

- Added an optional Company logo field to registration, separate from supporting documents, with
  PNG/JPEG/WebP selection, 2 MB client guidance, preview, replace/remove and review-screen preview.
  Registration remains valid without a logo.
- Bound pending branding to the exact application ID, applicant wallet, profile hash and image
  digest using an applicant MetaMask signature. The API validates the actual image bytes, encrypts
  the media through the existing off-chain content store and exposes it only to authorized Admin
  application review until the same application becomes the stakeholder's active verified identity.
  Pending or rejected logos remain unavailable through normal stakeholder branding routes.
- Reused `CompanyAvatar` with initials fallback in workspace headers, company identity, catalogues,
  product/ingredient details, order and shipment lists/details, Admin application review and
  authenticated business traceability. Approved-company upload/replace behavior is preserved; no
  logo was added to the public QR page and no contract, credential claim or authorization rule changed.

## 2026-11-16 — Shared stakeholder record layouts and media loading

- Standardized stakeholder inventory lists/details, shipment summaries/details and real-state status
  timelines while retaining role-specific data, actions and API authorization. Manufacturer and
  Distributor inventory now share search/location filtering and quantity facts; Manufacturer,
  Distributor and Retailer shipment rows expose the important parties, route, quantity, ETA and
  status before a read-only detail review.
- Refined Manufacturer product creation and product detail hierarchy, added field-level validation
  and final review, and introduced a fail-closed unit formatter. Known `bytes32` `each` values render
  as units (including `123 units` and `MYR 12.00 per unit`); unknown units are never guessed and raw
  values stay in Technical details. Product orders now show fulfilment choice, and Retailer
  traceability leads with the selected product and batch reference.
- Moved Distributor product dispatch behind **View shipment**. Opening a shipment detail does not
  prepare or sign a transaction; confirmation remains explicit within the detail. Intake offers now
  use the shared icon timeline with the current real state, responsible party and next action.
- Reused `CatalogueImage` with lazy loading and explicit missing/denied/failed states. The existing
  authenticated API media mapping and authorization were already correct; inconsistent rendering
  came from independent duplicate reads and a generic fallback that hid transient/request failures.
  Identical concurrent media and workspace-state requests are now deduplicated without caching later
  refreshes or confirmed stock/shipment updates.
- Comparable six-file UI test runs remained effectively unchanged at 5.25 s before and 5.26 s after;
  deterministic request coverage confirms two simultaneous identical image/state reads now make one
  request instead of two, while a later refresh performs a fresh request. Full validation passed:
  255 frontend tests, repository type checking and production build. The existing QR-image upload
  issue was not changed. Live multi-wallet/chain workflow timing and narrow-screen visual review
  remain manual follow-up checks.

## 2026-11-16 — Fresh product custody-offer inventory fix

- Fixed Manufacturer custody offers for a newly created product batch whose custody inventory has
  not yet been initialized. The original product quantity is considered available only when the
  initialization event is verifiably absent, the authenticated holder is the Manufacturer and the
  selected pickup is the recorded production location.
- Initialized inventory now always uses its actual location balance, including zero. Failed
  initialization-history reads fail closed rather than treating a batch as fresh. Supplier custody
  offers keep their existing ingredient-availability path, and offer creation remains read-only.
- The Manufacturer offer form now shows the validated available units at the selected pickup using
  the existing logistics response. Regression coverage includes fresh 123-unit acceptance of 2,
  excess and wrong-location rejection, initialized zero/insufficient stock and unchanged Supplier
  behavior.

## 2026-11-16 — Single traceability flow

- Removed both direction buttons and their unused state/styles. The batch selector uses the available width; stage details and evidence requests remain accessible. Supplier/Manufacturer/Distributor use forward order, Retailer uses backward order.
- Added coverage for the single flow across all four company roles. Relevant traceability tests, frontend type checking and production build passed. No route/API/contract or data-access changes.

## 2026-11-16 — Exact sidebar selection and timed toasts

- Fixed Received/Sent requests highlighting together: sidebar links now match their exact destination instead of matching child URL prefixes. Added coverage for both directions across all four company roles.
- Set automatic toast dismissal to 4 seconds for success/info and 7 seconds for errors, retaining manual dismissal and inline error details. Fake-timer regression checks ensure messages stay visible until their deadline and then disappear.
- Focused frontend tests, type checking and production build passed. No chain, session, environment or dependency changes.

## 2026-11-16 — Consistent loading, feedback and navigation

- Reused LoadingIndicator for centered page loading across orders, catalogue, stock/custody, shipments, company identity, evidence, reports, administration and dashboard reads. Inline wallet/action spinners remain inline; full route loading uses the same spinner in its full-screen presentation. Replaced standalone skeleton/text-only loading states and added missing initial evidence loaders.
- Added shared dismissible success/error notifications with accessible announcements, duplicate suppression and responsive placement. Notifications remain visible above native modals and after closing them. Existing inline errors remain available. API/UI error formatting extracts safe human-readable messages and handles wallet rejection, stale nonce, insufficient funds and network failures without rendering RPC payloads, private URLs or raw JSON. Confirmed transaction messages remain separate from workflow completion; copy actions also report success/failure.
- Workspace modals now dismiss on backdrop clicks as well as Escape/Close; content clicks remain inside the modal. Workspace logout and confirmed company registration navigate to Login with replacement history. Sessionless workspace entry returns to Login. Logout uses a pending state to prevent an intermediate idle-state redirect before the logout call completes.
- Removed embedded order-direction/back navigation from company-proof management under Sent requests and corrected outgoing proof links from Distributor delivery and Supplier evidence screens. Product shipment links now select the product destination. Supplier traceability has only forward stages; Retailer has only backward stages. Existing API company access boundaries remain unchanged.
- Validation: full frontend suite, frontend type checking and production build pass; see `docs/UI_REFINEMENT.md` for final counts. Browser review passed 192 canonical page/viewport checks and 12 centered-loader/notification/native-modal checks at 320/768/1440px using isolated synthetic responses. No live chain transactions, deployments, dependency or environment changes.

## 2026-11-16 — Separate Received and Sent request contents

- Removed incoming company-proof presentation controls from Manufacturer and Retailer sent ingredient-evidence lists. Incoming company-proof responses remain managed in Received requests; Sent retains outgoing evidence review/verification actions.
- Fixed sidebar request pages to their selected direction and stopped the Supplier Received ingredient section from loading unrelated sent-company-proof data. Existing standalone legacy request views remain compatible.
- Added regression coverage for fixed sidebar directions, Supplier received-only reads and removal of incoming proof controls from sent evidence. Frontend type check, focused tests and production build passed. Login, proof verification and backend authorization are unchanged.

## 2026-11-16 — Role workflows, pickup planning and bidirectional traceability

- Replaced per-page guidance drawers with distinct sidebar destinations: orders by direction, received/sent information requests, custody offers, warehouse arrivals and ingredient/product deliveries. Retailer has product-only shipments; Admin retains company/permission/discrepancy/audit tools. Added order progress and the current next action; overview quick actions remain.
- Added participant-bound encrypted custody offers for Supplier ingredients and Manufacturer products. Assigned Distributor accepts/rejects and schedules pickup before the original sender records physical handoff. Existing exact-QR receiver receipt and stock guards remain authoritative; ingredient receipt records warehouse acceptance and physical arrival as explicit sequential confirmations. No offer or plan credits inventory. Current participant roles, source registration block/deployment binding, routes, integrity, expiry and ownership are checked.
- Reused existing Company Role proof signing, verification and DIDComm for custody-offer sender proof. Bound it to exact offer, batch and participants without inventing on-chain attestations. A requested valid proof is a prerequisite for progression, not automatic acceptance. Added accepted-carrier direct pickup planning; both product and ingredient physical pickup preparation fail closed without a plan.
- Added authenticated bidirectional traceability from current batch links and shipment/receipt events, role-scoped roots, clickable stages and exact-context ingredient-evidence actions. Missing stages are explicit. No confidential inventory, encrypted records, unrelated source fields or signature-verification claims are inferred from the graph.
- Registration collects the initial location name; Profile registers company locations/Distributor warehouses, resumes interrupted warehouse registration and edits owner-only display labels. Original on-chain location IDs/names remain available. Warehouse selection is available when requesting already-received stock; supplier demand projections exclude custody orders to avoid double deductions.
- Added focused API/UI tests for offers, pickup, source/route substitution, expiry, privacy, proof context, traceability, profile ownership, scan-only receipt and failed-service retry. Manual guide: `docs/testing/ROLE_WORKFLOWS_TEST_GUIDE.md`. Browser review passed 192 canonical role/public page checks at 320/768/1440px with isolated synthetic responses. Final suite/build results are recorded in `docs/UI_REFINEMENT.md`.
- No dependency/environment change, live account/ingredient mutation, contract redeployment, commit or push. Earlier pending ProductDelivery deployment/preservation limitations remain; this stage does not reset live records. Offers/plans are server-decryptable off-chain prototype coordination, not on-chain reservations. Multi-wallet/camera testing remains necessary.

## 2026-11-16 — Workspace usability and responsive layout refinement

- Grouped all five role sidebars into task sections while preserving existing routes. Added role-specific overview quick actions and collapsed page guidance. Removed repeated authorized-network banners, improved secondary-text contrast and made the shared content area use available screen width.
- Improved mobile navigation with Escape dismissal, focus containment/restoration, background scroll locking and an inert main area while open. Added wallet-copy feedback, accessible selected-state buttons and larger mobile touch targets. Tables scroll within their own keyboard-accessible regions.
- Shortened order, shipment, custody and information-request introductions; separated company-proof direction guidance; clarified ingredient/product delivery sections and progress. Product creation now groups product details before production-location/received-ingredient selection. Identity status and verification precede collapsed optional logo and signing settings. Audit scope remains visible with detailed provenance available on demand.
- Refined Admin application review/filtering, used actual available company names and fixed the disabled Review button. Empty shipment searches now explain that no matches were found instead of showing an empty table. Existing confirmations, privacy checks, credential verification and transaction behavior are retained.
- Validation: 210 frontend tests passed; frontend type checking and production build passed. Browser checks use isolated synthetic responses, not live blockchain transactions: all role/public pages at 320/768/1440px plus expanded forms/dialogs at 320/375/768/1024/1440/1920px and ingredient/product delivery panels in both themes. See `docs/UI_REFINEMENT.md` for coverage and limits. Existing bundle-size/dependency-directive build warnings remain.
- Updated README. No environment, dependency, API, contract, deployment or live record changes were made for this UI refinement. Prior unrelated work remains intact; no commit or push.

## 2026-11-15 — Manufacturer → Distributor → Retailer product fulfilment

- Implemented Retailer product requests with receiving locations, Manufacturer approve/reject and two fulfilment choices: request a direct Distributor carrier with accept/decline and scanned physical pickup, or reserve sufficient already-received exact-product stock at one Distributor location. Manufacturer → Distributor → Retailer progress, explicit vehicle/actual-time/ETA confirmation, pickup QR and final shipment QR, and Retailer scanned receipt use the existing theme and responsive components. Added Manufacturer Custody inventory and Retailer Shipments navigation. Product creation, ingredient delivery, MetaMask/SIWE and credential issuance are unchanged.
- Added a CustodyTransfer-created ProductDelivery coordinator so Orders/IngredientDelivery remain below deployment limits. Child-only inventory callbacks enforce location/holder ownership, atomic custody reservation, no mixed/double fulfilment, current participant/source authorization and replay protection. Direct pickup debits/reserves Manufacturer stock and records the assigned Distributor as carrier/dispatch confirmer without creating Distributor warehouse stock. Final stock-ledger sender remains Manufacturer for direct mode; existing generic Manufacturer → Retailer transfers remain prohibited. Custody dispatch does not debit Manufacturer again. Only intended Retailer receipt settles stock and completes delivery.
- Added explicit cancellation/expired-reservation release before dispatch, with exactly-once refunds. Dispatched deliveries use receipt/discrepancy reconciliation instead of generic automatic-restock cancellation/rejection; Admin reconciliation cancellation closes the coordinator too. Fixed receipt timestamp ordering so the coordinator records the actual submitted receipt time atomically. Supplier/Manufacturer delivery proof sessions now derive and check the actual presenter role, reuse existing signed Company Role credentials and browser-held selective proofs, and remain bound to the assigned carrier/order/current credential. All proof management stays under Information requests.
- Added product actions/capability discovery to the Orders API and dynamic child ABI lookup. Actual assigned carriers can read their product orders/shipments, without private buyer/seller notes. Manufacturer custody visibility is limited to its own products; Distributor inventory remains wallet-scoped. Added real-contract gateway carrier-read coverage, cryptographic Supplier/Manufacturer proof tests, stock/QR/ownership/expiry/cancellation checks and explicit UI selection/scan/decision tests. Added `docs/testing/PRODUCT_DISTRIBUTOR_RETAILER_FLOW.md`; updated README, project decisions/context and API/contract guidance.
- Validation: 304 API tests, 200 frontend tests and 61 isolated contract tests passed. Contract build, repository type checks and production builds passed; existing bundler size/directive warnings remain. Orders/ingredient deployment limits remain enforced; CustodyTransfer and ProductDelivery deploy normally under Ethereum size limits, without unlimited-size settings.
- Deployment remains pending. The local preservation helper's read-only preflight detected newer live ingredient history (`arrangeFromCustody`, `dispatchCustodyOrder`, `receiveRoadShipment`) and stopped before writes. Replaying historical actual departure before a newly mined approval/arrangement is invalid; no timestamps, current ingredients, temporary accounts, custody/received balances, `.env` or live contracts were reset/replaced in this stage. Enabling the feature on that running dataset needs an expanded preservation-aware migration. No public deployment, commit or push was performed.

## 2026-11-15 — Redeployed local two-mode suite and preserved test records

- User explicitly authorized redeployment and root environment updates while retaining ingredients and temporary accounts. Verified loopback Hardhat chain 31337 without resetting it. Added a restricted, dry-run-by-default standalone redeployment helper; it uses unlocked local test signers, never wallet private keys, new credentials, external uploads or storage/code patching. Unsupported source activity aborts before deployment. Old contracts, Ignition journals and encrypted application/credential/messaging records remain intact.
- Deployed a fresh complete suite and replayed 23 supported original transactions, preserving the ingredient's original ID, hashes/CIDs, dates, quantities/unit/status and Supplier; the physically received 12-unit Distributor custody balance; three location IDs/owners; original approved order ID/details; four company applications and credential records; Admin and four active temporary accounts. Verified 25 source/target state comparisons before editing the seven root `.env` registry addresses. Replay creates new blockchain recording/approval times; original history remains on the old deployment.
- The completed custody intake's two expired proof request/attestation transactions were not replayed as new proof verification. Their original historical records remain on the old child; no credential signature, hash, validity or supporting content was changed. Subsequent proof requests must follow normal fresh challenge/verification rules. Regenerate locator QR labels for the new registry addresses.
- New addresses: StakeholderRegistry `0x70e0bA845a1A0F2DA3359C97E0285013525FFC49`; CredentialRegistry `0x4826533B4897376654Bb4d4AD88B7faFD0C98528`; EvidenceRegistry `0x0E801D84Fa97b50751Dbf25036d067dCf18858bF`; IngredientRegistry `0x8f86403A4DE0BB5791fa46B8e795C547942fE4Cf`; ProductRegistry `0x5eb3Bc0a489C5A8288765d2336659EbCA68FCd00`; CustodyTransfer `0x809d550fca64d94Bd9F66E60752A544199cfAC3D`; SupplyChainOrders `0x4c5859f0F772848b2D91F1D83E2Fe57935348029`. The automatically deployed delivery child reports fulfilment policy 2. Standalone migration manifest: `.tracechain/migrations/2026-11-15T12-20-12-347Z/manifest.json`; this is not an Ignition journal.
- Confirmed real SIWE authorization through the application for Admin, Manufacturer (`0x7099…79C8`), Supplier (`0x3C44…93BC`), Distributor (`0x90F7…b906`) and Retailer (`0x15d3…6A65`). All four Company Identity endpoints returned Active. Supplier ingredient API returned its original batch with decrypted metadata; Supplier/Distributor retained their custody views. Manufacturer/Supplier retained the original order and two-mode capability is true.
- The running API initially retained its old environment. Triggered its development watcher using only server-file mtime, without changing source content or stopping the chain. Confirmed the actual port-3000 API now uses the new Orders address and reports both delivery modes. Existing browser sessions need sign-in after the watcher reload. Contract TypeScript checks and the helper dry run passed; actual migration and application acceptance checks passed. No public deployment, commit or push occurred.

## 2026-11-15 — Supplier-selected direct or custody ingredient fulfilment

- Changed normal Manufacturer ingredient requests to ask the Supplier first, without selecting a Distributor warehouse or reserving custody at placement. Manufacturer chooses its receiving location; Supplier separately approves/rejects, then chooses direct carrier delivery or sufficient existing custody. Preserved explicit earlier custody orders and their reservation-at-placement semantics. Fixed request-only transaction selection so supported ingredient delivery requests are not overwritten with generic requestInterest calldata.
- Reused the direct carrier request/accept/decline, Supplier VP, camera/image QR pickup and Manufacturer receipt flow. Distributor Shipments now exposes direct offers separately from custody intake and warehouse dispatch jobs. Approval/assignment alone does not debit origin stock; direct pickup debits it once. A declined carrier reopens Supplier selection before the original 48-hour deadline, without extending it.
- Added `IngredientDelivery.fulfilmentPolicy() = 2` and owner-only `arrangeFromCustody`: after approval and before carrier assignment/deadline, require sufficient received/unreserved exact-batch stock at one warehouse, validate Manufacturer receiving-location ownership, reserve atomically and arrange the Distributor dispatch job. Reject shortages, wrong parties/locations/batches, conflicting reservations and double/mixed fulfilment. Existing dispatch and receipt accounting are reused; Supplier stock is never debited a second time for custody fulfilment.
- Added API preflight checks and capability reporting; Supplier sees only eligible owned custody positions. Manufacturer catalogue reports Supplier and custody availability separately. Carrier receives only a validated destination projection/label from the request metadata, without buyer/seller private notes. Tracking and final stock credit retain existing role/ownership and scan controls. No login, credential issuance or proof-consent behavior changed.
- Added `docs/testing/TWO_MODE_INGREDIENT_DELIVERY.md`, updated README, source-of-truth decisions/context and API/contract guidance. A fresh complete-suite deployment is required for custody selection after approval; no running network, environment, deployment journal or wallet registration was changed automatically. Direct delivery continues to use its order-bound pickup/receipt records; it does not fabricate a warehouse RoadShipment. Full-order custody selection currently uses one warehouse, with no mixed modes or multi-warehouse split.
- Validation: 300 API tests, 197 frontend tests and 56 isolated contract tests passed. Contract build, repository type checks, production builds and diff whitespace checks passed; existing bundler size/directive warnings remain. Orders runtime is 24,166 bytes and delivery runtime is 23,553 bytes; Orders initcode plus its five constructor addresses is 48,960 bytes, within Ethereum's limit with little remaining headroom. No live transactions, chain reset, commit, push or public deployment were performed. Real MetaMask/camera checks follow the new manual guide after deployment.

## 2026-11-15 — Company ownership and cross-company access review

- Scoped operational API records to the authenticated wallet, retaining actual transfer/evidence participants and existing Admin inspection. Manufacturer owned-product grids and direct detail references also enforce the recorded Manufacturer; another Manufacturer's product cannot become manageable just because it appears in a mixed gateway response. Orders catalogue projections preserve intended buyer discovery while excluding unrelated management records.
- Added API ownership/participant checks before order and logistics transaction preparation or private workflow writes: proposals, closure, evidence linking, recall, product/ingredient dispatch, warehouse decisions, registration, vehicle updates, scanned receipt and rejected-stock return. New order receiving locations must belong to the authenticated buyer; buyer role checks precede storage. Existing contract simulations remain in place.
- Evidence inbox/detail/review reads recheck exact live registry participants and workflow binding before private reads. Inbox context is explicitly whitelisted. Supplier ingredient metadata must match the current owner, hash, credential and CID before decryption, including after a reused batch ID. Unrelated authenticated companies receive only the public traceability projection; owners, actual custody participants and authorized Admin retain technical inspection.
- Reviewed existing credential self-access, company proof participant checks, DIDComm recipient/thread isolation, custody inventory and role routing. Added same-role substitution, foreign product detail, foreign receiving location, wrong shipment recipient, owner/custodian success, stale workflow and metadata isolation regressions. Added `docs/OWNERSHIP_ACCESS_REVIEW.md` with the resource policy, exceptions and a two-company manual test flow; updated README.
- Validation: 290 API tests and 194 frontend tests pass; repository type checks and production builds pass. Existing bundle-size/dependency-directive warnings remain. No contracts were edited for this review, and no deployment, environment change, live transaction, commit or push was performed. Restart/rebuild API/web; no additional deployment is required for these application checks. Public blockchain state/events remain readable outside the app. This review is not a formal security audit; multi-wallet browser verification remains a manual check.

## 2026-11-15 — Private custody pages and centralized company proof requests

- Restricted serialized Orders inventory on the API: a Distributor receives only its own custody positions; Suppliers see only their own supplied batches in custody. Other Distributors' private positions are also excluded from catalogue and product-location projections. Manufacturer ordering retains a minimal public availability summary, without full physical/reserved inventory totals. Existing authorized administrator reads remain unchanged. Public blockchain records are not made confidential by these application checks.
- Added a standalone Custody inventory route for Supplier and Distributor, separate from shipment/transfer tabs, with search, ingredient/product categories, authorized item detail URLs, quantities, reservations, location balances and related shipments. Supplier detail access is limited to its own supplied batches. Shipments no longer embeds inventory controls or inventory rendering.
- Added Information requests navigation for all five stakeholder workspaces. Company credential proofs have participant-filtered Received/Sent tables and context-specific management for custody/delivery, quantity orders and ingredient information. Shipment and ingredient response screens link to the central manager; existing holder signing, cryptographic verification, DIDComm transport and ingredient evidence controls are reused. No login, issuance or contract permissions were changed.
- Added a read-only proof-workflow listing to the existing JSON repository and `GET /api/orders/information-requests`, returning safe request metadata only. Updated Supplier/Retailer canonical Information requests URLs with backward aliases. No SQL/database, contract change, deployment, environment edit, live transaction, commit or push was introduced.
- Validation: 256 API tests and 193 frontend tests passed, including cross-Distributor inventory response checks, Supplier ownership, foreign detail URLs, minimal Manufacturer availability, central inbox filtering, stale/reset-chain proof contexts, linked proof management and explicit verification. Root type checks and production builds passed; existing bundler size/directive warnings remain. Restart/rebuild API/web for the new access filters and routes; no additional contract deployment is required.

## 2026-11-15 — Onboard four test wallets to the newly configured registries

- Restored the requested Manufacturer, Supplier, Distributor and Retailer wallets against the current local chain-31337 StakeholderRegistry (`0xc6e7DF5E7b4f2A278906862b61205850344D4e7d`) and CredentialRegistry (`0x59b670e9fA9D0A427751Af201D676719a970857b`). Reused verified, locally encrypted credentials; the normal login resolver confirmed AUTHORIZED with each expected role. No external uploads, private-key imports, deployment, reset or environment edits were performed.

## 2026-11-15 — Role-specific custody review and Supplier-arranged delivery

- Implemented the confirmed workflow: Supplier sends stock to Distributor custody; Distributor separately requests/verifies Supplier Company Role VP, accepts or rejects custody, then scans and confirms physical receipt. Acceptance alone credits nothing. Rejection leaves stock return-pending; only the original Supplier's scanned physical-return confirmation restores availability, exactly once. Partial rejection/return after acceptance remains outside this narrow flow.
- Manufacturer quantity requests still reserve actual received custody stock at placement. After approval, the Supplier explicitly arranges delivery from its order detail. Only then does a dispatch job appear for the Distributor; arbitrary ingredient/order selection and ingredient onward-transfer controls are removed. The Distributor records vehicle/actual departure/ETA against the order's bound batch, warehouse and Manufacturer location. Contracts reject unapproved, unarranged, expired, wrong-party and backdated-before-arrangement dispatches.
- Supplier now uses Sent shipments / Send to custody; Distributor uses Custody & deliveries / Product transfers, with different headings and actions. Supplier shipment-bound company proof reuses existing holder signing, verification and DIDComm services, with exact sender/recipient/reference authorization. Login and credential issuance are unchanged.
- Removed manual QR entry from current Shipments, legacy ingredient handoff and product receipt scanners. Camera/image upload unlocks receipt confirmation; receiving parties do not get sender QR-print actions. Invalid QR, wrong deployment/reference, unauthorized actor, stale requested proof and replay remain blocked. QR scanning is a UI entry restriction, not cryptographic evidence of physical arrival.
- Added `reviewPolicy() = 1`, custody decisions, Supplier arrangement and original-Supplier return guards to the delivery child. Updated complete-suite deployment is required; current network, addresses, environment, credentials and registrations were not changed. Orders runtime 24,166 bytes/init 47,884 and delivery runtime 22,635 remain within Ethereum limits. Updated README/API/contract context and the manual warehouse flow guide.
- Validation: 249 API tests, 185 frontend tests and all 53 isolated contract tests passed. Repository type checking and production builds passed; existing bundle-size/dependency-directive warnings remain. No commit, push, chain reset or public deployment occurred; real-device/MetaMask testing requires the updated deployment.

## 2026-11-15 — Prevent unselected product transfer crash

- Guarded the dispatch-location filter when no product stock matches the selected batch. Manufacturer transfer forms and Distributor product transfers now render with no eligible dispatch locations and keep submission disabled until stock is selected, instead of reading `locations` on undefined stock.
- Added regressions for empty selection, a stale/missing batch ID and switching Distributor transfers to Products. All 7 shipment workspace tests, frontend type checking and production build passed; existing bundler warnings remain. No contract or deployment changes are required.

## 2026-11-15 — Restore requested test stakeholders

- Ran the existing local-only onboarding helper for the requested Manufacturer, Supplier, Distributor and Retailer wallets, preserving their existing signed, locally encrypted credentials. Completed any missing local registrations and confirmed AUTHORIZED with the expected role through the normal login authorization resolver for all four on chain 31337. No IPFS uploads, private-key imports, deployment, chain reset or environment changes were performed.

## 2026-11-14 — Streamline Supplier custody dispatch and stakeholder inventory visibility

- Updated Supplier ingredient dispatch to custody inventory:
  - Removed the receiving location selector when a Supplier dispatches ingredients to a Distributor warehouse. Suppliers now simply select the authorized Distributor; the destination is automatically bound to the selected Distributor's registered warehouse.
  - Removed the vehicle registration requirement for Supplier custody dispatches. Suppliers dispatch to custody inventory without recording a vehicle number.
  - Added support for the Distributor to record the vehicle registration number upon receipt confirmation or update it after acceptance using `setShipmentVehicle`.
- Enhanced custody inventory visibility for Suppliers:
  - Updated the Custody Inventory view to clearly display which stakeholder (Distributor/custodian) holds custody of the Supplier's ingredient batches across warehouses, with custodian badges, company names, warehouse names, and search filtering across stakeholders.
  - Enriched custody positions in `orders.service.ts` with verified distributor and supplier company names, enabling Suppliers to inspect their custody stock across different stakeholders in both Shipments and Ingredient batch details.
- Contract updates in `IngredientDelivery.sol`:
  - Allowed optional vehicle strings in `dispatchToWarehouse`.
  - Added `receiveRoadShipmentWithVehicle` and `setShipmentVehicle` allowing the Distributor to record or update the vehicle registration upon or after physical receipt.
- Validation: all 51 contract tests, 85 orders API tests, and 177 frontend tests passed; monorepo typecheck and production builds passed cleanly.

## 2026-11-14 — Register temporary local test stakeholders

- Ran the local onboarding helper for the four requested wallets:
  - `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`: `MANUFACTURER`
  - `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`: `SUPPLIER`
  - `0x90F79bf6EB2c4f870365E785982E1f101E93b906`: `DISTRIBUTOR`
  - `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65`: `RETAILER`
- Verified and reused existing signed, locally encrypted Company Role credentials and completed application/registration against the configured local chain-31337 registries.
- The normal login authorization resolver confirmed `AUTHORIZED` with the expected role for all four wallets. No private keys, IPFS uploads, chain reset, or environment modifications were performed.

## 2026-11-13 — Clarify Distributor selection and shipment legs

- Updated the unified Shipments workspace so a Supplier must select an authorized on-chain Distributor before selecting a receiving warehouse. Warehouse choices are filtered to that Distributor, and the dispatch route makes the Supplier → Distributor handoff explicit.
- Removed the legacy Distributor Incoming shipments screen from workspace routing and exports. Distributor, Supplier and Manufacturer now use the unified Ingredient/Product Shipments and Transfers views, with separate status labels for the two ingredient shipment legs.
- Validation: web typecheck passed and all 177 frontend tests passed.

## 2026-11-13 — Restore requested local test stakeholders

- Ran the existing local-only onboarding helper for the four requested wallets, in order: Manufacturer, Supplier, Distributor and Retailer. Reused cryptographically verified, locally encrypted Company Role credentials and completed any missing registration against the configured localhost chain 31337. The normal login authorization resolver confirmed AUTHORIZED with the expected role for all four. No private-key imports, IPFS uploads, chain reset, deployment or environment changes were made.

## 2026-11-13 — Warehouse-first custody, reservations and unified shipments

- Implemented Supplier warehouse stocking, Distributor physical-receipt custody and Manufacturer orders limited to that warehouse's received, unreserved stock. Reservation occurs atomically at placement, per the user's answer; rejection/expiry releases undispatched amounts. Supplier remains seller and is debited once at initial dispatch. Manufacturer receipt alone credits production inventory; existing multi-ingredient production and optional evidence remain.
- Added on-chain road shipment/order references, original batch/unit, locations, vehicle, actual departure/receipt times, ETA, separate block recording times, sender, partial totals and product location balances. Parent source validation delegates to its immutable child to preserve deployment limits: Orders runtime 24,022 bytes (init 44,667), IngredientDelivery runtime 19,600 and CustodyTransfer runtime 17,626. One-time wiring requires a fresh complete suite; current deployment/environment are unchanged.
- Added responsive themed Ingredient/Product Shipments, custody inventory, approved orders ready to dispatch, Supplier/Manufacturer/Distributor Transfers, warehouse/location setup, camera/image/link QR validation and explicit physical confirmation. Old Distributor orders/incoming/ingredient-delivery links redirect to Shipments. Details distinguish Distributor storage from production origin. Custodians cannot read confidential buyer/seller notes, including before Supplier approval.
- Existing SIWE login, credential issuance, holder-signed company evidence, legacy records and product reconciliation remain separate. Manual setup/test guide: docs/testing/WAREHOUSE_CUSTODY_FLOW.md. Ingredient shortage/returns/warehouse relocation still need dedicated reconciliation UI. No live transactions, reset, account registration, secret output, commit or push were performed.
- Validation: 247 API, 177 frontend, 43 shared and 23 SSI tests passed; all 51 contract tests (48 Mocha + 3 Solidity) passed with Ethereum size enforcement. Root type checks and production builds pass. Existing bundler size/directive warnings remain. Phone/MetaMask acceptance testing still requires the new deployment.

## 2026-11-12 — Distributor delivery navigation

- Removed Distributor Browse & requests navigation, retained Ingredient deliveries and existing finished-product shipment/inventory/transfer pages, and redirected old `/distributor/orders` links to the delivery-management page while preserving query parameters. Distributor screen routing now uses management mode even for old internal orders links; no backend or contract permissions were changed.

## 2026-11-12 — Restore four requested local stakeholder accounts

- Re-ran local onboarding for the requested wallets, mapped in order to Manufacturer, Supplier, Distributor and Retailer. Verified and reused their existing signed, locally encrypted Company Role credentials and application profiles; completed any missing on-chain onboarding against the configured chain-31337 registries.
- The normal login authorization resolver confirmed AUTHORIZED with the requested role for all four wallets. No private wallet keys were imported, no IPFS upload or public-chain transaction occurred, and existing credentials, expiry dates, deployment addresses and unrelated work were preserved. Resetting the local chain removes its registrations again.

## 2026-11-12 — Distributor-assisted ingredient delivery

- Implemented the user-requested Supplier → Distributor → Manufacturer handoff with the user-selected 48-hour assignment deadline (capped by request expiry), explicit Distributor acceptance/withdrawal, scanned pickup and Manufacturer scanned/partial receipt. Supplier approval creates the printable QR prompt; only physical pickup allocates source stock, and received quantities are credited without double debit. Missed deadlines cancel effectively through contract reads/action guards; optional expiry finalization records a transaction/event without inventing a timer service.
- Added an automatically created IngredientDelivery child contract, module discovery through Orders, direct actor/role/permission guards, events, challenge/hash proof attestations, request-bound QR validation on both client/API, responsive theme-matched tracking and a Distributor Ingredient deliveries page. Existing SIWE login, finished-product custody, optional Ingredient evidence and legacy receipt records are preserved. Contracts are not deployed or environment addresses changed automatically.
- Reused actual Company Role VC verification, authority-derived selective proofs/full-disclosure fallback, participant-held holder signing and backend DIDComm authcrypt for optional Distributor-requested Supplier company evidence. Proof, acceptance, pickup and receipt remain separate. Interrupted proof-request signing can resume the same challenge; expired proofs can be renewed. Cross-company routes hide unrelated order notes/decision reasons.
- Added contract, QR, API/UI, current-authorization/expiry/replay and real browser-signer + authority-signed Supplier VC integration regressions. Deployment, stock arithmetic, phone/local URL setup, manual test steps and current exception-flow limitations are documented in docs/testing/INGREDIENT_DISTRIBUTOR_DELIVERY.md.
- Final validation: 239 API tests, 172 frontend tests, 39 shared tests, 23 SSI tests and all 47 isolated contract tests passed; repository-wide type checks, root production builds and the final frontend build passed. API/frontend full-suite runs used four workers to avoid host oversubscription. The real proof test follows the actual clock for browser key-binding JWTs instead of freezing time before signing. Orders runtime is 24,522 bytes and the delivery module runtime is 7,631 bytes, below the enforced Ethereum size limit. Existing chunk-size/dependency-directive build warnings remain. No live-network deployment, account re-registration, commit or push was performed.

## 2026-11-12 — Merge Supplier inventory and request design

- Resolved six merge conflicts by retaining the incoming compact Supplier ingredient inventory, request review dialogs and document-assisted registration alongside the existing Manufacturer physical receipt controls, Supplier remaining-stock projections and partial/full receipt statuses. Combined both branches' confirmed decisions and progress records without adding an architectural decision.
- Preserved both navigation and stock regressions, added receipt-status coverage for the redesigned inbox, and installed the already-declared document-extraction dependencies. No commits, deployments or live-chain writes were performed.
- Validation: 161 frontend tests, 72 Orders API tests and 10 document-extraction API tests passed, along with repository-wide type checks, root production builds and whitespace checks. Existing bundler warnings remain. Conflict resolutions are staged; the merge commit is left to the user.

## 2026-11-12 — Product detail QR configuration error

- Added the missing public application origin to the ignored local root environment for browser testing. Production labels still require an explicitly configured, externally reachable origin; no automatic production URL is invented.
- Fixed Manufacturer product-detail metadata loading to catch synchronous QR configuration failures as well as asynchronous resolver failures. The existing QR section reports configuration errors while on-chain product records and ingredient navigation remain usable.
- Added regressions for missing QR configuration, resolver outages and successful metadata/QR rendering. No contract changes or redeployment are required; restart Vite to pick up environment edits.

## 2026-11-12 — Supplier remaining stock after ingredient requests

- Added Supplier-only stock projections to authenticated Orders state and displayed them in owned ingredient cards and Supplier order details using the existing theme and responsive layout. Values come from registered batch balances and current on-chain request decisions, batch bindings, expiry and confirmed received quantities, with exact bigint arithmetic.
- Show current stock, pending demand, approved quantities awaiting receipt, remaining after open requests and any demand shortfall. Rejecting, expiring or completing a request removes its outstanding demand. Partial receipts count only the unreceived remainder, avoiding double deductions. Legacy physical orders already reserving stock are excluded, and legacy multi-batch requests without a trustworthy binding show an unavailable projection rather than guessed stock.
- This is a read-only demand estimate: requests/approvals still do not reserve or transfer stock. Manufacturer physical receipt continues to debit Supplier stock atomically. No contracts, credentials, keys, root environment or live-chain records were changed.
- Validation: Supplier demand arithmetic and privacy regressions, ingredient-card/order-detail integration, full frontend suite, root type checks and production builds. Existing dependency directive/chunk-size build warnings remain. Manual receipt/partial-receipt/shortfall checks are documented in `docs/testing/MANUFACTURER_REQUESTS.md`.

## 2026-11-12 — Receipt preparation on an idle local chain

- Reproduced the Manufacturer receipt conflict using read-only calls: the latest local block predated wall clock by over two minutes, so latest-state staticCall rejected the actual receipt timestamp as future. The identical receipt succeeds against pending state and normal gas estimation. Order approval, location and stock were valid.
- Changed the Orders gateway preflight to pending-state simulation. Kept the supplied receipt time, contract future-time checks, role/location/stock validation and explicit wallet confirmation; no clock clamping, manual mining, contract change or running-chain transaction was performed.
- Added an isolated end-to-end gateway regression with a receipt later than the latest block, asserting that preparation preserves the timestamp and neither mines nor credits stock. Validation: 65 Orders API tests, 19 scoped contract tests, API build and API/web/contracts type checking passed. No redeployment is required for this API-only fix.

## 2026-11-12 — Optional ingredient evidence after receipt

- Updated the user-confirmed production rule: confirmed received ingredients can be selected and consumed without requesting or accepting an Ingredient presentation. The API and receipt-backed ProductRegistry path no longer gate production on accepted evidence; valid ingredient/credential lifecycle, Manufacturer permission, owned production location, available received quantities and atomic deductions remain mandatory. Existing optional evidence request, verification and acceptance flows are unchanged and no verification result is fabricated.
- Added a production-purpose ingredient query that requires REGISTER_PRODUCT instead of REQUEST_EVIDENCE and does not load evidence acceptance. The product form lists received balances directly, supports multiple unverified-by-presentation inputs and keeps stock/unit validation. Legacy integrations with no receipt ledger preserve their previous security gate.
- Added ProductRegistry.receivedProductionPolicy and a preparation-time capability check with a specific deployment-update error. Existing deployed bytecode is unchanged; this policy requires the updated full suite with fresh deployment ID/addresses because the existing contract wiring is configured once. Existing accounts, credentials, keys, .env and running chain are untouched.
- Validation: 139 frontend tests, 211 API tests, 39 isolated contract tests, root type checks and production builds passed. Tests include no evidence permission/query, production without any Ingredient evidence request, unchanged evidence status, rejection before physical receipt, quantity limits and recall blocking. The first compiler process failed to start; retry compiled and passed the complete suite. Existing bundler warnings remain.

## 2026-11-12 — Register four local test stakeholder roles

- Re-ran local restoration at the user's follow-up request after the optional-evidence changes. All four existing signed test credentials were verified and all four wallets again passed normal login authorization against the currently configured local registry; no IPFS uploads, public transactions, key changes or configuration changes were made.

- Registered the user-listed wallets in order as Manufacturer (0x70997970C51812dc3A010C7d01b50e0d17dc79C8), Supplier (0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC), Distributor (0x90F79bf6EB2c4f870365E785982E1f101E93b906) and Retailer (0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65) against the currently configured local chain-31337 registry, where all four were unregistered.
- Reused the existing Manufacturer/Supplier credentials and encrypted application profiles without overwriting history. Issued and verified synthetic temporary Distributor/Retailer Company Role credentials, encrypted them locally and completed application/credential registration and approval using unlocked local accounts. New credentials expire after approximately 30 days; existing credential expiries were preserved.
- The normal GatewayLoginAuthorizationResolver returned AUTHORIZED with the correct role for all four accounts. No wallet private keys were imported, no IPFS upload or public-chain transaction occurred, and contract addresses/configuration were unchanged. Local chain resets remove these registrations; changing registries requires registration against that registry.

## 2026-11-12 — Explain unavailable Manufacturer receipt action

- Read-only diagnosis confirmed the user's 12 g request is approved on local chain 31337, while the running SupplyChainOrders has no approvedReceiptPolicy capability. The updated receipt source is served by the web dev server; no chain, environment or deployment changes were made.
- Made Manufacturer receipt status visible even when ingredient metadata is missing or approval is still pending, with an explicit deployment-update explanation for the old contract. Company-evidence navigation is now shown only when a nonzero identity challenge exists and is labelled Respond to company evidence request, rather than appearing as an unrelated action on every order.
- Added a regression for the approved/old-deployment/missing-metadata case. Receipt and company identity remain separate; no approval or receipt is fabricated.
- Validation: 139 frontend tests and frontend production build/type checking passed, with the existing bundler warnings.

## 2026-11-12 — Confirmed receipts and multiple production ingredients

- The user confirmed that Supplier approval must not credit stock until the Manufacturer confirms physical receipt. Added an explicit approved-request receipt action with an owned receiving location, quantity, occurrence time and confirmation declaration. Supplier stock debit, Manufacturer credit and request totals update atomically; partial receipts are capped by the outstanding approved amount, and receipt IDs cannot be reused. Legacy reservation/dispatch behavior is preserved.
- Added the SupplyChainOrders receipt policy getter, exact requested-batch binding, receipt totals and audit event. API preparation validates role/ownership, approval/state/deadline, source validity/stock, event time, owned location and outstanding amount; older deployments return a specific update message instead of fabricated stock.
- Product creation now offers explicit multiple-ingredient selection, separate output-unit choice, exact compatible input-unit conversion and per-ingredient remaining previews. It reads the authenticated Manufacturer's stock at the selected production location, decodes registered units, rejects duplicate links/overspending and reloads real balances after confirmation. Supplier approval and physical receipt remain separate from credential/evidence verification and acceptance.
- Validation: 138 frontend tests, 210 API tests and 38 isolated contract tests passed; root type checks and builds passed. New tests cover exact g/kg and ml/litre conversion, multiple ingredient debit with atomic rollback, location-specific balances, duplicate ingredients/receipts, role isolation and explicit receipt confirmation. Existing bundle/apg-js warnings remain. Live deployment and wallet transactions were not performed.
- Deployment: the new receipt capability requires a fresh full suite because ledger wiring is configured once. Existing chain state, journals, root .env, credentials and keys are untouched. Updated README and docs/testing/MANUFACTURER_REQUESTS.md include the deployment prerequisite and the 5000 g / 3000 ml consumption test flow.

## 2026-11-12 — Company-evidence messaging recovery

- Diagnosed the Supplier's missing-thread error: stored backend company agents retained reversed historical roles, while the earlier ingredient-request notification was absent for the new request. Updated agent role/name metadata from current authenticated participants without replacing the DID, encrypted key or history.
- Allowed company-identity requests to start an encrypted business-linked thread when the ingredient notification is missing, only after confirming the exact current on-chain request, matching persisted request hashes/reference/batch/parties, current authorization and an unexpired REQUESTED identity challenge. Explicit wrong parents, unrelated recipients/threads and response replay remain rejected. Replies must bind to the real newly delivered identity-request message; no Manufacturer message or VP is fabricated.
- Added current-chain validation to ingredient messaging context resolution so old workflow records after chain reset cannot authorize delivery. Retrying an existing pending identity request preserves its challenge instead of invalidating an in-progress presentation.
- Validation: 206 API tests and API type checking passed, including real encrypted request/reply packing, metadata refresh with historical decryption, missing source notification, idempotent delivery, invalid participants/parent/thread/expiry and stale/cancelled on-chain context. No contract, login, key reset or deployment change. Restart the API and retry Request Company Identity Proof; the live user's action still requires their session.

## 2026-11-12 — Restore temporary test accounts after local chain reset

- Confirmed both requested wallets were unregistered on the current local chain 31337. Cryptographically verified and reused their existing locally encrypted Company Role credentials, then submitted applications, registered the credentials and approved the Manufacturer (0x70997970C51812dc3A010C7d01b50e0d17dc79C8) and Supplier (0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC) through unlocked local test accounts.
- Preserved credential expiry, existing issuance history, secrets and deployment configuration. Saved only encrypted synthetic application profiles locally; no IPFS upload or public-chain transaction occurred. The normal login authorization resolver confirmed AUTHORIZED for both requested roles. Resetting the local chain removes these registrations again.

## 2026-11-12 — Supplier document-assisted ingredient registration

- Added an authenticated Supplier-only `POST /api/ingredients/extract-document` endpoint with the existing current-role, Company Role credential and ingredient permission checks. Uploads are limited to one 10 MB file, processed in memory, signature/MIME/extension checked and never persisted or uploaded to IPFS.
- Added modular embedded-text extraction for text PDFs, paragraph/table text extraction for DOCX, bundled local English OCR for PNG/JPEG, independent alias-based ingredient-field mapping, registration-schema validation, per-field High/Review required/Missing confidence and safe warnings. Scanned PDFs without usable embedded text return an explicit PNG/JPG or manual-entry instruction.
- Added a drag-and-drop/manual choice to Supplier registration, extraction progress and failure states, editable prefilling, missing-field highlighting, safe filename metadata, the required accuracy confirmation and the supplier-claim limitation. The existing credential issuance, MetaMask transactions and on-chain verification do not start during extraction.
- Added focused API and frontend coverage for formats, OCR confidence, aliases, invalid values, authentication/role denial, size/type mismatch, in-memory cleanup, no registration side effects, manual fallback, loading/errors and the review-confirmation gate.
- Validation: 10 document-extraction API tests, 6 existing ingredient-batch API tests, 23 SSI package tests, 12 SSI API tests and all 149 frontend tests passed. Repository-wide type checks and production builds passed, changed-file formatting and diff checks passed, and a local bundled-OCR smoke check completed without a network service. Existing Vite bundle-size/directive warnings remain. `npm audit --omit=dev` reports the existing moderate transitive Veramo/MetaMask findings; the new extraction dependencies were not in those advisory paths.

## 2026-11-12 — Supplier page density refinement

- Compacted the Ingredient batches summary, filter toolbar, result heading and card internals with page-scoped styles. The ingredient grid now uses auto-fit tracks at desktop widths so one or two records use the available row sensibly, while tablet and mobile layouts retain two and one columns without changing inventory, listing or image behavior.
- Consolidated the Order requests heading and Refresh action, replaced the duplicate status-tab row with five keyboard-accessible clickable summary filters including All requests, and kept search, sort and result count in one compact toolbar. Request cards use the existing four-section desktop structure with reduced padding/gaps and no fixed clipping height.
- Removed the redundant authorized-connection sentence from the Supplier Ingredient batches and Order requests pages only; the shared workspace header remains authoritative and unauthorized/error messaging is unchanged. Request IDs, wallets, batch IDs and transaction identifiers were removed from list cards and remain available in the review modal's collapsed Technical details.
- Updated focused regressions for summary filtering, absence of duplicate tabs, modal-only technical identifiers and unchanged request/listing actions. No backend, contract, authentication, SSI, DIDComm, request-state or transaction behavior changed.
- Validation: all 146 frontend tests, repository-wide type checks, the root production build, changed-file Prettier checks and `git diff --check` passed. The production CSS compiles the requested 320/375/768/1024/1440/1920 density transitions; screenshot-based overflow inspection could not run because the browser/native automation hosts were unavailable. The repository-wide Prettier command still reports the existing 197-file formatting backlog outside these changed files.

## 2026-11-12 — Supplier Ingredient batches inventory UI

- Redesigned Ingredient batches as a responsive authenticated inventory page with real active, available, expiring-soon and archived summaries; mixed quantity units are never combined. Added name/reference search, category and lifecycle filters, four sort modes, archived visibility, clear filters and a visible result count.
- Replaced full-width text cards with a three/two/one-column ingredient grid using the existing protected CatalogueImage path and equal-size category fallbacks. Cards keep readable identity, origin, quantity/unit, indicative price, dates and credential state prominent while wallet addresses and hashes remain out of the grid.
- Added a single-scroll structured detail dialog with Supplier presentation-data boundaries, inventory/listing/date groups, collapsed technical details, image upload/change, listing edit and reversible archive/restore controls. Corrected the old Delete wording because the operation only archives a listing and preserves credentials and traceability.
- Grouped registration into basic details, origin/dates, quantity/price, immutable credential claims and an optional presentation image. The existing two-step MetaMask review now explains which values become signed/on-chain records and which listing fields remain editable; a failed optional image upload does not misreport a confirmed batch registration as failed.
- Added focused frontend coverage for calculated summaries, mixed units, search/filter/sort/reset behavior, archived views, media fallbacks, long values, quantities, expiry warnings, credential state, collapsed technical details, safe image rejection, loading/empty/RPC states and the absence of technical identifiers or fixture data from cards. No backend, contract, authentication, SSI, DIDComm, deployment or API business rule changed.
- Validation: all 146 frontend tests, repository-wide type checks, the root production build, changed-file Prettier checks and `git diff --check` passed. The requested 320/375/768/1024/1440/1920 breakpoints are encoded as a one/two/three-column grid and compiled successfully; the browser automation host was unavailable for screenshot-based visual inspection. The repository-wide Prettier check still reports the existing 197-file formatting backlog outside these changed files.

## 2026-11-12 — Supplier Order requests inbox

- Renamed Supplier Manage orders to Order requests and replaced the repeated heading/table layout with one Incoming quantity requests page, real calculated summary counts, status tabs, search, four sorting modes and one responsive row-card list. Ingredient images, Manufacturer initials, readable names, quantities, dates, deadline warnings and next actions stay prominent; wallets and technical IDs remain collapsed.
- Reused the shared single-scroll modal for structured request review, including ingredient/Manufacturer context, workflow and company-evidence state, explicit next action, existing confirmation-gated approve/reject controls and company-evidence navigation. Approval remains a decision record only and cannot reserve stock, take payment or dispatch goods.
- Refined each request into one compact responsive row: a prominent undistorted ingredient image, item and larger Manufacturer identity together, compact quantity/date facts, and status/next action/review controls together. Technical details remain collapsed without reserving a blank column and expand into a responsive identifier grid below the row.
- Added focused frontend coverage for summaries, attention/evidence filtering, search/sorting, long names, media fallbacks, responsive structures, technical-detail boundaries, loading/empty/API/RPC states, confirmation gates and duplicate decision prevention. No backend, contract, authentication, SSI, DIDComm, deployment or storage behavior changed.
- Validation: all 141 frontend tests, repository-wide type checks, the root production build, changed-file Prettier checks and `git diff --check` passed. The repository-wide Prettier check still reports the existing formatting backlog outside these changed files; browser automation was unavailable for screenshot capture in this session.

## 2026-11-12 — Resolve Orders page merge

- Reconciled the Manufacturer Products/My orders changes with the catalogue/media and responsive request-summary redesign. Preserved browse/manage modes, ingredient-only discovery in Products, linked-batch detail opening, sent/received filtering, Supplier and Manufacturer decisions, company-proof handling, duplicate-submit protection and collapsed technical identifiers.
- Connected linked-batch navigation to the new catalogue dialog and retained request-ID search in the responsive overview. Updated conflicting UI regressions for the dialog controls and desktop/mobile request layouts. No backend, contract, credential or environment edits were needed for the resolution.
- Validation: 133 frontend tests passed, repository-wide type checks passed and the frontend production build passed with the existing bundle-size/apg-js warnings. No commit, push or deployment was performed.

## 2026-11-12 — Manufacturer products, orders and information requests

- Replaced Manufacturer Browse navigation with Products, My orders and Information requests. Products contains searchable owned-product and Supplier-ingredient grids, with real registered metadata, quantities/units, dates, status and available indicative prices. Product detail links open the exact linked ingredient's detail/request view. Legacy Ingredient evidence routes redirect to Information requests.
- Reused existing preparation, MetaMask submission and encrypted evidence delivery to request ingredient information or quantities from ingredient details. My orders separates sent Supplier requests and received buyer requests in tables, with detail review, explicit seller approval/rejection confirmation and links to company-evidence management.
- Added Manufacturer Received/Sent information-request tables. Received company proofs cover both Supplier ingredient-information and quantity-request challenges. Sent ingredient requests expose actual requested claims/reason and preserve separate View, Verify and Accept/Reject actions; sent company proofs from product buyers reuse existing order identity handling. Missing services/statuses show explicit partial-load errors rather than fabricated verification results.
- Preserved SIWE, browser holder presentation signing, backend DIDComm, tenant checks, contract authorization and physical-stock requirements. Quantity requests/decisions never credit stock; production still requires accepted physical receipts. No contract, deployment, environment or dependency change was required.
- Validation: all 125 frontend tests, repository-wide type checks and frontend production build passed. Browser checks of grids, detail/request forms and sent/received tables passed at 375, 768 and 1440 pixels without horizontal page overflow, using isolated synthetic service responses for layout review. Existing bundle-size/apg-js warnings remain. Live multi-wallet transactions were not sent; the manual checklist is in docs/testing/MANUFACTURER_REQUESTS.md.

## 2026-11-12 — B2B Browse & requests catalogue redesign

- Replaced the sparse Browse & requests grid with a responsive one-to-four-column catalogue containing search, item type/category/origin/credential/availability filters, sorting, clear filters, result counts, lifecycle and credential summaries, verified company names, long-name handling, image/logo fallbacks, safe empty/error/loading states and an accessible detail dialog. Quantity and evidence requests remain separate and reuse the existing MetaMask and consent/verification flows.
- Added a responsive My requests overview with a compact desktop table and mobile cards, readable counterpart names, status and next-action summaries, while keeping request IDs and wallet addresses in collapsed technical details. No cart, checkout, payment, stock reservation or automatic fulfilment was introduced.
- Added optional Supplier-owned ingredient images and authenticated own-company logos. The API restricts PNG/JPEG/WebP files to 2 MB, validates MIME/extension/binary dimensions, encrypts presentation records through the existing content store, checks authoritative ownership, and returns only safe authenticated media routes rather than CIDs, ciphertext or keys. Images remain Supplier/company presentation data and do not alter signed credentials or authorization.
- Added focused API and frontend coverage for upload validation, tenant isolation, safe responses, catalogue search/filter/empty/loading/error behavior, request validation, desktop/mobile structures, Supplier image upload and company-logo ownership. Documentation now records the security and request-only boundaries. No contract, SSI issuance, deployment, environment file, commit or push was performed.
- Validation: root build and typecheck passed; 63 Orders API, 6 ingredient-batch, 15 production-flow and 122 frontend tests passed; changed-file Prettier and `git diff --check` passed. The unchanged Hardhat sub-suite invoked by `test:orders` could not start because the local Windows Hardhat/compiler cache was locked after `uv_os_get_passwd` returned `ENOMEM`; API and web portions of that command passed, and no Solidity files were changed.

## 2026-11-12 — Tailwind styling migration

- Added Tailwind CSS and its official Vite plugin (tested with 4.3.5). Centralized utility generation and inline aliases for the existing public/workspace color and font tokens in `apps/web/src/styles/tailwind.css`. Kept the current reset instead of Preflight.
- Migrated 1,560 layout/spacing/typography declarations across all seven existing frontend stylesheets to Tailwind `@apply` within the components layer. Retained existing selectors and media/container breakpoints, theme variables, effects, animations, print rules and specialized CSS. Shared buttons, cards, form controls, tables, section headings, badges and alerts now use utility classes; runtime colors and caller style overrides remain supported.
- Preserved the current page designs and behavior. An ignored isolated headless-browser harness compared the previous source with migrated shared controls in both workspace themes and login/registration screens at 375, 1024 and 1440 pixels. Those sampled element dimensions, positions, colors, font sizes and padding matched, with no viewport overflow. This is representative coverage, not an assertion that every page/state received manual visual review.
- Validation: 116 frontend tests passed, repository-wide type checks passed, and the frontend production build passed. Existing large-bundle and apg-js directive warnings remain. No environment, credential, contract, authentication or deployment changes were needed.

## 2026-11-12 — Temporary local Manufacturer and Supplier accounts

- Registered the user-requested 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 as Manufacturer and 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC as Supplier on local chain 31337, with temporary synthetic test-company identities expiring in approximately 30 days.
- Issued and cryptographically verified actual Company Role VCs using the existing authority, saved encrypted payloads in ignored local issuance storage, and approved/activated matching on-chain records through unlocked local test accounts. No private wallet keys were imported or exposed.
- Automatic approval review rejected the initial encrypted IPFS upload plan. The user chose local preparation; the completed setup used local encrypted content references/files only, with no IPFS upload or public-network transaction. Existing API decryption reads the stored encrypted payloads; these local references are not distributed IPFS CIDs.
- Synchronized seven stale public .env addresses to the already deployed current local suite, preserving secrets and existing records. Both accounts passed the normal login authorization resolver as AUTHORIZED with their requested roles. API restart and fresh SIWE sign-in are required to reload configuration; resetting the local chain removes these on-chain registrations.

## 2026-11-12 — Supplier ingredient management and incoming order decisions

- Replaced Supplier browsing with an owned, searchable ingredient grid. Added explicit edit/delete confirmation, archived filtering and restore. Supplier detail views distinguish the current business listing from original credential fields. Shared cards, responsive forms, badges, icons and internally scrolling paginated tables retain the system theme.
- Added owner/permission-protected on-chain listing metadata references, optimistic expected-hash edit checks and reversible archive state. Listing name/category/description/price can change without rewriting signed VCs, quantities or units. Archived sources remain traceable for existing products but cannot receive new requestInterest submissions.
- Added Supplier My orders table/details with real Manufacturer, ingredient, quantity/unit, deadline, private note and approve/reject/request-company-evidence actions. Decisions are recorded once on-chain, reasons remain encrypted off-chain with authoritative hash/CID matching, rejection closes the request and neither decision reserves or dispatches stock.
- Split Information requests into Received ingredient-evidence requests and Sent company-proof requests linked to quantity or ingredient-evidence contexts. Company evidence management lives there; proof verification and order approval remain separate. Partial load errors are displayed instead of fabricating request or verification data.
- Added ABI/schema/preparation/discovery updates using existing IPFS and atomic workflow storage. Current request-only restrictions, SIWE, holder signatures, backend DIDComm and history are preserved. Updated full-suite deployment is required; running chains, addresses, secrets and journals were not changed.
- Validation: 116 frontend tests, 199 API tests and 36 contract tests passed; all workspace type checks and production builds passed. Tests cover tenant/permission denial, stale edits, archive/restore, unchanged credential/source data, blocked archived requests, duplicate decisions, unchanged inventory, confirmation controls and received/sent table separation. Contract tests ran on an isolated network. No public deployment, commit or push occurred.

## 2026-11-11 — Restore local Admin authorization configuration

- Diagnosed successful wallet authentication followed by UNAVAILABLE authorization: chain 31337 was running, but the configured StakeholderRegistry address had no deployed code.
- Verified both saved local suites against live public bytecode and registry references, then synchronized the seven ignored root .env contract addresses to the newer tracechain-local suite. RPC/chain settings, secrets, deployment journals and chain state were preserved.
- Confirmed the suite administrator resolves to role 1 and isAuthorized(admin, 1) returns true. All 13 login-authorization tests passed. The API must be restarted to reload .env; the browser still needs the matching Admin wallet and a fresh SIWE session. No deployment or authorization bypass was performed.

## 2026-11-11 — Remove inline key setup from messaging and evidence flows

- Confirmed DIDComm pack/encrypt and unpack/decrypt calls exist only in the API backend-agent service; the frontend sends approved messages through authenticated API transport.
- Removed the signing-key setup/backup panel from registration, Supplier evidence and Company Identity request/presentation screens. Replaced it with SPA links to a collapsed Presentation signing settings section in My company credential; removed the quoted DIDComm/key-management explanation from the UI.
- Kept existing browser-held VP signing, holder-key binding and verification intact. This is separate from backend-managed messaging keys; no private signing key was moved to the API, no credential was rebound and no server-issued presentation was substituted.
- Validation: frontend tests, web type checks/build and backend DIDComm/security tests passed. No contract, environment, login or DIDComm transport change was required.

## 2026-11-11 — Limit Browse & requests to the requested review stage

- Removed the numbered workflow and location/proposal/reservation/dispatch/receipt/recall controls from Browse & requests. The page now exposes only Browse items, My requests, item-detail evidence and company proof exchange. Removed obsolete workflow-only styles and retired UI tests for those removed controls.
- Added location-free `requestInterest` records with an explicit requestOnly flag. They do not reserve stock or create deliveries, and the contract rejects proposal/allocation/dispatch for these records while still allowing recipient company-identity requests and verification attestations. Existing physical records and methods remain unchanged.
- API preparation requires the request-only capability for this mode, returns an explicit deployment-update error on older suites, and does not fabricate locations or silently create a physical order. New UI submissions use this mode with no fulfilment prerequisites.
- Added docs/BROWSE_REQUESTS_README.md documenting current functions, exact data/proof behavior, every deferred physical-flow function, source locations, restoration constraints and a review checklist. Marked the earlier physical-flow guide as a deferred reference and linked the current scope prominently from README.md.
- Validation: 112 frontend tests, 195 API tests and 34 contract tests passed; all workspace type checks and root production builds passed. Tests cover location-free submission, absence of physical controls, unchanged stock, rejection of fulfilment transitions and preserved company evidence. Contract tests ran on an isolated in-process network. No live deployment, environment change, history reset, commit or push occurred. Updated seven-contract deployment is required for the new location-free request endpoint.

## 2026-11-11 — Automatic browsing, supply requests and selective company proofs

- Replaced manual publishing in the UI with a responsive ingredient/product grid discovered from actual registration events and registry records. Details expose only company/name/category/reference/unit/expiry and optional indicative price metadata; confidential source fields and raw credentials are excluded. Names/prices are checked against registered metadata hashes and missing values remain unavailable.
- Added optional decimal price and currency fields to ingredient/product registration and bound them into existing encrypted metadata. Quantities keep their original units. Navigation and primary actions use Browse & requests / Manage request; no checkout, payment or automatic fulfilment was introduced.
- Added `requestBatch` and a deployment capability getter to SupplyChainOrders. It resolves the registered source, seller and exact unit in the same buyer request transaction, preserving existing request/proposal/reservation/evidence/receipt behavior and legacy getters. Tests cover direct ingredient and finished-product requests without a seller listing transaction. Full suite redeployment with fresh addresses is required; existing journals, data, `.env` and chains were not changed.
- Added item-details evidence requests before a quantity request, with necessary/optional claim selection. Retailers may ask for ingredient evidence linked to an active registered product before receiving/ordering it; an active Manufacturer and exact ingredient link remain mandatory, and no confidential claims are returned without the existing Supplier response/consent flow.
- New request-linked company identity challenges produce custom issuer-derived SD-JWT attestations using existing @sd-jwt/core 0.24.3, ES256K issuer signatures and browser Ed25519 holder key binding. Original Company Role JWT VCs stay unchanged. The original issuer signs an attestation derived from a verified source VC; its hash, holder DID, request, purpose, audience and challenge are bound, source claims are cross-checked, current authorization is rechecked, and necessary fields are enforced. API retains existing source decryption/issuer custody; holder controls presentation selection/signing. Source-store outages are separate from invalid proofs.
- Added holder optional-claim checkboxes and recipient display of only disclosed company values; wallet/role/subject binding remains visible. Identity verification never automatically releases ingredient evidence. Legacy full-disclosure challenges remain explicitly labelled rather than being falsely redacted.
- Validation: 119 frontend, 193 API, 23 SSI and 33 contract tests passed; all workspace type checks and root production builds passed. Tests include real Manufacturer/Retailer issuer/holder signatures, omitted necessary claims, wrong key/audience/challenge, tampering, expiry, replay, revocation, source outage, safe metadata discovery and price validation. Existing bundling warnings remain. Manual live MetaMask review is still required; no public deployment, commit or push occurred.

## 2026-11-11 — Physical dispatch diagnostics

- Added dispatch-specific preflight errors for seller access, order deadline/state, missing or insufficient reservation, effective permission, buyer authorization, required/expired/replaced identity, missing/invalid/expired linked evidence, source validity and Distributor routing/arrival time. Invalid preparations are rejected before encrypting shipment metadata.
- Dispatch checks source validity independently of unreserved stock, preserving dispatch of fully reserved batches with zero availableQuantity. Existing chain simulation remains authoritative and no proof requirement is bypassed.
- Added reservation/evidence/identity guidance and bounds to the dispatch form, defaulting quantity to the remaining reservation. Tests cover evidence blocking before submission and API expiry, reservation, identity, evidence and finished-product routing failures.
- Validation: 39 order API tests and 13 order UI tests passed; API TypeScript checking and API/web production builds passed. No contract or deployment change. The exact live failure still requires the user's public order ID and attempted dispatch quantity.

## 2026-11-11 — Reservation preflight diagnostics

- Added explicit allocation validation for seller ownership, open/unexpired order, confirmed proposal, existing reservation, outstanding quantity, effective permission, available ingredient stock and current ingredient usability. Contract simulation remains the final authority; no stock is reserved by these reads.
- Pre-filled the outstanding order quantity and displayed the remaining/reserved amounts. Disabled repeat allocation while stock remains reserved, and disallowed quantities above the outstanding order amount.
- Added API and UI regressions for invalid states, partial reservation and duplicate prevention. Relevant tests, API/web type checks and production builds passed.
- Live read-only diagnosis found the configured network is Sepolia; the public history query failed, so the user's exact order failure has not been confirmed. Requested the public order ID and attempted quantity. No transaction, deployment, environment or chain state was changed.

## 2026-11-11 — Simplified order navigation

- Removed the redundant Catalogue/Orders/Shipments/Locations/Recall tab row and the repeated introductory paragraph; workflow tiles remain the primary section navigation with active-step semantics.
- Moved Refresh data beside the page title and Recall & tracing into a separate stock-safety utility below the workflow. Admin retains its Trace recalls tile. Supplier has a Track deliveries tile so shipment history stays reachable without the old tabs.
- Updated navigation tests to exercise the workflow tiles and verify refresh/recall placement. Web tests, TypeScript checking and production build passed.

## 2026-11-11 — Guided catalogue and order workflow

- Added a role-specific workflow navigator and an explicit location-setup entry point, with a continuation action after a location exists.
- Separated catalogue browsing from order creation and order lists from the selected order workspace. New orders return to Orders with a clear seller-next message.
- Added ledger-state next-step guidance and numbered seller proposal/reservation, buyer evidence review, seller dispatch and recipient receipt sections. Buyer evidence actions wait for a proposal; reservation remains disabled before one exists. Existing API/contract checks remain authoritative.
- Moved optional identity checks, reference/history details, interrupted-binding recovery and cancellation into distinct expandable sections. Closed/expired orders show history and closure without active proof or dispatch forms. Identity checks can still happen before ingredient disclosure.
- Added responsive workflow tiles, keyboard-accessible expandable sections and active navigation semantics. No login, credential, environment or contract change is required for this UI update.
- Validation: all 116 frontend tests passed, including five new setup/workflow/state regressions; web TypeScript checking and production build passed. Existing bundle-size and dependency-directive warnings remain. Manual MetaMask business-flow testing is still described in the updated guide.

## 2026-11-11 — Preserve registered stock units in catalogue orders

- Removed the g/each-only catalogue rule. Catalogue entries retain the registered quantity and named unit; API requests require an exact match to the catalogue item's unit without converting quantities.
- Removed the redundant registered-unit warning for normal batches and restored normal kg/litre/unit option labels. Inactive and unreadable-unit records retain actionable validation.
- Added a catalogue unit-policy capability getter so older deployed contracts return an explicit upgrade-required response for valid non-g/each units instead of another generic rejection. The immutable deployed contract suite requires redeployment to use the relaxed rule; existing data and configuration are not rewritten.
- Added API/UI and contract regressions for litre/kg/unit listing and exact quantity preservation through order reservation, dispatch and receipt, while still rejecting mismatched units.
- Validation: 111 frontend, 170 API and 32 contract tests passed; all workspace type checks and production builds passed. RPC policy-read outages are reported separately from outdated deployments. No existing batch, credential, root environment value or live contract was modified.

## 2026-11-11 — Responsive workspace layouts and catalogue controls

- Replaced Orders' unstyled native select markup with the shared themed SelectField and gave order forms two equal desktop columns with a single-column layout when the usable workspace narrows.
- Allowed form fields, labels and controls to shrink inside grid columns; constrained controls/media/long identifiers without hiding page overflow. Added workspace-width container queries so forms also collapse beside the desktop sidebar on tablets.
- Updated shared cards, action headings, buttons and dialogs to respect available width; retained horizontal scrolling inside table containers, and added spacing/active navigation styling to order cards and tabs.
- Validation: all 110 frontend tests, web type checks and the production web build passed. Headless Chrome checks used isolated test data at 320, 375, 768, 1024 and 1440 px for order tabs/details, shared forms/tables and long dialogs. Additional navigation checks covered all 35 workspace pages and three public routes at mobile/tablet/desktop widths. These are layout checks, not a replacement for authenticated business-flow acceptance tests.

## 2026-11-11 — Catalogue publishing unit diagnostics

- Diagnosed the live local publishing rejection: the existing ingredient batch uses `litre`, while the deployed catalogue accepts only `g` and `each`. No stock, signed credential or existing unit was rewritten or converted.
- Added API validation that returns `CATALOGUE_UNIT_UNSUPPORTED` with the actual registered unit before transaction preparation, plus owner/role/active-batch checks.
- Added an authenticated seller batch selector with actual on-chain units and eligibility, disabled publishing for ineligible selected batches, and marked legacy unit options as unsupported by Catalogue & orders during ingredient registration.
- Validation: 24 scoped order API/security/transport tests and 4 order UI tests passed; API and web type checks passed. These application changes require a server/browser refresh, not a contract redeployment.

## 2026-11-11 — Catalogue orders, physical inventory and recall integration

- Added SupplyChainOrders and the Catalogue & orders / Order shipments / Orders & recall workspace routes. Requests, versioned batch proposals, reservations, dispatches, receipts, evidence acceptance and buyer identity remain separate states sourced from the ledger.
- Added exact-unit integer g/each catalogue requests, competing-reservation enforcement, partial dispatches, sequential replacement batches with fresh order/proposal-bound evidence, cancellation and permissionless expiry release transactions.
- Added manufacturer ingredient inventory per batch/company/location. Only accepted physical receipts credit usable inventory; damaged, rejected and missing quantities remain distinct. Production consumes accepted stock at an owned location, records reported production time separately from the block timestamp, and retains exact ingredient quantities/links.
- Preserved Manufacturer → Distributor → Retailer routing and extended existing custody inventory with order reservation hooks, linked downstream transfers, explicit missing quantities and authorized location/time references. Direct Manufacturer → Retailer dispatch remains unsupported.
- Reused actual Company Role VC and holder verification for optional/required buyer identity, full-disclosure consent, required claims, context/challenge/expiry/replay/current-status checks and encrypted backend-agent DIDComm delivery. Ingredient SD-JWT signing/disclosure and MetaMask/SIWE login remain unchanged. Exact secure-message retries now reject conflicting contents instead of silently reusing a different delivery.
- Added role/company-scoped recall traversal from ingredients to remaining/received/in-transit stock, finished batches and downstream shipments. Admin corrections preserve originals and consumed quantities; reductions of currently usable stock are supported while unresolved/positive adjustments remain reconciliation records.
- Added fresh seven-contract Ignition wiring, root SUPPLY_ORDERS_ADDRESS documentation, a compatible local custody seed path, test:orders automation and docs/ORDERS_PHYSICAL_FLOW_TEST_GUIDE.md with deployment mapping, role-by-role demo and negative cases.
- Validation: 109 frontend tests, 160 API tests, 23 SSI tests and 29 Solidity/Hardhat tests passed, including real authority/holder signatures, separate-agent DIDComm packing/unpacking and the 100000/95000/60000/35000 g ledger flow with actual API-gateway recall traversal. All workspace type checks and production builds passed. The complete Ignition module was also validated on an isolated in-process network, without changing the running localhost chain or root .env.
- Limits: one active batch allocation per order at a time, with sequential batch replacements; finished-product balances remain company-wide; expiry release requires a transaction; no automatic positive correction or legacy-data migration. Contract redeployment and generated ABI artifacts are required. The manual browser/MetaMask walkthrough is provided but was not executed as browser extension automation. No public deployment, commit or push was performed.

## 2026-11-11 — Individual company permission overrides

- Preserved role defaults and the permission matrix; added an Individual Permissions tab with company-wallet selection, role defaults, effective on-chain access, tri-state Inherit/Allow/Deny settings, explicit confirmation and MetaMask signing.
- Added administrator-only API reads and unsigned transaction preparation with input/state validation and fail-closed deployment/RPC errors. The blockchain test command now includes the individual-permission regression suite.
- Added wallet-scoped StakeholderRegistry overrides and auditable change events. Current stakeholder/credential authorization remains mandatory; approved role changes invalidate previous exceptions and replacement wallets start with role defaults.
- Updated ingredient issuance/registration and production-flow API permission checks to use wallet-effective `hasPermission` instead of role defaults.
- Validation: 106 frontend tests, 139 API tests and 21 contract tests passed; all workspace type checks and production builds passed. Hardhat tests used a local isolated network, outside the Windows sandbox after its user-info syscall failed.
- Deployment limitation: the updated StakeholderRegistry and consistently wired dependent suite require fresh deployment and configured addresses before individual controls work. No public deployment, migration, environment change, employee-account model or automatic credential/role changes were performed.

## 2026-11-11 — Form validation and button alignment

- Added native required/length/pattern/range constraints and accessible error messages to shared form controls, plus submission checks for company onboarding, ingredient/product registration, evidence and transfer workflows, and Admin decisions.
- Added non-empty/type/size checks for registration documents, credential/key uploads and receipt attachments; retained receipt quantity/reconciliation validation with note limits and arrival-time checks.
- Replaced permissive API date coercion with validated calendar/ISO input and added SD-JWT issuance shape/time/claim limits, including rejection of reserved-claim injection before signing.
- Kept button icons and labels in horizontal flex rows in both public and workspace button components. Updated transfer test fixtures to use future dates and added validation regression cases.
- Validation: 103 frontend, 127 API and 23 SSI tests passed; all workspace type checks and production builds passed.

## 2026-11-11 — Security verification and hardening

- Bound evidence proof verification to the request ID, ingredient batch, requester/verifier, Supplier, purpose, challenge, issue/expiry times, and exact Ingredient Credential ID/hash. Added substitution, replay, expiry, signature, and consumed-challenge regression coverage without changing DIDComm-owned files.
- Confirmed and expanded exact on-chain ingredient/batch/Supplier/type/status/expiry/hash enforcement before evidence acceptance.
- Fixed administrator transfer so valid historical Company Role Credentials do not depend on the current administrator address, while the former administrator loses authority and the new administrator can issue and manage credentials. This Solidity change requires redeployment.
- Fixed Retailer evidence-acceptance retry to use accepted request status instead of the Manufacturer-only product-creation flag, including restart-safe idempotent completion.
- Hardened private evidence and receipt retrieval with authoritative participant checks and existence-hiding not-found responses; public traceability remains privacy-minimized.
- Added fail-closed corrupt-workflow handling and a confirmed-transaction/refresh-pending frontend state so a mined transaction is never presented as an ordinary failure. In-memory SIWE sessions still require sign-in after an API restart.

## 2026-11-09 — Backend-managed DIDComm evidence delivery

- Removed the user-facing Secure Messages navigation and moved DIDComm authcrypt packaging, recipient-agent unpacking, routing and delivery validation under normal evidence actions.
- Added persistent, logically separate company `did:key` agents whose private keys are AES-256-GCM protected in the ignored atomic JSON store; missing or damaged existing keys fail closed rather than silently rotating.
- Preserved browser-controlled holder keys for Ingredient SD-JWT and Company Role presentation signatures, relabelled their backup controls accordingly, and did not change MetaMask + SIWE login.
- Added idempotent automatic delivery IDs and explicit `RECEIVED_DECRYPTED` state while keeping verification and business acceptance separate.
- Inspected and preserved two legacy browser messaging identities and six encrypted envelopes. They require the original browser key for user-assisted migration and are not falsely reported as migrated.
- Added backend-agent restart, separation, wrong-recipient, ciphertext tamper and missing-key coverage. No contract change was required for messaging custody.

## 2026-11-07 — Requester company identity proof for restricted evidence

- Added a Supplier-triggered, linked identity-proof request for both Manufacturer and Retailer evidence requesters with a fresh challenge, intended Supplier audience, purpose, and expiry.
- Added browser-held Company Role presentation preview with explicit approval or rejection, encrypted DIDComm delivery, holder/wallet/role/recipient/challenge/expiry checks, current on-chain credential status verification, and semantic response replay protection.
- Kept identity-proof lifecycle separate from Ingredient EvidenceRegistry status and acceptance; verified identity never grants ingredient access automatically.
- Added focused DIDComm coverage for Manufacturer and Retailer presenters plus rejection/replay routing. Expired requests now report an explicit `EXPIRED` identity state.

## 2026-11-07 — Manufacturer received-evidence review completed

- Added a Manufacturer-only received-evidence review endpoint that decrypts the authorized stored presentation and returns a whitelisted view of the actual Ingredient Credential claims rather than raw VP JSON, hashes, or CIDs.
- Added full-disclosure labeling plus Supplier, ingredient, batch, quantity, provenance, allergen, certification, presentation-expiry and credential-expiry display with explicit unverified and verified states.
- Separated View Evidence, Verify Evidence, Accept Evidence and Reject Evidence. Successful verification is persisted independently, and acceptance now requires a recorded successful verification while still rechecking the presentation and current chain state.
- Added API and frontend regression coverage for actual claim display, unverified labeling, full-disclosure warning, persisted verification and the rule that verification does not automatically accept evidence.

## 2026-11-07 — DIDComm delivery for real Ingredient VP requests

- Connected real EvidenceRegistry Manufacturer requests to authenticated DIDComm request delivery and explicit Supplier full-credential consent to encrypted VP delivery using existing browser-held messaging keys.
- Strengthened signed VP context with request, batch, verifier, purpose, domain and fresh-challenge bindings; separated Manufacturer verification from on-chain business acceptance and added participant-only private request/presentation retrieval.
- Added versioned TraceChain presentation, decline, decision and follow-up message types without claiming Present Proof or OpenID4VP support. VP signing remains backend-managed and selective disclosure remains unavailable.
- Hardened EvidenceRegistry acceptance against unrelated valid credentials by enforcing exact IngredientRegistry batch, Supplier and registered-credential relationships. This contract change requires redeployment.
- Added authorized decline/cancel/reject transaction preparation. The complete follow-up/decision notification UI and end-to-end browser automation remain outstanding.

## 2026-11-07 — Browser-held DIDComm evidence-message proof of concept

- Added separate browser-generated `did:key` messaging identities using Veramo 7.0.2 DIDComm v2 authcrypt (`ECDH-1PU+A256KW` and `A256GCM`) without changing MetaMask + SIWE login or existing VP workflows.
- Added fresh challenge/DID-JWT control proofs binding each public messaging DID to the authorized SIWE wallet, TraceChain domain, chain and purpose; private keys remain client-side with optional password-encrypted recovery kits.
- Added a durable no-SQL ciphertext relay and verified participant directory for Manufacturer evidence requests and Supplier acknowledgements with role, recipient, expiry, replay and thread enforcement.
- Added separate-agent cryptographic pack/unpack, wrong-recipient and tamper tests plus API impersonation, recipient substitution, expiry, duplicate, authorization and thread-correlation tests. OpenID4VP remains deferred and full DIDComm 2.1 conformance is not claimed.

## 2026-11-07 — Receipt workflow hardening

- Made the clean-checkout custody test command build both shared and SSI workspaces, and isolated frontend tests from private `.env` files with non-secret Vite test-mode defaults.
- Replaced one-record-per-action receipt persistence with schema-versioned, content-hash-addressed drafts. Exact retries reuse encrypted content, corrected preparations create new drafts, and the atomic JSON repository reads legacy schema-version-1 records without overwriting them.
- Bound finalized private evidence to authoritative contract references: `ReceiptConfirmed` hash/CID, discrepancy details hash/CID, or rejection reason hash. Unrelated and superseded drafts are not returned.
- Added authorized sender, recipient, and System Admin actual-arrival presentation with an honest `Not recorded` fallback, while keeping actual arrival and all private evidence out of public product traceability.
- Added API and frontend regression coverage for corrected MetaMask-cancellation retries, multi-draft preservation, legacy migration, finalized evidence matching, unauthorized access, final-state correction rejection, test-only configuration, and actual-arrival privacy.

## 2026-11-07 — Receipt reconciliation and discrepancy resolution

- Replaced simplified full-quantity receipt confirmation with recipient-entered actual, damaged, and rejected quantities plus system-calculated usable inventory and expected/actual arrival presentation.
- Added deterministic receipt metadata, validated optional evidence, AES-256-GCM encryption through the injectable IPFS abstraction, opaque encrypted filenames, restart-safe stage-specific workflow records, idempotent retries, and fail-closed storage behavior.
- Added unsigned `confirmReceipt`, `reportDiscrepancy`, `reject`, and Admin `resolveDiscrepancy` preparation while retaining MetaMask as the only blockchain signer.
- Added a real Admin discrepancy screen backed by `DiscrepancyReported` events and current contract reads, authorized private evidence access, company/product presentation, accept/cancel decisions, and post-mining refresh.
- Extended public product timelines with privacy-minimized receipt, discrepancy, resolution, rejection, and cancellation events without exposing notes, evidence, CIDs, hashes, wallets, or private files.
- Added focused API and frontend coverage for reconciliation validation, exact calldata, encryption failure, idempotency, wrong recipient/inactive authorization, Admin decisions, post-resolution recipient confirmation, inventory refresh callbacks, and MetaMask failure handling.
- Confirmed no Solidity change was needed. The existing direct `reject` method accepts only a reason hash; encrypted rejection evidence remains accessible through the authorized off-chain repository.

## 2026-11-07 — Product traceability QR and custody history

- Added a strict canonical HTTPS product QR codec containing only version, chain, ProductRegistry address, and real product batch ID, with permanent QR display, PNG download, printable label, and copied-link actions after product creation.
- Audited the completed flow so Manufacturer details, creation success, printable labels, public verification, and Retailer history present the readable product name and batch reference first; the product hash remains internal or inside collapsed Technical details.
- Added safely public, read-only product resolution from configured ProductRegistry, IngredientRegistry, CredentialRegistry, CustodyTransfer, encrypted metadata, and verified stakeholder names, with privacy-filtered public output and authorized Technical details.
- Replaced the Retailer QR and product-history fixtures with responsive loading, verification, lifecycle-warning, camera/image/manual input, real current-custodian, and chronological custody-history views.
- Added focused shared, API, and frontend coverage for canonical phone URLs, strict parameters, deployment mismatch, unknown and lifecycle states, ingredient and company enrichment, public filtering, authorized details, timeline ordering, PNG models, and read-only behavior.

## 2026-11-07 — Stakeholder audit reports connected to chain

- Replaced the fabricated stakeholder product-history report with an authenticated, wallet-scoped snapshot from the configured ingredient, product, custody-transfer, and evidence registries.
- Added current lifecycle states, quantities, resolved company names, integrity hashes, refresh, print, CSV export, service-error handling, and honest empty states without inventing transaction hashes or verification outcomes.
- Added regression coverage proving that on-chain records render and former sample product data does not.

## 2026-11-07 — Distributor-to-Retailer custody transfer

- Replaced the Distributor transfer fixtures, hardcoded company identities, simulated timer, and fake QR transfer ID with authenticated inventory and verified Retailer APIs.
- Added positive-available-inventory filtering, active Retailer directory resolution, Distributor and Retailer permission checks, product/inventory/date validation, encrypted shipment details, idempotent transfer IDs, unsigned `createTransfer` preparation, and authoritative post-mining verification.
- Added the MetaMask review/submission flow, real QR and PNG rendering, company-first presentation, collapsible technical identifiers, duplicate-submit protection, and post-write inventory/history refresh.
- Added focused API and frontend tests for inventory filtering, roles, inactive recipients, insufficient inventory, exact transaction inputs, verified completion, recipient wallet retention, real QR IDs, and duplicate submission.

## 2026-11-07 — Company Digital Identity Card

- Added authenticated retrieval of selected claims from the current wallet's actual server-managed encrypted Company Role VC.
- Added explicit user-triggered Veramo and registry verification with individual signature, issuer, wallet/DID, role, date, hash, lifecycle/replacement, and authorization results.
- Reworked the shared stakeholder credential view into a responsive Company Digital Identity Card with accessible copy actions, separate lifecycle/cryptographic states, collapsed technical details, and a generated PDF identity summary.
- Added cross-wallet isolation, lifecycle-state, identity rendering/copying, verification failure, missing-service, and summary-content tests without changing SIWE login or contracts.

## 2026-11-07 — Stakeholder credential pages connected to chain

- Replaced the Supplier, Manufacturer, Distributor, and Retailer credential-page fixtures with a shared authenticated page backed by `GET /api/blockchain/credentials/me`.
- Added current-wallet credential and stakeholder reads without accepting a caller-selected address.
- Removed fake DIDs, transaction hashes, block numbers, company identities, and always-valid verification labels; the UI now distinguishes authoritative registry state from optional private issuance metadata and off-chain cryptographic verification.

## 2026-11-07 — Verified stakeholder identity presentation

- Added a reusable stakeholder directory backed by existing Company Role issuance records and the live fail-closed registry authorization resolver; revoked or stale entries are excluded, legacy names fall back safely, and duplicate names are disambiguated with shortened wallets.
- Added verified company names to authorized session responses and workspace identity areas, with optional Account details and a plain Sign out action.
- Enriched authenticated operational, evidence, recipient, and custody-transfer responses with safe company display names while preserving wallet addresses for authorization and MetaMask transaction recipients.
- Updated stakeholder, transfer, evidence, and receipt presentation so company names are primary and technical identifiers are available through collapsible copyable details.
- Added API and frontend regression coverage for resolution, revoked exclusion, fallback, duplicates, session enrichment, recipient values, transaction recipients, and technical disclosure.

## 2026-11-07 — Administrator credential on-chain linkage

- Added an authenticated Admin workflow that retrieves the cryptographically verified bootstrap Company Role VC, encrypts and pins it off-chain, and prepares separate MetaMask transactions for `CredentialRegistry` registration and `StakeholderRegistry` reference linkage.
- Added the Admin credential to the credential-management journal so its lifecycle is read from the same on-chain records as Supplier, Manufacturer, Distributor, and Retailer credentials.
- Added linked Admin credential identifiers to refreshed SIWE authorization summaries while retaining the constructor-admin bootstrap recovery path.

## Completed foundation

- Created the TypeScript npm monorepo with `apps/*` and `packages/*` workspaces.
- Added React/Vite frontend, Express API, shared, SSI, and contract package boundaries.
- Added repository formatting, environment templates, ignore rules, and documentation structure.
- Consolidated frontend, API, blockchain, and SSI configuration into one ignored root `.env` with one tracked root template and deterministic loaders for both applications.
- Implemented the responsive TraceChain landing page, branding, registration shell, and role route hierarchy.
- Replaced the registration preview with the complete three-step company onboarding interface, including wallet association, supporting-document validation, review, and declaration.
- Persisted company name and registration number against the application ID/profile hash so new Admin credential-issuance forms populate these reviewed values automatically.
- Added environment-driven local-chain configuration, MetaMask network switching for chain 31337, real local company-application transactions, and an API endpoint that checks bytecode at all six configured contract addresses.
- Implemented ERC-4361 wallet authentication with MetaMask and Sepolia.
- Added the official MetaMask Connect EVM adapter with accessible Browser extension and Mobile QR tabs, including explicit mobile transport selection when an extension or previous extension session exists.
- Added five-minute address-bound nonces, signature validation, single-use nonce handling, HttpOnly-cookie sessions, restoration, logout, and 13 authentication tests.
- Added repository interfaces and process-local development implementations for nonces and sessions.
- Added `POST /api/ssi/company-role/verify`, authenticated credential presentation, safe session restoration, and logout cleanup.
- Added a JSON credential picker that does not use browser storage and reports verification results without exposing JWT material.
- Added shared role-to-workspace mapping and fail-closed production workspace guards; local verification still cannot authorize access.
- Added a development-only Admin holder export command with overwrite protection.
- Added 8 SSI presentation API tests and 3 workspace access tests.
- Added the versioned custody-transfer QR locator codec, safe error codes, canonical normalization,
  and focused shared-package tests. The QR contains only chain, contract, and transfer references.
- Added authenticated custody-transfer QR resolution with configured chain/contract matching,
  read-only `getTransfer` lookup, intended-recipient enforcement, minimal safe responses, and 11
  injected-gateway API tests.
- Added canonical QR rendering and PNG download plus camera, image-file, and manual-paste scanning.
  Distributor and Retailer receipt screens now show transfer data only after authenticated API
  resolution and release camera resources deterministically.
- Added a chain-31337-only seed command that reuses the configured deployed contracts and unlocked
  Hardhat accounts to create one real Manufacturer-to-Distributor `AwaitingReceipt` transfer.
- Added recipient-only receipt confirmation: the API revalidates authorization and returns unsigned
  calldata, MetaMask submits it, the UI waits for the receipt, and the API refreshes the confirmed
  contract record. QR scanning remains read-only.
- Replaced newly generated custody custom-URI locators with canonical HTTPS
  `/receive/transfer` links tied to `VITE_PUBLIC_APP_URL`; added the public responsive phone route,
  SIWE session restoration, MetaMask Mobile login, exact origin/path validation, copy/PNG/print
  actions, real-ID-only generation, and explicit lifecycle error states. Legacy custom URIs remain
  available only through manual paste.
- Receipt resolution and transaction preparation now also require an active Distributor or Retailer
  credential and effective on-chain `RECEIVE_TRANSFER` permission; opening a QR remains read-only.
- Expanded the custody-transfer API suite to 16 injected-gateway tests, including exact
  `confirmReceipt` calldata encoding without a live RPC.
- Implemented the real Manufacturer-to-Distributor production workflow: encrypted challenge-bound
  evidence requests, Supplier full-credential JWT VPs, cryptographic/on-chain evidence acceptance,
  accepted-ingredient product creation, active-Distributor transfer creation, and QR rendering from
  the verified real `AwaitingReceipt` transfer ID.
- Added authenticated `/api/production-flow` reads and unsigned transaction-preparation endpoints,
  current role/credential/permission rechecks, ignored restart-resumable workflow records, and safe
  failure handling that never returns plaintext credentials, VPs, encryption keys, or private metadata.

## Current frontend version

- Corrected Retailer product catalogue presentation to use current orderable Manufacturer
  inventory, recorded country of manufacture, and ProductRegistry linked-credential traceability
  checks. Product images now flow through the authenticated catalogue-media component on received
  product, delivery, traceability, and evidence views.
- Unified Retailer sent company/ingredient evidence under compact tabs and status filters, removed
  the false Product deliveries empty state, widened the request-review dialog with persistent action
  controls, and compacted product dispatch and product-creation confirmation layouts.
- Integrated all approved stakeholder screens into the canonical admin, supplier, manufacturer, distributor, and retailer routes.
- Organized screens by role and workflow, with separate receipt, report, and shared UI folders.
- Removed the former UI-preview route and role selector.
- Added responsive workspace navigation, Lucide icons, scoped light/dark themes, centered accessible loading states, and viewport-safe dialogs.
- Added shared client-side table pagination with 5, 10, 25, 50, and 100-record page-size options.
- Replaced mandatory Company Role VC upload during login with MetaMask SIWE plus direct, fail-closed registry authorization. Sessions now distinguish wallet authentication, current on-chain authorization, and optional off-chain VC verification; authorization is refreshed on restoration and protected operations.
- Removed the temporary account-free localhost bypass; local workspaces now require wallet, credential, and on-chain authorization.
- Replaced Admin overview and company-application fixtures with authenticated API-gateway StakeholderRegistry reads, real empty/error states, and a MetaMask-signed on-chain rejection action.
- Centralized contract addresses and ABIs in the API; live frontend writes now request validated unsigned transaction data and retain the stakeholder wallet as `msg.sender` through MetaMask.
- Completed the company approval path with authority-signed Company Role Credential issuance, backend-prepared credential registration and stakeholder approval transactions, sequential Admin MetaMask confirmation, and credential JSON download for holder delivery.
- Replaced the Admin credential-management fixtures with live CredentialRegistry records and MetaMask-signed suspend, reactivate, and permanent-revoke actions; authorization now rejects non-active registry credentials.
- Replaced Admin Access Control fixtures with live stakeholder and credential lifecycle records, MetaMask-signed stakeholder suspend/reactivate/revoke actions, live role counts, and a configurable on-chain role-permission matrix; replaced the Admin audit fixture with exportable registry snapshots.
- Added authenticated, wallet-scoped operational reads across IngredientRegistry, ProductRegistry, EvidenceRegistry, and CustodyTransfer. Supplier, Manufacturer, Distributor, and Retailer primary dashboards, batch/shipment/inventory lists, and their detail views now display current chain state instead of sample records.
- Made Company Role Credential issuance durable and idempotent: generated VCs are verified before use, deterministically hashed, AES-256-GCM encrypted, pinned through an injectable IPFS gateway, and persisted for restart-safe partial-failure recovery.
- Added cancellable mobile-wallet guidance, connection rejection/expiry handling, wallet transport cleanup on logout, and lazy initialization that leaves session restoration non-interactive.
- Reused existing authorized extension providers, serialized connection attempts, added bounded timeouts and one stale-transport retry, and moved connection progress into the visible authentication card.
- Added mocked MetaMask client, EIP-1193 provider, transport-tab, QR-selection, stale-session, timeout, StrictMode, listener-cleanup, custody-transfer and product QR, receipt-confirmation, Supplier registration, production-flow, and stakeholder identity-card tests; the frontend suite now contains 81 tests and performs no live relay or RPC calls.
- Validated all 29 workspace pages at 320, 390, 768, and 1440 pixel widths, including canonical navigation, pagination, filters, dialogs, local access, and production denial.

## Current contract and SSI version

- Added a Hardhat 3 workspace using Solidity 0.8.34, ethers, Mocha, Ignition, and Foundry-compatible Solidity tests.
- Implemented StakeholderRegistry, CredentialRegistry, EvidenceRegistry, IngredientRegistry, ProductRegistry, and CustodyTransfer contracts with role/status enforcement and bounded paginated registry reads.
- Added application review, additional-evidence, resubmission, reviewed role-change, wallet replacement, credential lifecycle, ingredient/product linkage, evidence acceptance, and custody discrepancy workflows.
- Added one Ignition module that deploys and wires the complete suite and a TypeScript integration test covering authorization, credential lifecycle, traceability, reservation accounting, and duplicate-receipt protection.
- Separated pre-consumption ingredient usability from post-consumption traceability validity, so a
  finished product remains transferable after consuming the final ingredient unit while ingredient
  lifecycle, Supplier authorization, and credential validity still gate transfer.
- Confirmed production contracts compile with the cached native Solidity 0.8.34 compiler and the
  complete Hardhat suite passes locally.
- Added AES-256-GCM encrypted JSON content storage with an injectable IPFS pinning gateway and tamper-detection tests.
- Implemented the Supplier Ingredient Credential and batch workflow: Supplier-specific issuer DIDs,
  typed W3C JWT claims, immediate cryptographic verification, canonical SHA-256 hashes, encrypted
  IPFS storage, and restart-resumable workflow records.
- Added authenticated `POST /api/ingredient-batches/prepare` and `GET /api/ingredient-batches`.
  The API rechecks Supplier role/status and both contract permissions, prepares credential and batch
  writes sequentially, and verifies each on-chain record before advancing or reporting completion.
- Replaced the Supplier ingredient registration timer and batch fixtures in the registration,
  list, detail, and overview screens with the real two-transaction MetaMask workflow and
  event/getBatch-backed API data. Errors remain resumable and duplicate submissions are blocked.
- Added 4 Ingredient Credential SSI cases, 6 focused ingredient-batch API cases, and 4 Supplier
  frontend workflow/list cases, all using mocked external services or local cryptographic agents.
- Implemented a Veramo 7 server-side agent with DID, resolver, key-management, JWT VC/VP, verification, and JSON data-store plugins.
- Added `did:ethr` Sepolia authority creation, separate atomic JSON stores, and SecretBox encryption for private issuer keys.
- Added typed Company Role Credential issuance and verification with trusted issuer, subject/SIWE wallet binding, shared roles, date, local status, and deterministic SHA-256 checks.
- Added an idempotent Product Traceability Authority and bootstrap System Admin service plus a safe CLI command.
- Added 21 offline SSI tests, including successful challenge-bound Ingredient VP verification plus challenge/signature rejection, without live RPC, MetaMask, or test ETH.
- Connected credential presentation to on-chain stakeholder role/lifecycle and credential hash/status checks; authorized sessions now set `onChainStatusChecked` and `authorizationReady` to true.
- Added holder-controlled Ingredient SD-JWT issuance and selective presentation with `@sd-jwt/core` 0.24.3: the credential is bound to the Supplier's wallet-authenticated browser `did:key`, the private key remains client-side, Manufacturers classify requested claims as Required or Optional, Suppliers preview and explicitly consent, and the API verifies issuer/holder signatures, challenge, recipient, batch, hash, expiry, and current on-chain status before acceptance.
- Preserved legacy Ingredient JWT credentials as a clearly labelled full-disclosure path and kept OpenID4VP deferred. See `docs/INGREDIENT_SELECTIVE_DISCLOSURE.md` for key ownership, recovery, transport, and remaining rotation limitations.

## Remaining work

- Select the database and replace process-local nonce and session storage.
- Replace prototype filesystem issuance metadata and Veramo JSON key storage with production-managed database and key-management services.
- Replace the remaining non-admin report fixtures with authenticated chain-backed workflows.
- Complete a clean Hardhat test run and deploy the suite to Sepolia when the deployment wallet is ready.
- Add committed end-to-end browser tests and production deployment configuration.
- Add an authorized replacement-credential workflow for participant-key rotation; current SD-JWT credentials remain bound to their original recovery-kit key.

## Important distinction

The Admin application, credential, access-control, discrepancy, and audit screens use authoritative chain records. Primary Supplier, Manufacturer, Distributor, and Retailer dashboards and their batch, product, shipment, inventory, detail, and company-identity views are backed by authenticated services. Supplier Ingredient Credential/batch registration and the Manufacturer evidence, product, Manufacturer-to-Distributor transfer, Distributor-to-Retailer transfer, QR handoff, recipient reconciliation/evidence, and public product traceability flows use verified credentials where required, encrypted IPFS content, MetaMask writes, contract events, and authoritative reads. Remaining non-admin reports still require fixture removal.
