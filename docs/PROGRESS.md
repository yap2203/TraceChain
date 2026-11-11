# Project Progress

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
