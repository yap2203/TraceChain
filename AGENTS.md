# Repository Instructions

Before making architectural or implementation decisions, read:

- `docs/PROJECT_CONTEXT.md`
- `docs/DECISIONS.md`
- `docs/PROGRESS.md`

Treat these documents as the repository's project source of truth.

## Working rules

- Preserve all existing user files and changes.
- Never commit, push, create branches, delete major files, or perform destructive Git operations unless explicitly requested.
- Never place wallet private keys, seed phrases, API secrets, real credentials, personal supporting documents, or sensitive identity data in the repository.
- Use TypeScript for the frontend, backend, SSI services, and shared packages.
- Use Solidity for smart contracts.
- Keep the frontend, backend, SSI, shared types, and smart contracts modular.
- Keep sensitive credentials off-chain.
- Verify credentials cryptographically before using their claims for role-based access control.
- Run relevant build and type-check commands after making changes.
- Cross-check `README.md` before completing changes and update it whenever setup, structure, commands, environment variables, endpoints, routes, or implemented capabilities change.
- Update `docs/PROGRESS.md` after completing a significant feature.
- Update `docs/DECISIONS.md` only after the user confirms an implementation decision.

## Code and file organisation

- Add a file, directory, dependency, or abstraction only when it has a clear current purpose.
- Keep small, page-specific code together; extract components only when they are reused or when doing so materially improves readability.
- Place code in the narrowest relevant app or package and keep package boundaries explicit.
- Do not commit generated build output, local databases, logs, caches, or environment files.
- Remove obsolete code and files when replacing them, while preserving unrelated user work.
- Prefer clear interface icons and natural, context-appropriate photography. Do not add artificial-looking AI imagery or decorative images without a concrete product purpose.
