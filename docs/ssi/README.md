# Self-Sovereign Identity

TraceChain now has a server-side Veramo SSI foundation in `@tracechain/ssi`. It creates and resolves `did:ethr` identifiers on Ethereum Sepolia, uses JWT proofs for W3C credentials and presentations, persists non-SQL JSON data, encrypts issuer key material, and provides typed Company Role Credential issuance and verification services.

## Planned responsibilities

- `KeyManager` with local KMS and `PrivateKeyStoreJson` protected by `SecretBox`.
- `DIDManager` and `EthrDIDProvider` for `did:ethr:sepolia`.
- `DIDResolverPlugin` backed by `ethr-did-resolver`.
- `CredentialPlugin` and `CredentialProviderJWT` for W3C JWT VC/VP creation and verification.
- `DataStoreJson` for credentials, presentations, messages, and public metadata.
- Idempotent Product Traceability Authority DID creation and System Admin bootstrap.
- Typed Company Role Credential validation using the shared `CompanyRole` enum.
- Signature, trusted issuer, subject DID, SIWE wallet binding, role, date, and local status checks.
- SHA-256 hashing of the encoded JWT for future blockchain registration.

The public DID/key metadata, messages, credentials, and presentations are stored separately from encrypted private-key data. Both files use queued atomic temporary-file replacement. The same public `VeramoJsonStore` instance is shared where Veramo requires DID and key metadata consistency.

## Security requirements

- MetaMask authentication is separate from credential issuance and verification.
- A wallet address alone never determines a stakeholder role.
- Invalid, expired, suspended, or revoked credentials must not grant access.
- Private keys, seed phrases, complete credentials, and sensitive identity documents must remain off-chain and outside the repository.
- On-chain records may contain hashes, identifiers, status references, and traceability events only.
- Suppliers control which ingredient claims are disclosed to a requester.
- `@veramo/data-store-json` is beta. It is acceptable for this FYP prototype but requires reassessment before production use.
- The credential's self-declared `ACTIVE` claim is not authoritative. On-chain status verification is mandatory before authorization.
- The Product Traceability Authority issuer DID is server-managed. Stakeholder and Admin wallet keys remain controlled by MetaMask.
- The bootstrap credential and complete credentials remain off-chain.

## Current bootstrap flow

1. Validate the configured public Admin Ethereum address.
2. Create or reuse the authority DID by alias.
3. Derive `did:ethr:sepolia:<wallet>` for the Admin subject without requesting its private key.
4. Find and reuse an existing active bootstrap credential, or issue one `SYSTEM_ADMIN` credential.
5. Save the issuer copy and return identifiers/status only.

The command is `npm run ssi:bootstrap-admin`. It requires the local variables documented in the root README and must not be run with placeholders.

## Still required

- On-chain `CredentialRegistry` and `StakeholderRegistry` status checks
- Credential-based RBAC and stakeholder route/API authorization
- Credential delivery/presentation flow for companies
- Production-grade durable key custody and storage review
- Ingredient Credentials and selective disclosure
- Presentation request and selective-disclosure format
- IPFS encryption, upload, pinning, and recovery design

Do not treat sample frontend credential cards as verified SSI data. No browser route exposes raw Veramo methods, and no stakeholder dashboard is unlocked by this phase.
