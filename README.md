# TraceChain

TraceChain is a Blockchain-Based Supply Chain Traceability System with Self-Sovereign Identity credential verification. The project is being developed as a TypeScript npm monorepo for a final-year project.

The planned system combines a React web application, an Express API, Veramo-based SSI services, MetaMask, Ethereum Sepolia, QR codes, and Solidity smart contracts. Phase 1 provides only the project foundation; application workflows, credentials, and contracts are not implemented yet.

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

## Validation

```bash
npm run build
npm run typecheck
npm run format:check
```

See [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) for confirmed scope and architecture, [docs/DECISIONS.md](docs/DECISIONS.md) for decisions, and [docs/PROGRESS.md](docs/PROGRESS.md) for current progress.
