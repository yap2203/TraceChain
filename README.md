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
| Company Role Credential presentation     | Authenticated JSON upload and safe session summary implemented                        |
| Company Role Credential verification     | JWT signature, issuer, wallet binding, role, dates, and local status implemented      |
| Credential-based RBAC                    | Remains fail-closed until on-chain status checks are implemented                      |
| SSI and Veramo services                  | did:ethr Sepolia agent, encrypted JSON storage, issuance, verification, and bootstrap |
| Smart contracts                          | Hardhat toolchain and Counter example only                                            |
| Business persistence                     | Not implemented                                                                       |

## Repository structure

```text
apps/
  web/             React 19, Vite 8, React Router, ethers, and MetaMask Connect
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
- MetaMask browser extension or MetaMask Mobile for the wallet sign-in flow

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

The root development command builds the shared and SSI workspaces before starting Vite and the API, so it also works directly after a clean `npm ci`.

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
VITE_SEPOLIA_RPC_URL=https://sepolia.example.invalid
```

The CORS origin, SIWE domain, and SIWE URI must match the address used to open the frontend.

Replace the example-invalid `VITE_SEPOLIA_RPC_URL` with a browser-safe Sepolia endpoint. This is public browser configuration, not a place for a private key. If a hosted RPC provider key is embedded in this URL, restrict it to the intended frontend domains and Sepolia methods in the provider dashboard. Never use a privileged or unrestricted secret in a `VITE_` variable.

SSI variables are loaded lazily when an SSI request or command needs the Veramo agent, so API startup and SIWE-only tests do not require SSI secrets. Replace every SSI placeholder locally before bootstrapping or presenting a credential. `BOOTSTRAP_ADMIN_WALLET` is a public address; never provide its private key or recovery phrase.

## SSI and System Admin bootstrap

`@tracechain/ssi` configures Veramo 7 with did:ethr on Sepolia, JWT credentials, DID/credential/message metadata in a public JSON store, and SecretBox-encrypted private issuer keys in a separate JSON store. Runtime files are written under `.tracechain/veramo/` and ignored by Git. The beta `@veramo/data-store-json` package is accepted for this FYP prototype, not presented as an automatic production recommendation.

Generate a 32-byte hexadecimal development KMS secret without placing it in source code:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put that value, a real Sepolia RPC URL, the authority alias, and the public Admin wallet address in the ignored `apps/api/.env`, then run:

```bash
npm run ssi:bootstrap-admin
npm run ssi:export-admin-credential
```

Do not run these commands with `.env.example` placeholders. The bootstrap command creates or reuses the server-managed Product Traceability Authority DID, derives the Admin subject DID from the public wallet address, and issues at most one active bootstrap `SYSTEM_ADMIN` Company Role Credential. The export command copies that verified credential to `.tracechain/holder/admin-company-role-credential.json` for development-only holder delivery. It will not silently overwrite a different credential. CLI output contains safe identifiers and status only. The credential and encrypted issuer key remain off-chain; MetaMask continues to control the Admin wallet key.

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

The login page restores an existing HttpOnly-cookie session without initializing MetaMask Connect or requesting wallet access. The authentication panel provides Browser extension and Mobile QR tabs. The extension tab uses the installed browser wallet, while the mobile tab explicitly selects MetaMask Connect's official QR/deep-link transport even when the extension is installed. Selecting Mobile QR clears only MetaMask Connect's persisted transport-choice marker before the mobile client starts, preventing a previous extension choice from being silently reused. A QR connection only establishes the EIP-1193 wallet provider; TraceChain still requires Sepolia, requests a five-minute nonce, builds an ERC-4361 message, asks the connected wallet to sign it, and sends the signed message to the API.

The desktop QR state explains that approval and signing continue in MetaMask Mobile and provides a cancel action. Rejected, expired, and failed connections return to a retryable state. Logout requests both API-session deletion and wallet-connection disconnection when supported. TraceChain does not place private keys, SIWE messages, signatures, or credential files in browser local storage.

The API verifies the SIWE signature, address, domain, URI, chain ID, nonce, issue time, and expiration. It then creates a process-local session. Authentication proves wallet control only. Once signed in, a user may select a Company Role Credential JSON file; the browser sends it directly to `POST /api/ssi/company-role/verify` without storing it in browser storage.

Successful local credential verification stores only a safe session summary and displays the verified role. Production workspace records remain locked because blockchain status has not been checked and `authorizationReady` remains `false`. A URL, wallet address, fixture value, or local browser value must never grant access.

Login actions follow the current session state. Disconnected users connect through the authentication panel; wallet-authenticated users continue to credential verification; and locally verified users see their role, wallet, three-step authorization status, and an optional credential-replacement action. Local verification never unlocks a workspace before blockchain role and credential-status checks are implemented.

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
npm run test:ssi-api
npm run test:frontend
npm run test:workspace-access
npm run format:check
npm audit --omit=dev
```

The authentication suite contains 13 tests, the SSI package contains 15 offline tests, the SSI presentation API contains 8 tests, and the frontend contains 26 wallet-adapter, authentication-hook, presentation, credential-panel, and workspace-access tests. Frontend wallet tests use mocked MetaMask clients and EIP-1193 providers; they do not contact a relay or RPC endpoint. SSI tests use temporary files and a controlled local did:ethr resolver; they do not call Sepolia, spend test ETH, or depend on MetaMask.

The root `test:auth` and `test:ssi-api` commands build their internal shared and SSI workspace dependencies first, so they can run directly after a clean `npm ci`.

See [project context](docs/PROJECT_CONTEXT.md), [decisions](docs/DECISIONS.md), and [progress](docs/PROGRESS.md) for the project source of truth.
