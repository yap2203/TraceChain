# Project Progress

## Completed foundation

- Created the TypeScript npm monorepo with `apps/*` and `packages/*` workspaces.
- Added React/Vite frontend, Express API, shared, SSI, and contract package boundaries.
- Added repository formatting, environment templates, ignore rules, and documentation structure.
- Implemented the responsive TraceChain landing page, branding, registration shell, and role route hierarchy.
- Implemented ERC-4361 wallet authentication with MetaMask and Sepolia.
- Added the official MetaMask Connect EVM adapter with accessible Browser extension and Mobile QR tabs, including explicit mobile transport selection when an extension or previous extension session exists.
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
- Added cancellable mobile-wallet guidance, connection rejection/expiry handling, wallet transport cleanup on logout, and lazy initialization that leaves session restoration non-interactive.
- Added mocked MetaMask client, EIP-1193 provider, transport-tab, and QR-selection tests; the frontend suite now contains 26 tests and performs no live relay or RPC calls.
- Enabled temporary account-free sample UI access only on local Vite loopback hosts.
- Kept production workspace access fail-closed because blockchain role and credential-status verification are not yet implemented, even when a Company Role Credential has been verified locally.
- Validated all 29 workspace pages at 320, 390, 768, and 1440 pixel widths, including canonical navigation, pagination, filters, dialogs, local access, and production denial.

## Current contract and SSI version

- Added a Hardhat 3 workspace using Solidity 0.8.34, ethers, Mocha, Ignition, and Foundry-compatible Solidity tests.
- Added Counter starter code, tests, deployment module, and simulated OP transaction script to validate the contract toolchain.
- Confirmed that Hardhat compilation succeeds and all five starter tests pass. Standalone contract TypeScript checking still needs an `EventLog` narrowing fix in `test/Counter.ts`.
- Implemented a Veramo 7 server-side agent with DID, resolver, key-management, JWT VC/VP, verification, and JSON data-store plugins.
- Added `did:ethr` Sepolia authority creation, separate atomic JSON stores, and SecretBox encryption for private issuer keys.
- Added typed Company Role Credential issuance and verification with trusted issuer, subject/SIWE wallet binding, shared roles, date, local status, and deterministic SHA-256 checks.
- Added an idempotent Product Traceability Authority and bootstrap System Admin service plus a safe CLI command.
- Added 15 offline SSI tests without live RPC, MetaMask, or test ETH.
- Kept `authorizationReady` and on-chain status checks false until the TraceChain registries exist.

## Remaining work

- Implement on-chain credential status verification and credential-based RBAC.
- Select the database and replace process-local nonce and session storage.
- Implement the on-chain credential revocation/status approach and production-grade SSI key/storage design.
- Replace frontend fixtures and simulation handlers with authenticated business APIs.
- Design, implement, test, and deploy TraceChain-specific smart contracts.
- Define QR payloads and implement real generation, scanning, and intended-receiver validation.
- Add committed end-to-end browser tests and production deployment configuration.

## Important distinction

The stakeholder interface is implemented as an integrated, responsive frontend. Its sample records, credential cards, QR states, receipt confirmations, reports, and blockchain references are presentation fixtures until the API, SSI, persistence, and TraceChain contract layers are connected.
