# TraceChain

TraceChain is a blockchain-based supply-chain traceability system with Self-Sovereign Identity credential verification. It is a TypeScript npm monorepo developed as a final-year project.

The current version includes a responsive React application, five stakeholder workspaces, Sign-In with Ethereum wallet authentication, an Express API, a server-side Veramo SSI foundation, encrypted IPFS content storage, shared role types, and the TraceChain Solidity contract suite. Primary operational dashboards and their batch, shipment, inventory, and detail views now use authenticated chain reads; several write-oriented and report screens still require migration from fixtures.

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
| Custody-transfer QR workflow             | Verified scanning and recipient-signed local receipt confirmation implemented         |
| Business persistence                     | Not implemented                                                                       |

## Repository structure

```text
apps/
  web/             React 19, Vite 8, React Router, ethers, and MetaMask Connect
  api/             Express 5, SIWE authentication, and in-memory repositories
packages/
  shared/          Shared company-role definitions and custody-transfer QR locator codec
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

Copy the shared root environment template. On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

On macOS or Linux:

```bash
cp .env.example .env
```

The real root `.env` file is ignored. The example file must contain safe defaults or placeholders only. Never add private keys, seed phrases, API secrets, real credentials, or personal supporting documents to the repository.

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

Copy the resulting backend contract addresses from `ignition/deployments/tracechain-local/deployed_addresses.json` into the ignored root `.env`. The tracked root example contains the deterministic addresses produced by the current local deployment. Restart both development servers after changing environment variables.

To create one real Manufacturer-to-Distributor transfer without redeploying, first set
`DEV_DISTRIBUTOR_WALLET` to an unlocked Hardhat account that is already an active Distributor and
has its matching Company Role Credential. Then run:

```bash
npm run dev:seed-custody-transfer
```

The command refuses any chain other than 31337, discovers the already-deployed traceability
contracts through the configured registries, creates only the minimum upstream local test records,
and prints the real transfer ID and canonical QR payload. It uses unlocked Hardhat accounts through
the local RPC and never reads or stores a private key. It does not create or bypass the
Distributor's SSI credential.

MetaMask can add the configured local network automatically. Hardhat account 0 is the deployed System Admin; use a different generated account to test a new company application because an active administrator cannot submit a stakeholder application. Hardhat development private keys are public test keys and must never be funded or reused on a public network.

The registration review screen submits a real `StakeholderRegistry.submitApplication` transaction locally. The API durably retains the submitted company name and registration number, bound to the application ID and profile hash, so the Admin issuance form is populated automatically. During this local-only phase the contract still records a `local://` profile reference containing no document bytes. Production use still requires encrypted IPFS upload before the transaction.

### Environment variables

The root `.env` is shared by the API and Vite. Vite explicitly exposes `VITE_API_BASE_URL`, the public `CHAIN_*` network values, and `CUSTODY_TRANSFER_ADDRESS`; server secrets remain backend-only:

```text
PORT=3000
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
SIWE_DOMAIN=localhost:5173
SIWE_URI=http://localhost:5173
CHAIN_ID=31337
CHAIN_NAME=TraceChain Local
CHAIN_RPC_URL=http://127.0.0.1:8545
CHAIN_CURRENCY_SYMBOL=ETH
STAKEHOLDER_REGISTRY_ADDRESS=0x...
CREDENTIAL_REGISTRY_ADDRESS=0x...
CUSTODY_TRANSFER_ADDRESS=0x...
DEV_DISTRIBUTOR_WALLET=0x...
AUTH_COOKIE_NAME=tracechain_session
AUTH_SESSION_TTL_SECONDS=28800
SEPOLIA_RPC_URL=https://example.invalid
VERAMO_KMS_SECRET_KEY=replace-with-a-strong-development-secret
TRACECHAIN_AUTHORITY_DID_ALIAS=tracechain-authority
BOOTSTRAP_ADMIN_WALLET=0x0000000000000000000000000000000000000000
IPFS_PINNING_API_URL=https://example.invalid/pinning/pinFileToIPFS
IPFS_PINNING_TOKEN=replace-with-a-scoped-pinning-token
IPFS_ENCRYPTION_KEY=replace-with-a-64-character-hexadecimal-key

VITE_API_BASE_URL=http://localhost:3000
```

