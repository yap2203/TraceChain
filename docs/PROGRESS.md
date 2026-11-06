# Project Progress

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

## Current frontend version

- Integrated all approved stakeholder screens into the canonical admin, supplier, manufacturer, distributor, and retailer routes.
- Organized screens by role and workflow, with separate receipt, report, and shared UI folders.
- Removed the former UI-preview route and role selector.
- Added responsive workspace navigation, Lucide icons, scoped light/dark themes, centered accessible loading states, and viewport-safe dialogs.
- Added shared client-side table pagination with 5, 10, 25, 50, and 100-record page-size options.
- Made login actions state-aware for disconnected, wallet-authenticated, and locally verified sessions, including a three-step authorization status and safe credential replacement UX.
- Removed the temporary account-free localhost bypass; local workspaces now require wallet, credential, and on-chain authorization.
- Replaced Admin overview and company-application fixtures with authenticated API-gateway StakeholderRegistry reads, real empty/error states, and a MetaMask-signed on-chain rejection action.
- Centralized contract addresses and ABIs in the API; live frontend writes now request validated unsigned transaction data and retain the stakeholder wallet as `msg.sender` through MetaMask.
- Completed the company approval path with authority-signed Company Role Credential issuance, backend-prepared credential registration and stakeholder approval transactions, sequential Admin MetaMask confirmation, and credential JSON download for holder delivery.
- Replaced the Admin credential-management fixtures with live CredentialRegistry records and MetaMask-signed suspend, reactivate, and permanent-revoke actions; authorization now rejects non-active registry credentials.
- Replaced Admin Access Control fixtures with live stakeholder and credential lifecycle records, MetaMask-signed stakeholder suspend/reactivate/revoke actions, live role counts, and a configurable on-chain role-permission matrix; replaced the Admin audit fixture with exportable registry snapshots.
- Made Company Role Credential issuance durable and idempotent: generated VCs are verified before use, deterministically hashed, AES-256-GCM encrypted, pinned through an injectable IPFS gateway, and persisted for restart-safe partial-failure recovery.
- Added cancellable mobile-wallet guidance, connection rejection/expiry handling, wallet transport cleanup on logout, and lazy initialization that leaves session restoration non-interactive.
- Reused existing authorized extension providers, serialized connection attempts, added bounded timeouts and one stale-transport retry, and moved connection progress into the visible authentication card.
- Added mocked MetaMask client, EIP-1193 provider, transport-tab, QR-selection, stale-session, timeout, StrictMode, listener-cleanup, custody-transfer QR, and receipt-confirmation tests; the frontend suite now contains 50 tests and performs no live relay or RPC calls.
- Enabled temporary account-free sample UI access only on local Vite loopback hosts.
- Kept production workspace access fail-closed because blockchain role and credential-status verification are not yet implemented, even when a Company Role Credential has been verified locally.
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
- Implemented a Veramo 7 server-side agent with DID, resolver, key-management, JWT VC/VP, verification, and JSON data-store plugins.
- Added `did:ethr` Sepolia authority creation, separate atomic JSON stores, and SecretBox encryption for private issuer keys.
- Added typed Company Role Credential issuance and verification with trusted issuer, subject/SIWE wallet binding, shared roles, date, local status, and deterministic SHA-256 checks.
- Added an idempotent Product Traceability Authority and bootstrap System Admin service plus a safe CLI command.
- Added 15 offline SSI tests without live RPC, MetaMask, or test ETH.
- Connected credential presentation to on-chain stakeholder role/lifecycle and credential hash/status checks; authorized sessions now set `onChainStatusChecked` and `authorizationReady` to true.

## Remaining work

- Select the database and replace process-local nonce and session storage.
- Replace prototype filesystem issuance metadata and Veramo JSON key storage with production-managed database and key-management services.
- Replace the remaining credential, access-control, supplier, manufacturer, distributor, retailer, receipt, and report fixtures with authenticated chain-backed workflows.
- Complete a clean Hardhat test run and deploy the suite to Sepolia when the deployment wallet is ready.
- Add damaged/rejected quantity reconciliation and encrypted receipt evidence to receipt confirmation.
- Add committed end-to-end browser tests and production deployment configuration.

## Important distinction

The Admin application list and overview use authoritative local-chain records. Custody-transfer QR resolution and receipt confirmation now use the configured contract through the authenticated API and recipient MetaMask. Credential cards, access-control lists, remaining supplier/manufacturer/distributor/retailer workflows, receipt reconciliation/evidence, and reports remain presentation fixtures until their contract and encrypted-content integrations are completed.
