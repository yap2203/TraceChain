# Self-Sovereign Identity

SSI is a confirmed TraceChain boundary, but its implementation has not started. The `@tracechain/ssi` package currently exports only a package marker; no Veramo dependency, agent, DID method, key-management plugin, credential store, or verification pipeline is configured.

## Planned responsibilities

- Manage organization and stakeholder DIDs through Veramo.
- Issue Company Role Credentials after System Admin approval.
- Let suppliers issue Ingredient Credentials.
- Create and verify Verifiable Presentations.
- Support selective disclosure of ingredient claims.
- Check signature validity, issuer trust, expiry, suspension, and revocation before using claims.
- Expose verified results to the API without trusting raw client claims.

## Security requirements

- MetaMask authentication is separate from credential issuance and verification.
- A wallet address alone never determines a stakeholder role.
- Invalid, expired, suspended, or revoked credentials must not grant access.
- Private keys, seed phrases, complete credentials, and sensitive identity documents must remain off-chain and outside the repository.
- On-chain records may contain hashes, identifiers, status references, and traceability events only.
- Suppliers control which ingredient claims are disclosed to a requester.

## Decisions still required

- DID method
- Veramo plugins and key-management strategy
- Credential schemas and proof formats
- Credential status and revocation mechanism
- Stakeholder-local repository technology
- Presentation request and selective-disclosure format

Do not treat the sample credential cards in the frontend as verified SSI data. They are UI fixtures until this package and its API integration are implemented.
