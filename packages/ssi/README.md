# @tracechain/ssi

This package is the boundary for future Veramo agent configuration, DIDs, Verifiable Credentials, Verifiable Presentations, selective disclosure, and cryptographic verification.

It currently has no runtime implementation or external SSI dependencies. Its public entry point exports nothing while the DID method, Veramo plugins, credential schemas, key management, storage, and credential-status approach remain unconfirmed.

## Commands

From the repository root:

```bash
npm run build --workspace @tracechain/ssi
npm run typecheck --workspace @tracechain/ssi
```

Future code in this package must keep private keys, seed phrases, complete credentials, and sensitive identity data out of the repository and off-chain. Credential claims must be cryptographically verified before the API uses them for role-based access control. The current frontend credential screens contain sample fixtures only.
