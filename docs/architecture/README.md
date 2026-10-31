# TraceChain Architecture

TraceChain is an npm monorepo with two applications and three packages. The current system combines a working React frontend and wallet-authentication API with starter packages for shared types, SSI, and smart contracts.

## Component boundaries

| Component        | Location             | Current responsibility                                                                                         |
| ---------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Web application  | `apps/web`           | React 19 UI, public onboarding pages, stakeholder workspaces, responsive tables, and MetaMask/SIWE client flow |
| API              | `apps/api`           | Express 5 health, SIWE sessions, and authenticated Company Role Credential presentation                        |
| Shared package   | `packages/shared`    | Cross-package company-role enum and role-to-workspace mapping                                                  |
| SSI package      | `packages/ssi`       | Veramo did:ethr agent, JWT credential issuance and verification, encrypted JSON storage, and Admin bootstrap   |
| Contract package | `packages/contracts` | Hardhat 3 toolchain and a starter `Counter` contract, tests, script, and Ignition module                       |

## Current request flow

1. The browser loads the React application from Vite.
2. The login page checks `GET /api/auth/session` without requesting wallet access.
3. After the user chooses to connect, MetaMask supplies an address on Sepolia.
4. The frontend requests an address-bound nonce from `POST /api/auth/nonce`.
5. The wallet signs an ERC-4361 message; the API validates it through `POST /api/auth/verify`.
6. The API stores the session in process memory and returns an HttpOnly cookie.
7. The wallet-only session proves wallet control and supplies no role.
8. An authenticated user may send a Company Role Credential JSON file to `POST /api/ssi/company-role/verify`.
9. The API verifies the credential against the session wallet and trusted authority, then stores only a safe local-verification summary.
10. Production stakeholder content remains locked because blockchain status has not been checked and authorization is not ready.

During local Vite development on `localhost`, `127.0.0.1`, or `::1`, stakeholder routes intentionally bypass the session hook so the integrated sample screens can be reviewed. This bypass exists only when `import.meta.env.DEV` is true and does not grant API, SSI, or blockchain permissions.

## Frontend composition

`App.tsx` owns the public and role route groups. `WorkspaceApp.tsx` resolves canonical paths, applies the local-development rule or production access gate, and lazy-loads `WorkspaceScreen.tsx`. Role and workflow components are grouped below `features/workspaces/`; shared workspace presentation controls remain below `features/workspaces/shared/`.

Wide tables use a shared client-side pagination wrapper and horizontal scrolling. Workspace dialogs, navigation, and grids adapt at mobile, tablet, and desktop widths. The frontend currently uses fixture data and simulated state transitions. These are presentation implementations, not persisted business operations.

## Trust boundaries

- MetaMask proves wallet control; it does not issue or verify company credentials.
- Company Role Credential claims must be cryptographically verified before role-based access is granted.
- Client routes, URL segments, fixture values, and browser storage are never trusted as role evidence.
- Private keys, seed phrases, complete credentials, supporting identity documents, and other sensitive values stay outside the repository and off-chain.
- The future blockchain layer may store hashes, status values, references, and traceability events, but not complete credentials.
- QR scanning alone must never transfer custody; the intended authenticated receiver must confirm with a wallet transaction.

## Current limitations

- Nonces and sessions use process-local memory and disappear on API restart.
- On-chain credential status verification and credential-based RBAC are not implemented.
- The current Veramo JSON store and holder-file export are development foundations, not a production custody design.
- Stakeholder workflows have no API persistence.
- The `Counter` contract is only a Hardhat toolchain example; TraceChain contracts and deployments do not exist yet.
- The exact database, DID method, QR payload, hosting platform, and production deployment topology remain undecided.
