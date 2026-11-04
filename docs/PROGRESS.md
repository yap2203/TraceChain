# Project Progress

## Completed foundation

- Created the TypeScript npm monorepo with `apps/*` and `packages/*` workspaces.
- Added React/Vite frontend, Express API, shared, SSI, and contract package boundaries.
- Added repository formatting, environment templates, ignore rules, and documentation structure.
- Implemented the responsive TraceChain landing page, branding, registration shell, and role route hierarchy.
- Replaced the registration preview with the complete three-step company onboarding interface, including wallet association, supporting-document validation, review, and declaration.
- Added environment-driven local-chain configuration, MetaMask network switching for chain 31337, real local company-application transactions, and an API endpoint that checks bytecode at all six configured contract addresses.
- Implemented ERC-4361 wallet authentication with MetaMask and Sepolia.
- Added five-minute address-bound nonces, signature validation, single-use nonce handling, HttpOnly-cookie sessions, restoration, logout, and 13 authentication tests.
- Added repository interfaces and process-local development implementations for nonces and sessions.
- Added `POST /api/ssi/company-role/verify`, authenticated credential presentation, safe session restoration, and logout cleanup.
- Added a JSON credential picker that does not use browser storage and reports verification results without exposing JWT material.
- Added shared role-to-workspace mapping and fail-closed production workspace guards; local verification still cannot authorize access.
- Added a development-only Admin holder export command with overwrite protection.
- Added 8 SSI presentation API tests and 3 workspace access tests.

## Current frontend version

- Integrated all approved stakeholder screens into the canonical admin, supplier, manufacturer, distributor, and retailer routes.
- Organized screens by role and workflow, with separate receipt, report, and shared UI folders.
- Removed the former UI-preview route and role selector.
- Added responsive workspace navigation, Lucide icons, scoped light/dark themes, centered accessible loading states, and viewport-safe dialogs.
- Added shared client-side table pagination with 5, 10, 25, 50, and 100-record page-size options.
- Made login actions state-aware for disconnected, wallet-authenticated, and locally verified sessions, including a three-step authorization status and safe credential replacement UX.
- Removed the temporary account-free localhost bypass; local workspaces now require wallet, credential, and on-chain authorization.
- Replaced Admin overview and company-application fixtures with direct local StakeholderRegistry reads, real empty/error states, and an on-chain rejection action.
- Kept production workspace access fail-closed because blockchain role and credential-status verification are not yet implemented, even when a Company Role Credential has been verified locally.
- Validated all 29 workspace pages at 320, 390, 768, and 1440 pixel widths, including canonical navigation, pagination, filters, dialogs, local access, and production denial.

## Current contract and SSI version

- Added a Hardhat 3 workspace using Solidity 0.8.34, ethers, Mocha, Ignition, and Foundry-compatible Solidity tests.
- Implemented StakeholderRegistry, CredentialRegistry, EvidenceRegistry, IngredientRegistry, ProductRegistry, and CustodyTransfer contracts with role/status enforcement and bounded paginated registry reads.
- Added application review, additional-evidence, resubmission, reviewed role-change, wallet replacement, credential lifecycle, ingredient/product linkage, evidence acceptance, and custody discrepancy workflows.
- Added one Ignition module that deploys and wires the complete suite and a TypeScript integration test covering authorization, credential lifecycle, traceability, reservation accounting, and duplicate-receipt protection.
- Confirmed production contracts compile with the cached native Solidity 0.8.34 compiler. Full Hardhat execution is pending because the local Hardhat compiler-cache mutex is held by another process.
- Added AES-256-GCM encrypted JSON content storage with an injectable IPFS pinning gateway and tamper-detection tests.
- Implemented a Veramo 7 server-side agent with DID, resolver, key-management, JWT VC/VP, verification, and JSON data-store plugins.
- Added `did:ethr` Sepolia authority creation, separate atomic JSON stores, and SecretBox encryption for private issuer keys.
- Added typed Company Role Credential issuance and verification with trusted issuer, subject/SIWE wallet binding, shared roles, date, local status, and deterministic SHA-256 checks.
- Added an idempotent Product Traceability Authority and bootstrap System Admin service plus a safe CLI command.
- Added 15 offline SSI tests without live RPC, MetaMask, or test ETH.
- Connected credential presentation to on-chain stakeholder role/lifecycle and credential hash/status checks; authorized sessions now set `onChainStatusChecked` and `authorizationReady` to true.

## Remaining work

- Implement on-chain credential status verification and credential-based RBAC.
- Select the database and replace process-local nonce and session storage.
- Implement the on-chain credential revocation/status approach and production-grade SSI key/storage design.
- Replace the remaining credential, access-control, supplier, manufacturer, distributor, retailer, receipt, and report fixtures with authenticated chain-backed workflows.
- Complete a clean Hardhat test run and deploy the suite to Sepolia when the deployment wallet is ready.
- Define QR payloads and implement real generation, scanning, and intended-receiver validation.
- Add committed end-to-end browser tests and production deployment configuration.

## Important distinction

The Admin application list and overview use authoritative local-chain records. Credential cards, access-control lists, supplier/manufacturer/distributor/retailer workflows, receipt confirmations, reports, and QR states remain presentation fixtures until their contract and encrypted-content integrations are completed.
