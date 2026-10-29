# Testing and Validation

TraceChain currently uses TypeScript compilation, Vite production builds, API authentication tests, Hardhat tests, formatting checks, and targeted browser validation.

## Repository checks

Run from the repository root:

```bash
npm run build
npm run typecheck
npm run test:auth
npm run format:check
npm audit
```

- `npm run build` builds workspaces that define a build script: API, web, shared, and SSI.
- `npm run typecheck` checks those TypeScript workspaces.
- `npm run test:auth` runs the API SIWE and session suite.
- `npm run format:check` checks the entire repository and can report older formatting differences outside a focused change.
- `npm audit` reports dependency advisories and may require registry access.

The contracts workspace has no package scripts, so run its checks directly from `packages/contracts`:

```bash
npx hardhat compile
npx hardhat test
npx hardhat test solidity
npx hardhat test mocha
```

## Current automated coverage

The API authentication suite covers nonce validation, signature verification, replay prevention, expiration, session restoration, logout, cookie behavior, malformed requests, and request-size limits. The Hardhat starter contains Counter tests in TypeScript and Solidity; these validate the toolchain rather than TraceChain business rules.

The current Counter suite passes with five tests: three Solidity tests and two Mocha tests. A direct `npx tsc --noEmit` in the contracts package still reports that the `queryFilter()` result must be narrowed from `EventLog | Log` before reading `.args`; this starter typing issue remains to be fixed.

Targeted browser checks have validated all integrated stakeholder pages at 320, 390, 768, and 1440 pixel widths, including canonical navigation, local-development access, production access denial, responsive dialogs, loading indicators, table pagination, filters, and page-size controls. These browser checks currently live as local development scripts rather than a committed browser-test package.

## Required future coverage

- Cryptographic Company Role Credential verification and RBAC
- Credential expiry, suspension, revocation, and issuer trust
- SSI issuance and selective disclosure
- TraceChain contract authorization and state transitions
- QR payload validation and intended-receiver checks
- API persistence, concurrency, and failure recovery
- End-to-end receipt confirmation with MetaMask and Sepolia

Fixtures and simulated frontend transactions are not evidence that backend, SSI, or blockchain operations work.
