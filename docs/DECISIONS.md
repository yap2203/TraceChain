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
- Use Ethers.js for Ethereum wallet and address utilities.
- Use the SIWE package for ERC-4361 message construction and verification.
- Use Vitest and Supertest for authentication tests.
- Access nonce and session storage through repository interfaces.
- Use development-only in-memory nonce and session repository implementations during Phase 3.

## Unconfirmed decisions

- Off-chain database technology
- Exact DID method
- Veramo plugins
- Smart-contract development framework
- Hosting and deployment platform
- Exact QR-code payload format
