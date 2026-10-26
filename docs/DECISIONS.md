# Project Decisions

## Confirmed decisions

- Use one GitHub repository as an npm monorepo.
- Work directly on `main`; do not create additional branches unless requested later.
- Use TypeScript for React, Express, Veramo, and shared code.
- Use Solidity for smart contracts.
- Use npm workspaces.
- Use the folder structure `apps/*` and `packages/*`.
- Use React Router for frontend route composition.
- Organise frontend implementation by feature with shared UI and layout components.

## Unconfirmed decisions

- Ethereum client library: Ethers.js or another library
- Off-chain database technology
- Exact DID method
- Veramo plugins
- Smart-contract development framework
- Hosting and deployment platform
- Testing frameworks
- Exact QR-code payload format
