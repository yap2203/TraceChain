# TraceChain

TraceChain is a blockchain-based supply-chain traceability system with Self-Sovereign Identity credential verification. It is a TypeScript npm monorepo developed as a final-year project.

The current version includes a responsive React application, five integrated stakeholder workspaces, Sign-In with Ethereum wallet authentication, an Express API, a server-side Veramo SSI foundation, shared role types, and a Hardhat 3 smart-contract starter. Persistent business APIs, on-chain credential status, credential-based RBAC, TraceChain-specific contracts, IPFS, and live blockchain workflows are still planned.

## Current implementation status

| Area                                     | Status                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Public login and company-registration UI | Implemented; registration submission is not connected                                 |
| MetaMask and ERC-4361 authentication     | Implemented for Ethereum Sepolia                                                      |
| Nonce and session storage                | Implemented in process memory for development                                         |
| Stakeholder workspace UI                 | Integrated with sample fixtures and simulated interactions                            |
| Responsive UI                            | Implemented for mobile, tablet, and desktop layouts                                   |
| Loading and table pagination             | Implemented; tables support 5, 10, 25, 50, or 100 rows per page                       |
| Company Role Credential verification     | JWT signature, issuer, wallet binding, role, dates, and local status implemented      |
| Credential-based RBAC                    | Remains fail-closed until on-chain status checks are implemented                      |
| SSI and Veramo services                  | did:ethr Sepolia agent, encrypted JSON storage, issuance, verification, and bootstrap |
| Smart contracts                          | Hardhat toolchain and Counter example only                                            |
| Business persistence                     | Not implemented                                                                       |

## Repository structure

```text
apps/
  web/             React 19, Vite 8, TypeScript, React Router, and ethers
  api/             Express 5, SIWE authentication, and in-memory repositories
packages/
  shared/          Shared company-role definitions
  ssi/             Veramo agent, did:ethr, JWT VC/VP, encrypted JSON storage, and verification
  contracts/       Hardhat 3 starter, Solidity example, tests, and deployment module
docs/
  architecture/    Component boundaries and trust model
  api/             HTTP endpoints and environment configuration
  ssi/             SSI scope and unresolved decisions
  smart-contracts/ Contract toolchain and planned contract scope
  testing/         Current checks and future coverage
scripts/           Repository-wide automation documentation
```

## Prerequisites

- Node.js 22 or later
- npm 10 or later
- Git
- MetaMask for the wallet sign-in flow

## Setup

From the repository root:

```bash
npm install
```

Copy the tracked environment templates. On Windows PowerShell:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
```

On macOS or Linux:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

The real `.env` files are ignored. Example files must contain safe defaults or placeholders only. Never add private keys, seed phrases, API secrets, real credentials, or personal supporting documents to the repository.

## Development

Run the frontend and API together:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev:web
npm run dev:api
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000`
- Health check: `GET http://localhost:3000/api/health`

### Environment variables

`apps/api/.env`:

```text
PORT=3000
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
SIWE_DOMAIN=localhost:5173
SIWE_URI=http://localhost:5173
SIWE_CHAIN_ID=11155111
AUTH_COOKIE_NAME=tracechain_session
AUTH_SESSION_TTL_SECONDS=28800
SEPOLIA_RPC_URL=https://example.invalid
VERAMO_KMS_SECRET_KEY=replace-with-a-strong-development-secret
TRACECHAIN_AUTHORITY_DID_ALIAS=tracechain-authority
BOOTSTRAP_ADMIN_WALLET=0x0000000000000000000000000000000000000000
```

`apps/web/.env`:

```text
VITE_API_BASE_URL=http://localhost:3000
```

The CORS origin, SIWE domain, and SIWE URI must match the address used to open the frontend.

The four SSI variables are validated only when the bootstrap command runs, so the API and SIWE tests do not require SSI secrets. Replace every SSI placeholder locally before bootstrapping. `BOOTSTRAP_ADMIN_WALLET` is a public address; never provide its private key or recovery phrase.

## SSI and System Admin bootstrap

`@tracechain/ssi` configures Veramo 7 with did:ethr on Sepolia, JWT credentials, DID/credential/message metadata in a public JSON store, and SecretBox-encrypted private issuer keys in a separate JSON store. Runtime files are written under `.tracechain/veramo/` and ignored by Git. The beta `@veramo/data-store-json` package is accepted for this FYP prototype, not presented as an automatic production recommendation.

Generate a 32-byte hexadecimal development KMS secret without placing it in source code:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put that value, a real Sepolia RPC URL, the authority alias, and the public Admin wallet address in the ignored `apps/api/.env`, then run:

```bash
npm run ssi:bootstrap-admin
```

