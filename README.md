# TraceChain

TraceChain is a blockchain-based supply-chain traceability system with Self-Sovereign Identity credential verification. It is a TypeScript npm monorepo developed as a final-year project.

The current version includes a responsive React application, five stakeholder workspaces, Sign-In with Ethereum wallet authentication, an Express API, a server-side Veramo SSI foundation, encrypted IPFS content storage, shared role types, and the TraceChain Solidity contract suite. The workspace screens still need to be migrated from presentation fixtures to live business services.

## Current implementation status

| Area                                     | Status                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Public login and company-registration UI | Three-step onboarding UI implemented; final API submission is not connected           |
| MetaMask and ERC-4361 authentication     | Environment-driven; local chain 31337 for testing and Sepolia as the public target    |
| Nonce and session storage                | Implemented in process memory for development                                         |
| Stakeholder workspace UI                 | Admin applications use the local chain; other workflow pages still need migration     |
| Responsive UI                            | Implemented for mobile, tablet, and desktop layouts                                   |
| Loading and table pagination             | Implemented; tables support 5, 10, 25, 50, or 100 rows per page                       |
| Company Role Credential presentation     | Authenticated JSON upload and safe session summary implemented                        |
| Company Role Credential verification     | JWT signature, issuer, wallet binding, role, dates, and local status implemented      |
| Credential-based RBAC                    | Local/API verification checks wallet role, lifecycle, credential hash and status      |
| SSI and Veramo services                  | did:ethr Sepolia agent, encrypted JSON storage, issuance, verification, and bootstrap |
| Smart contracts                          | Six modular TraceChain contracts plus an Ignition deployment module                   |
| Private IPFS content                     | AES-256-GCM envelope and injectable HTTP pinning gateway implemented                  |
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
- Blockchain status: `GET http://localhost:3000/api/blockchain/status`

### Local contract testing

The development environment can target the persistent Hardhat chain at `31337`. Start the node from `packages/contracts` and leave it running:

```bash
npx hardhat node --chain-id 31337
```

In a second terminal, deploy the complete module:

```bash
npx hardhat ignition deploy ignition/modules/TraceChain.ts --network localhost --deployment-id tracechain-local --reset
```

Copy the resulting addresses from `ignition/deployments/tracechain-local/deployed_addresses.json` into the ignored `apps/web/.env` and `apps/api/.env`. The tracked examples contain the deterministic addresses produced by the current local deployment. Restart both development servers after changing environment files.

MetaMask can add the configured local network automatically. Hardhat account 0 is the deployed System Admin; use a different generated account to test a new company application because an active administrator cannot submit a stakeholder application. Hardhat development private keys are public test keys and must never be funded or reused on a public network.

The registration review screen submits a real `StakeholderRegistry.submitApplication` transaction locally. During this local-only phase it records a `local://` profile reference containing no document bytes. Production use still requires encrypted IPFS upload before the transaction.

### Environment variables

`apps/api/.env`:

```text
PORT=3000
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
SIWE_DOMAIN=localhost:5173
SIWE_URI=http://localhost:5173
SIWE_CHAIN_ID=31337
CHAIN_RPC_URL=http://127.0.0.1:8545
STAKEHOLDER_REGISTRY_ADDRESS=0x...
CREDENTIAL_REGISTRY_ADDRESS=0x...
EVIDENCE_REGISTRY_ADDRESS=0x...
INGREDIENT_REGISTRY_ADDRESS=0x...
PRODUCT_REGISTRY_ADDRESS=0x...
CUSTODY_TRANSFER_ADDRESS=0x...
AUTH_COOKIE_NAME=tracechain_session
AUTH_SESSION_TTL_SECONDS=28800
SEPOLIA_RPC_URL=https://example.invalid
IPFS_PINNING_API_URL=https://example.invalid/pinning/pinFileToIPFS
IPFS_PINNING_TOKEN=replace-with-a-scoped-pinning-token
IPFS_GATEWAY_URL=https://ipfs.io/ipfs/
IPFS_ENCRYPTION_KEY=replace-with-a-32-byte-encryption-key
VERAMO_KMS_SECRET_KEY=replace-with-a-strong-development-secret
TRACECHAIN_AUTHORITY_DID_ALIAS=tracechain-authority
BOOTSTRAP_ADMIN_WALLET=0x0000000000000000000000000000000000000000
```

`apps/web/.env`:

```text
VITE_API_BASE_URL=http://localhost:3000
VITE_CHAIN_ID=31337
VITE_CHAIN_NAME=TraceChain Local
VITE_CHAIN_RPC_URL=http://127.0.0.1:8545
VITE_CHAIN_CURRENCY_SYMBOL=ETH
VITE_STAKEHOLDER_REGISTRY_ADDRESS=0x...
VITE_CREDENTIAL_REGISTRY_ADDRESS=0x...
VITE_EVIDENCE_REGISTRY_ADDRESS=0x...
VITE_INGREDIENT_REGISTRY_ADDRESS=0x...
VITE_PRODUCT_REGISTRY_ADDRESS=0x...
VITE_CUSTODY_TRANSFER_ADDRESS=0x...
```

