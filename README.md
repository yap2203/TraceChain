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

The approved workspace layout, navigation icons, responsive sidebar, and light/dark themes are now used on the main `/admin`, `/supplier`, `/manufacturer`, `/distributor`, and `/retailer` routes. Each role root redirects to its overview. During local Vite development (`localhost`, `127.0.0.1`, or `::1`), all five workspaces open without account checks, with sample data and simulated UI interactions enabled. For example, open `http://localhost:5173/admin/overview`. No wallet, session request, or running API is required for these local workspace pages. Production builds and non-local hosts retain sign-in and credential checks.

Wallet authentication proves wallet ownership only. It does not verify a Company Role Credential or assign a stakeholder role. The current API always reports `credentialVerified: false`, so production business pages remain locked for every role. Changing a production URL never grants access. Authenticated users can sign out or continue to company registration. Local development access does not authenticate an account or grant backend permissions. Sample interactions do not save records or perform real credential verification or blockchain transactions; actions without implementations remain disabled.

Additional workspace routes include each role's `/overview`, `/credentials`, and `/reports`; retailer routes also include `/scan` and `/evidence-requests`. Existing URLs listed above are preserved. Short page aliases such as `/supplier/batches` redirect to their system equivalent (`/supplier/ingredients`).

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

## Workspace pages

Run `npm run dev:web` and open a normal workspace URL, such as `http://localhost:5173/admin/overview`. The separate preview route and feature folder have been removed. Login and registration retain their existing UI.

All approved page components live in `apps/web/src/features/workspaces/`:

```text
workspaces/
  admin/          applications/, credentials/, access-control/
  supplier/       batches/, evidence/, overview and credential pages
  manufacturer/   batches/, evidence/, transfers/
  distributor/    shipments/, transfers/, inventory and credential pages
  retailer/       receiving/, traceability/, evidence/
  receipts/       qr-gate/, confirmation/
  reports/        AuditReportPage.tsx and sections/
  shared/         ui/ controls and tokens, common presentation components
```

`WorkspaceApp.tsx` composes the layout, session gate, and lazy-loaded `WorkspaceScreen.tsx` page dispatcher. Its temporary local-development branch skips the authentication hook and enables sample UI controls for every stakeholder. Outside local development, `WorkspaceAccessGate.tsx` keeps business pages unmounted until a server-verified company role is available, and unfinished workflow controls remain disabled. Backend, SSI, and smart-contract integration must replace fixture data and simulation handlers before enabling live operations.

`workspace-navigation.ts` defines navigation and Lucide icons; `workspace-paths.ts` defines canonical routes. Styles in `workspace.css` are scoped to the workspace. Each substantial section stays in its workflow folder, with nearby `types.ts` and existing design `fixtures.ts`. Fixtures are development reference data, not authenticated business records.

All workspace paths begin with `/<role>/`:

| Role         | Pages                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| admin        | `overview`, `applications`, `credentials`, `stakeholders`, `reports`                                   |
| supplier     | `overview`, `ingredients`, `evidence-requests`, `credentials`, `reports`                               |
| manufacturer | `overview`, `ingredient-evidence`, `product-batches`, `transfers`, `credentials`, `reports`            |
| distributor  | `overview`, `incoming-shipments`, `inventory`, `transfers`, `credentials`, `reports`                   |
| retailer     | `overview`, `incoming-products`, `scan`, `traceability`, `evidence-requests`, `credentials`, `reports` |

Detail and form navigation uses these routes with search parameters where applicable. No backend business workflow or credential verifier is implemented by this frontend integration.

Page loading and wallet/session checks use a centered full-screen spinner with accessible status text. Workspace layouts adapt to mobile, tablet, and desktop widths; wide tables scroll within their own containers and dialogs fit the viewport.

Tables share client-side pagination through `components/ui/PaginatedTable.tsx`. Each table defaults to 10 records and lets users select 5, 10, 25, 50, or 100 records per page, with previous/next controls and a visible record range. Filtering, sorting, or changing page size resets the current page. Pagination operates on the currently supplied records; future backend lists will need server-side pagination for large datasets.

## Validation

```bash
npm run build
npm run typecheck
npm run format:check
npm run test:auth
npm audit
```

See [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) for confirmed scope and architecture, [docs/DECISIONS.md](docs/DECISIONS.md) for decisions, and [docs/PROGRESS.md](docs/PROGRESS.md) for current progress.
