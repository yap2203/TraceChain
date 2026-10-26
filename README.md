# TraceChain

TraceChain is a Blockchain-Based Supply Chain Traceability System with Self-Sovereign Identity credential verification. The project is being developed as a TypeScript npm monorepo for a final-year project.

The planned system combines a React web application, an Express API, Veramo-based SSI services, MetaMask, Ethereum Sepolia, QR codes, and Solidity smart contracts. Phase 1 established the monorepo foundation, Phase 2 added the responsive frontend shell, and Phase 3 implements wallet ownership authentication through Sign-In with Ethereum (ERC-4361). Credential verification, role authorisation, traceability workflows, and smart contracts are not implemented yet.

## Repository structure

```text
apps/
  web/          React, Vite, and TypeScript frontend
  api/          Express and TypeScript backend
packages/
  shared/       Shared types, roles, and constants
  ssi/          Future Veramo, DID, VC, and VP services
  contracts/    Future Solidity contracts and tests
docs/
  architecture/ Architecture documentation
  api/          API documentation
  ssi/          SSI documentation
  smart-contracts/ Smart-contract documentation
  testing/      Testing documentation
scripts/        Repository automation scripts
```

## Frontend routes

Frontend routes follow this React Router hierarchy:

```text
/
├── /login
├── /register-company
├── /admin
│   ├── /applications
│   ├── /credentials
│   └── /stakeholders
├── /supplier
│   ├── /ingredients
│   ├── /credentials
│   └── /evidence-requests
├── /manufacturer
│   ├── /ingredient-evidence
│   ├── /product-batches
│   └── /transfers
├── /distributor
│   ├── /incoming-shipments
│   ├── /inventory
│   └── /transfers
└── /retailer
    ├── /incoming-products
    ├── /traceability
    └── /reports
```

The root URL redirects to `/login`. Feature code is organised under `apps/web/src/features`, while reusable brand, layout, icon, and UI components live under `apps/web/src/components`.

The `/login` route provides the public TraceChain landing and MetaMask authentication experience. Wallet access is requested only after a user action. The application checks for Sepolia, requests a five-minute nonce, creates an ERC-4361 message, requests a MetaMask signature, and sends the message and signature to the API for verification. Existing server sessions are restored through an HttpOnly cookie without automatically requesting wallet access or a signature.

Wallet authentication proves wallet ownership only. It does not verify a Company Role Credential or assign a stakeholder role. System Admin, Supplier, Manufacturer, Distributor, and Retailer routes remain behind a credential-required gate until credential-based RBAC is implemented. Authenticated users can still continue to company registration.

The API uses repository interfaces for nonce and session storage. The included in-memory implementations are development-only: they are process-local, are cleared whenever the API restarts, and must be replaced with durable shared storage before production deployment.

## Prerequisites

- Node.js 22 or later
- npm 10 or later
- Git

## Installation

From the repository root:

```bash
npm install
```

Copy the example environment files before local development:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

On Windows PowerShell, use `Copy-Item` in place of `cp` if needed. The example files contain placeholders only; never put wallet private keys, seed phrases, or real credentials in the repository.

## Development

Run the frontend and backend together:

```bash
npm run dev
```

Or run a single workspace:

```bash
npm run dev:web
npm run dev:api
```

The default frontend URL is `http://localhost:5173`. The API defaults to `http://localhost:3000`, with its health endpoint at `GET /api/health`.

Phase 3 authentication settings are configured in `apps/api/.env`:

```text
SIWE_DOMAIN=localhost:5173
SIWE_URI=http://localhost:5173
SIWE_CHAIN_ID=11155111
AUTH_COOKIE_NAME=tracechain_session
AUTH_SESSION_TTL_SECONDS=28800
```

`SIWE_DOMAIN` and `SIWE_URI` must exactly match the origin used to open the frontend. The frontend API origin is configured through `VITE_API_BASE_URL` in `apps/web/.env`.

## Validation

```bash
npm run build
npm run typecheck
npm run format:check
npm run test:auth
npm audit
```

See [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) for confirmed scope and architecture, [docs/DECISIONS.md](docs/DECISIONS.md) for decisions, and [docs/PROGRESS.md](docs/PROGRESS.md) for current progress.