Do not run the command with `.env.example` placeholders. It creates or reuses the server-managed Product Traceability Authority DID, derives the Admin subject DID from the public wallet address, and issues at most one active bootstrap `SYSTEM_ADMIN` Company Role Credential. CLI output contains safe identifiers and status only. The credential and encrypted issuer key remain off-chain; MetaMask continues to control the Admin wallet key.

The credential verification service returns a deterministic SHA-256 hash for future blockchain registration, but `onChainStatusChecked` and `authorizationReady` remain `false`. Stakeholder dashboards must not be unlocked until the CredentialRegistry and StakeholderRegistry checks exist.

## Frontend routes

The root route redirects to `/login`. Unknown routes also return to the login page.

| Role         | Canonical pages                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public       | `/login`, `/register-company`                                                                                                                                                   |
| Admin        | `/admin/overview`, `/admin/applications`, `/admin/credentials`, `/admin/stakeholders`, `/admin/reports`                                                                         |
| Supplier     | `/supplier/overview`, `/supplier/ingredients`, `/supplier/evidence-requests`, `/supplier/credentials`, `/supplier/reports`                                                      |
| Manufacturer | `/manufacturer/overview`, `/manufacturer/ingredient-evidence`, `/manufacturer/product-batches`, `/manufacturer/transfers`, `/manufacturer/credentials`, `/manufacturer/reports` |
| Distributor  | `/distributor/overview`, `/distributor/incoming-shipments`, `/distributor/inventory`, `/distributor/transfers`, `/distributor/credentials`, `/distributor/reports`              |
| Retailer     | `/retailer/overview`, `/retailer/incoming-products`, `/retailer/scan`, `/retailer/traceability`, `/retailer/evidence-requests`, `/retailer/credentials`, `/retailer/reports`    |

Each role root redirects to its overview. Internal page identifiers such as `/supplier/batches` are normalized to their canonical system paths while retaining search parameters used by detail screens.

### Local workspace access

When the Vite development server runs on `localhost`, `127.0.0.1`, or `::1`, all five stakeholder workspaces open without an account check. This temporary development branch allows review of sample data and simulated UI interactions without running the API.

This behavior requires `import.meta.env.DEV`; production builds and non-local hosts keep the wallet and credential gate. Local access does not create a session, verify a credential, persist a record, sign a real transaction, or grant backend permissions.

## Authentication

The login page restores an existing HttpOnly-cookie session without requesting wallet access. After an explicit user action, it connects MetaMask, requires Sepolia, requests a five-minute nonce, builds an ERC-4361 message, requests a signature, and sends the signed message to the API.

The API verifies the SIWE signature, address, domain, URI, chain ID, nonce, issue time, and expiration. It then creates a process-local session. Authentication proves wallet control only: the current response always contains `credentialVerified: false` and supplies no role.

Production workspace records remain locked until a future service cryptographically verifies a valid Company Role Credential for the requested role. A URL, wallet address, fixture value, or local browser value must never grant access.

## Workspace UI

Integrated pages live in `apps/web/src/features/workspaces`, grouped by stakeholder and workflow. `WorkspaceApp.tsx` owns canonical routing and the access boundary; `WorkspaceScreen.tsx` dispatches detailed pages. Shared workspace presentation components, receipts, reports, and table controls are kept in focused subfolders.

The current detailed pages use fixture data and simulation handlers. A centered accessible spinner covers lazy page loading and wallet/session checks. Shared table pagination defaults to 10 rows and offers 5, 10, 25, 50, or 100 rows per page. Wide tables scroll inside their containers, and navigation, grids, forms, and dialogs adapt to narrow screens.

## Smart-contract starter

`packages/contracts` uses Hardhat 3 and Solidity 0.8.34. From that package:

```bash
npx hardhat compile
npx hardhat test
```

The included Counter contract, tests, Ignition module, and OP script only validate the toolchain. They are not TraceChain business contracts. Sepolia settings use Hardhat configuration variables named `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY`; never commit their real values.

## Validation

From the repository root:

```bash
npm run build
npm run typecheck
npm run test:auth
npm run test:ssi
npm run format:check
npm audit
```

The authentication suite contains 13 tests and the SSI suite contains 15 offline tests. SSI tests use temporary files and a controlled local did:ethr resolver; they do not call Sepolia, spend test ETH, or depend on MetaMask. Targeted browser checks have covered all 29 stakeholder pages at 320, 390, 768, and 1440 pixel widths, including loading states, canonical navigation, pagination, filters, dialogs, local access, and production denial. The browser scripts are currently local development aids rather than a committed test package.

See [project context](docs/PROJECT_CONTEXT.md), [decisions](docs/DECISIONS.md), and [progress](docs/PROGRESS.md) for the project source of truth.
