# @tracechain/ssi

This server-side package contains the TraceChain Veramo foundation for DIDs, Verifiable Credentials, Verifiable Presentations, encrypted local key management, credential persistence, and cryptographic Company Role Credential verification.

It uses `did:ethr` on Sepolia and JWT proof format. Public metadata and issuer copies of credentials use `@veramo/data-store-json`; private issuer keys use a separate JSON store encrypted by Veramo `SecretBox`. Callers must provide typed configuration. The package never reads environment variables directly.

The JSON data-store API is beta and is used for this FYP prototype. Runtime files belong under the ignored `.tracechain/veramo/` directory. Do not commit them.

## Commands

From the repository root:

```bash
npm run build --workspace @tracechain/ssi
npm run typecheck --workspace @tracechain/ssi
npm run test:ssi
```

The bootstrap and verification services deliberately return `authorizationReady: false`. A locally valid credential is not sufficient for RBAC until its hash and current status are verified against the future on-chain registries. MetaMask stakeholder keys remain outside this package.