The CORS origin, SIWE domain, and SIWE URI must match the address used to open the frontend.

Contract addresses and ABIs are backend configuration. For writes, the API validates the requested operation and returns an unsigned transaction containing the chain ID, destination, calldata, and value. MetaMask signs and broadcasts that transaction so the authenticated stakeholder remains the contract `msg.sender`; private wallet keys never reach the API.

For Sepolia, set `CHAIN_ID=11155111`, `CHAIN_NAME=Sepolia`, and replace `CHAIN_RPC_URL` with a browser-safe Sepolia endpoint. The active chain URL is deliberately public because MetaMask needs it in the browser. Restrict any embedded hosted-provider key to the intended frontend domains and Sepolia methods. Never put a privileged or unrestricted secret in a browser-exposed chain URL.

SSI variables are loaded lazily when an SSI request or command needs the Veramo agent, so API startup and SIWE-only tests do not require SSI secrets. Replace every SSI placeholder locally before bootstrapping or presenting a credential. `BOOTSTRAP_ADMIN_WALLET` is a public address; never provide its private key or recovery phrase.

## SSI and System Admin bootstrap

`@tracechain/ssi` configures Veramo 7 with did:ethr on Sepolia, JWT credentials, DID/credential/message metadata in a public JSON store, and SecretBox-encrypted private issuer keys in a separate JSON store. Runtime files are written under `.tracechain/veramo/` and ignored by Git. The beta `@veramo/data-store-json` package is accepted for this FYP prototype, not presented as an automatic production recommendation.

Generate a 32-byte hexadecimal development KMS secret without placing it in source code:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put that value, a real Sepolia RPC URL, the authority alias, and the public Admin wallet address in the ignored root `.env`, then run:

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

The login page restores an existing HttpOnly-cookie session without requesting wallet access. After an explicit user action, it reuses an already-authorized injected MetaMask extension provider when available, or uses MetaMask Connect for Mobile QR and extension fallback. Connection attempts are serialized and time-bounded, and progress plus cancellation remains visible inside the authentication card. It then requires the environment-configured chain, requests a five-minute nonce, builds an ERC-4361 message, requests a signature, and sends the signed message to the API. Local development uses chain 31337; the public test deployment uses Sepolia.

The API verifies the SIWE signature, address, domain, URI, chain ID, nonce, issue time, and expiration. It then creates a process-local session. Authentication proves wallet control only. Once signed in, a user may select a Company Role Credential JSON file; the browser sends it directly to `POST /api/ssi/company-role/verify` without storing it in browser storage.

Successful credential verification stores only a safe session summary and displays the verified role. Workspace access is unlocked only when both cryptographic verification and the current blockchain authorization check succeed. A URL, wallet address, fixture value, or local browser value never grants production access.

Login actions follow the current session state. Disconnected users connect through the authentication panel; wallet-authenticated users continue to credential verification; and locally verified users see their role, wallet, three-step authorization status, and an optional credential-replacement action. Local verification never unlocks a workspace before blockchain role and credential-status checks are implemented.

## Workspace UI

Integrated pages live in `apps/web/src/features/workspaces`, grouped by stakeholder and workflow. `WorkspaceApp.tsx` owns canonical routing and the access boundary; `WorkspaceScreen.tsx` dispatches detailed pages. Shared workspace presentation components, receipts, reports, and table controls are kept in focused subfolders.

