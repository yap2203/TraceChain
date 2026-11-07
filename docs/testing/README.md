# Testing and Validation

TraceChain currently uses TypeScript compilation, Vite production builds, API authentication tests, Hardhat tests, formatting checks, and targeted browser validation.

## Repository checks

Run from the repository root:

```bash
npm run build
npm run typecheck
npm run test:auth
npm run test:ssi
npm run test:ssi-api
npm run test:ingredient-batches
npm run test:production-flow
npm run test:custody-transfers
npm run test:blockchain
npm run test:contracts
npm run test:frontend
npm run test:workspace-access
npm run format:check
npm audit --omit=dev
```

- `npm run build` builds workspaces that define a build script: API, web, shared, and SSI.
- `npm run typecheck` checks those TypeScript workspaces.
- `npm run test:auth` builds the shared and SSI workspaces, then runs the API SIWE and session suite.
- `npm run test:ssi` runs the offline Veramo, storage, bootstrap, issuance, and verification suite.
- `npm run test:ssi-api` builds the shared and SSI workspaces, then runs authenticated Company Role Credential presentation and session tests.
- `npm run test:ingredient-batches` covers Supplier credential issuance, encrypted storage, sequential transaction preparation, and authoritative batch reads.
- `npm run test:production-flow` covers Manufacturer/Supplier evidence, product, and transfer preparation plus exact contract calldata.
- `npm run test:custody-transfers` first builds both internal shared and SSI workspaces, then covers authenticated QR resolution, quantity reconciliation, versioned drafts, authoritative evidence matching, migration compatibility, encrypted evidence failures, exact receipt/discrepancy calldata, rejection, idempotency, Admin discrepancy decisions, and post-resolution recipient confirmation.
- `npm run test:blockchain` covers the authenticated blockchain gateway boundary.
- `npm run test:contracts` runs the complete Hardhat contract suite.
- `npm run test:frontend` runs wallet-connection adapter, authentication-hook, login-presentation, credential-panel, and workspace-access tests.
- `npm run test:workspace-access` checks the shared fail-closed frontend access guard.
- `npm run format:check` checks the entire repository and can report older formatting differences outside a focused change.
- `npm audit` reports dependency advisories and may require registry access.

The contract commands can also be run directly from `packages/contracts`:

```bash
npx hardhat compile
npx hardhat test
npx hardhat test solidity
npx hardhat test mocha
```

## Current automated coverage

The API authentication suite covers nonce validation, signature verification, replay prevention, expiration, session restoration, logout, cookie behavior, malformed requests, and request-size limits.

The 21-test SSI suite covers agent assembly, did:ethr creation, JSON persistence/restoration, encrypted private-key persistence, idempotent authority DID creation and Admin bootstrap, Company Role and Ingredient JWT issuance/verification, and challenge-bound full-credential VP creation and verification. It rejects challenge/signature tampering and uses temporary directories plus a controlled local DID resolver without contacting Sepolia, spending ETH, or depending on MetaMask.

The SSI API, ingredient-batch, production-flow, custody-transfer, product-traceability, blockchain, and authentication suites use injected repositories/gateways and mocked external services where appropriate. Production-flow cases cover wrong roles/wallets, duplicate requests, expired deadlines, challenge/signature failures, credential/batch mismatches, inactive credentials, accepted-ingredient enforcement, exact `createProduct`/`createTransfer` calldata, and inventory/recipient validation. Custody tests use in-memory or temporary JSON receipt repositories and mocked encrypted storage; they do not contact Pinata or an RPC endpoint. The 93-test frontend suite includes wallet transport, SIWE, workspace access, QR scanning, receipt reconciliation, corrected cancellation retries, actual-arrival presentation, Admin discrepancy decisions, Supplier registration, MetaMask rejection/revert handling, duplicate production writes, and real confirmed transfer-ID handoff. Vite test mode supplies fixed non-secret local-chain defaults, so frontend tests do not load a developer's private root `.env`.

The Hardhat suite covers stakeholder authorization, credential lifecycle, evidence acceptance, ingredient/product linkage, final-unit ingredient transferability, inventory reservation, custody transitions, and duplicate-receipt protection.

Targeted browser checks have validated all integrated stakeholder pages at 320, 390, 768, and 1440 pixel widths, including canonical navigation, local-development access, production access denial, responsive dialogs, loading indicators, table pagination, filters, and page-size controls. These browser checks currently live as local development scripts rather than a committed browser-test package.

## Required future coverage

- API persistence, concurrency, and failure recovery
- A future selective-disclosure credential/presentation format; the current JWT VP intentionally presents the complete Ingredient Credential
- Committed end-to-end browser tests against local contracts
- Sepolia deployment and end-to-end verification

Fixtures and simulated frontend transactions are not evidence that backend, SSI, or blockchain operations work.