The CORS origin, SIWE domain, and SIWE URI must match the address used to open the frontend.

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

The credential verification service returns a deterministic SHA-256 hash used for blockchain registration. After local cryptographic verification, the API checks the session wallet, role, stakeholder lifecycle, credential hash, subject, type, and current status against the configured registries. The constructor-created System Admin is handled as a narrow bootstrap exception: the verified credential must claim `SYSTEM_ADMIN`, and the wallet must equal the active on-chain administrator.

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

The `/register-company` route provides the complete three-step application interface: company and representative information, MetaMask wallet association, required supporting-document selection with 10 MB validation, review, and declaration. It can submit a real application transaction to the configured local registry. Encrypted-IPFS document submission remains fail-closed until its application API is connected.

### Local workspace access

Localhost uses the same wallet, credential, on-chain role, and status gate as other environments. There is no account-free sample-data bypass. An authorized session is required before workspace controls are enabled.

## Authentication

The login page restores an existing HttpOnly-cookie session without requesting wallet access. After an explicit user action, it connects MetaMask, requires the environment-configured chain, requests a five-minute nonce, builds an ERC-4361 message, requests a signature, and sends the signed message to the API. Local development uses chain 31337; the public test deployment uses Sepolia.

The API verifies the SIWE signature, address, domain, URI, chain ID, nonce, issue time, and expiration. It then creates a process-local session. Authentication proves wallet control only. Once signed in, a user may select a Company Role Credential JSON file; the browser sends it directly to `POST /api/ssi/company-role/verify` without storing it in browser storage.

Successful credential verification stores only a safe session summary and displays the verified role. Workspace access is unlocked only when both cryptographic verification and the current blockchain authorization check succeed. A URL, wallet address, fixture value, or local browser value never grants production access.

Login actions follow the current session state. Disconnected users connect through the authentication panel; wallet-authenticated users continue to credential verification; and locally verified users see their role, wallet, three-step authorization status, and an optional credential-replacement action. Local verification never unlocks a workspace before blockchain role and credential-status checks are implemented.

## Workspace UI

Integrated pages live in `apps/web/src/features/workspaces`, grouped by stakeholder and workflow. `WorkspaceApp.tsx` owns canonical routing and the access boundary; `WorkspaceScreen.tsx` dispatches detailed pages. Shared workspace presentation components, receipts, reports, and table controls are kept in focused subfolders.

The Admin overview and company-application screens read the configured `StakeholderRegistry` directly and show real loading, empty, and error states. Application rejection is a real administrator transaction. Remaining credential, access-control, supplier, manufacturer, distributor, retailer, receipt, and report screens still contain fixture data or simulation handlers and must be migrated before they are authoritative. A centered accessible spinner covers lazy page loading and wallet/session checks.

## Smart contracts

`packages/contracts` uses Hardhat 3 and Solidity 0.8.34. From that package:

See the [smart-contract process and verification guide](packages/contracts/README.md) for deployment wiring, role permissions, lifecycle transitions, end-to-end workflows, and known limitations.

```bash
npx hardhat compile
npx hardhat test
```

The contract suite contains stakeholder/application and reviewed role-change management, credential lifecycle, evidence requests, ingredient batches, product composition, and custody/inventory transfers. Deploy and wire all contracts as one module:

```bash
npx hardhat ignition deploy ignition/modules/TraceChain.ts --network sepolia
```

Resume the same Ignition deployment after a provider interruption; do not deploy contracts individually. Sepolia settings use Hardhat configuration variables named `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY`; never commit their real values.

Private company documents and evidence are encrypted before being sent to a configured pinning provider. Only their CID and integrity hash belong on-chain. `IPFS_ENCRYPTION_KEY` must decode to exactly 32 bytes and must be backed up outside the repository; losing it makes encrypted content unrecoverable.

## Validation

From the repository root:

```bash
npm run build
npm run typecheck
npm run test:auth
npm run test:ssi
npm run test:ssi-api
npm run test:contracts
npm run test:content --workspace @tracechain/api
npm run test:frontend
npm run test:workspace-access
npm run format:check
npm audit --omit=dev
```

The authentication suite contains 13 tests, the SSI package contains 15 offline tests, the SSI presentation API contains 8 tests, and the frontend contains 9 authentication-presentation, credential-panel, and workspace-access tests. SSI tests use temporary files and a controlled local did:ethr resolver; they do not call Sepolia, spend test ETH, or depend on MetaMask.

The root `test:auth` and `test:ssi-api` commands build their internal shared and SSI workspace dependencies first, so they can run directly after a clean `npm ci`.

See [project context](docs/PROJECT_CONTEXT.md), [decisions](docs/DECISIONS.md), and [progress](docs/PROGRESS.md) for the project source of truth.