The Admin overview, company-application, Company Credential, Access Control, and Registry Audit screens use authenticated blockchain gateway reads. Credential management lists issued Company Role Credentials, displays authoritative `CredentialRegistry` records, and prepares real MetaMask-signed suspend, reactivate, and permanent-revoke transactions. Access Control displays the contract-enforced role and stakeholder lifecycle and prepares real stakeholder suspension, reactivation, and revocation transactions. The operational gateway also reconstructs wallet-scoped ingredient, product, evidence-request, custody-transfer, and inventory lists from contract events, then refreshes every item through its current-state getter. Supplier, Manufacturer, Distributor, and Retailer primary dashboards and their batch, shipment, inventory, and detail screens therefore display current contract state. Evidence-response, transfer-creation, QR/history, stakeholder credential-card, receipt-write, and non-admin report screens still contain fixture data or simulation handlers and must be migrated before they are authoritative.

Access Control also provides live role counts and a configurable on-chain permission matrix. Every grant or removal is prepared by the API, signed by the System Admin in MetaMask, recorded by `StakeholderRegistry`, and enforced by the affected contracts. System Admin authority and structural custody routes remain fixed safety constraints. This contract upgrade requires a fresh deployment.

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

## Custody-transfer QR locator

TraceChain uses this canonical version 1 reference:

```text
tracechain://transfer/v1?chainId={chainId}&contract={custodyTransferAddress}&transferId={transferId}
```

The QR payload is only an untrusted locator for an existing on-chain transfer. It never contains
quantity, product, credential, company, private-document, key, wallet-secret, or receipt data.
The frontend generates the QR only from a successful on-chain `bytes32` transfer ID, using the
configured `CHAIN_ID` and `CUSTODY_TRANSFER_ADDRESS`. It supports live camera scanning, PNG/JPG/WebP
QR upload, and manual payload paste. Decoded QR fields are never treated as transfer data or shown
as verified data.

`POST /api/custody-transfers/resolve-qr` requires a fully credential-authorized SIWE session,
resolves `getTransfer(transferId)` through a read-only gateway, and verifies the configured chain,
contract deployment, `AwaitingReceipt` status, and intended recipient before returning a minimal
transfer summary. The frontend displays that summary only after this response succeeds. Scanning
never prepares or sends a transaction.

After resolution, `POST /api/custody-transfers/transactions/confirm-receipt` repeats the session,
credential authorization, transfer-status, and recipient checks before returning unsigned
`confirmReceipt` calldata. The frontend verifies the destination and chain, requires the connected
MetaMask account to equal the recipient, submits the transaction from that wallet, waits for its
receipt, and refreshes the authoritative transfer through `GET /api/custody-transfers/:transferId`.
The backend never signs or broadcasts the transaction. This local phase confirms the complete
quantity as usable with zero damaged/rejected units; quantity reconciliation and encrypted receipt
evidence remain future work.

## Validation

From the repository root:

```bash
npm run build
npm run typecheck
npm run test:auth
npm run test:blockchain
npm run test:ssi
npm run test:ssi-api
npm run test:contracts
npm run test:custody-transfers
npm run test:qr
npm run test:content --workspace @tracechain/api
npm run test:frontend
npm run test:workspace-access
npm run format:check
npm audit --omit=dev
```

The authentication suite contains 13 tests, the SSI package contains 15 offline tests, the SSI presentation API contains 10 tests, and the custody-transfer API contains 16 tests. The frontend suite includes wallet-adapter, authentication-hook, credential, workspace-access, QR, and receipt-confirmation tests. Custody-transfer API tests inject the blockchain gateway and do not require Hardhat or an RPC endpoint. Frontend QR tests inject the camera reader, API resolver, and transaction boundary; frontend wallet tests use mocked MetaMask clients and EIP-1193 providers. Neither suite contacts a relay or RPC endpoint. SSI tests use temporary files and a controlled local did:ethr resolver; they do not call Sepolia, spend test ETH, or depend on MetaMask.

The root `test:auth` and `test:ssi-api` commands build their internal shared and SSI workspace dependencies first, so they can run directly after a clean `npm ci`.

See [project context](docs/PROJECT_CONTEXT.md), [decisions](docs/DECISIONS.md), and [progress](docs/PROGRESS.md) for the project source of truth.
