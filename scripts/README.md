# Repository Scripts

This directory is reserved for versioned automation that applies to more than one TraceChain workspace. It is currently empty; development and validation commands live in the root and workspace `package.json` files.

Use the root commands for normal work:

```bash
npm run dev
npm run dev:web
npm run dev:api
npm run build
npm run typecheck
npm run test:auth
npm run test:orders
npm run format:check
```

Package-specific deployment or migration scripts should stay in the narrowest relevant package. For example, Hardhat scripts belong in `packages/contracts/scripts`, not here. Do not add scripts that embed credentials, private keys, seed phrases, or environment-specific secrets.

`test:orders` builds shared/SSI code, runs order API/security/DIDComm tests and order UI regressions,
then runs the isolated Hardhat suite. The manual role-by-role acceptance flow and fresh-deployment
configuration are in [the order test guide](../docs/ORDERS_PHYSICAL_FLOW_TEST_GUIDE.md).
