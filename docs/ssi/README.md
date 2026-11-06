# Self-Sovereign Identity

TraceChain has a server-side Veramo SSI foundation in `@tracechain/ssi`. It creates and resolves `did:ethr` identifiers on Ethereum Sepolia, uses JWT proofs for W3C credentials and presentations, persists non-SQL JSON data, encrypts issuer key material, and provides typed Company Role and Ingredient Credential services.

## Current responsibilities

- `KeyManager` with local KMS and `PrivateKeyStoreJson` protected by `SecretBox`.
- `DIDManager` and `EthrDIDProvider` for `did:ethr:sepolia`.
- `DIDResolverPlugin` backed by `ethr-did-resolver`.
- `CredentialPlugin` and `CredentialProviderJWT` for W3C JWT VC/VP creation and verification.
- `DataStoreJson` for credentials, presentations, messages, and public metadata.
- Idempotent Product Traceability Authority DID creation and System Admin bootstrap.
- Typed Company Role Credential validation using the shared `CompanyRole` enum.
- Typed `IngredientCredential` issuance with batch, Supplier wallet, ingredient, origin, date, quantity, unit, allergen, and certification claims.
- One server-derived issuer DID per Supplier wallet; a Supplier cannot choose another issuer through the API.
- Cryptographic Ingredient Credential verification and deterministic canonical SHA-256 hashing before blockchain preparation.
- Signature, trusted issuer, subject DID, SIWE wallet binding, role, date, and local status checks.
- SHA-256 hashing of the encoded JWT for future blockchain registration.

The public DID/key metadata, messages, credentials, and presentations are stored separately from encrypted private-key data. Both files use queued atomic temporary-file replacement. The same public `VeramoJsonStore` instance is shared where Veramo requires DID and key metadata consistency.

## Security requirements

- MetaMask authentication is separate from credential issuance and verification.
- A wallet address alone never determines a stakeholder role.
- Invalid, expired, suspended, or revoked credentials must not grant access.
- Private keys, seed phrases, complete credentials, and sensitive identity documents must remain off-chain and outside the repository.
- On-chain records may contain hashes, identifiers, status references, and traceability events only.
- The current JWT Ingredient Credential is verified and stored as a complete credential; selective disclosure is not implemented or claimed.
- `@veramo/data-store-json` is beta. It is acceptable for this FYP prototype but requires reassessment before production use.
- The credential's self-declared `ACTIVE` claim is not authoritative. On-chain status verification is mandatory before authorization.
- The Product Traceability Authority issuer DID is server-managed. Stakeholder and Admin wallet keys remain controlled by MetaMask.
- The bootstrap credential and complete credentials remain off-chain.
- Complete Ingredient Credentials and private batch metadata are AES-256-GCM encrypted before IPFS pinning. Ethereum receives only identifiers, hashes, the encrypted CID, lifecycle/status data, and traceability fields.

## Current bootstrap flow

1. Validate the configured public Admin Ethereum address.
2. Create or reuse the authority DID by alias.
3. Derive `did:ethr:sepolia:<wallet>` for the Admin subject without requesting its private key.
4. Find and reuse an existing active bootstrap credential, or issue one `SYSTEM_ADMIN` credential.
5. Save the issuer copy and return identifiers/status only.

The bootstrap command is `npm run ssi:bootstrap-admin`. After bootstrap, `npm run ssi:export-admin-credential` writes the active, cryptographically verified Admin credential to the ignored `.tracechain/holder/admin-company-role-credential.json` path. This is a development-only delivery bridge, and it refuses to silently replace a different file. Both commands require the local variables documented in the root README and must not be run with placeholders.

The API creates one lazy Veramo agent promise per process only when an SSI request arrives. `POST /api/ssi/company-role/verify` binds verification to the SIWE session wallet and configured authority DID. The complete credential is used only for verification; only its safe summary is retained in the process-local session.

## Supplier Ingredient Credential flow

1. Require the SIWE session, verified Supplier Company Role Credential, active on-chain Supplier status, and issuance/registration permissions.
2. Derive the Supplier subject wallet and Supplier-specific issuer DID on the server.
3. Issue the typed JWT VC and immediately verify its signature, issuer, subject, wallet binding, and dates.
4. Canonically serialize and SHA-256 hash the verified VC.
5. Encrypt the VC and private metadata with AES-256-GCM, pin the encrypted envelope to IPFS, and persist an ignored recovery record.
6. Prepare unsigned Ingredient Credential registration calldata. After MetaMask confirms it, re-read and match the record.
7. Prepare unsigned ingredient-batch registration calldata. After MetaMask confirms it, re-read and match the batch.

The prototype Veramo KMS holds each Supplier issuer DID key in the server-side encrypted JSON key store. This demonstrates distinct issuer identities without requesting Supplier wallet private keys. A production deployment needs organizational stakeholder key custody, rotation, recovery, access-control, audit, and multi-operator policy rather than relying on one application-server filesystem.

## Still required

- Production credential delivery and holder-wallet design (the Admin file export remains development-only).
- Production-grade organizational DID key custody, rotation, recovery, and durable workflow repositories.
- Redundant IPFS retention and encrypted-content recovery procedures.
- A separately designed presentation/selective-disclosure format if the project later requires selective disclosure; JWT VC issuance alone does not provide it.
- Migration of remaining Manufacturer, Distributor, Retailer, evidence, and report fixtures.

No browser route exposes raw Veramo methods. Supplier workspace access continues to depend on the existing Company Role Credential and blockchain authorization gate.
