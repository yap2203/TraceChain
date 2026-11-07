# TraceChain API

## DIDComm ciphertext relay

Authenticated, currently authorized Manufacturer and Supplier sessions use `/api/didcomm` for the Stage 1 secure-message proof of concept:

- `POST /binding/challenge` issues a short-lived wallet-bound challenge.
- `POST /binding` verifies a `did:key` DID-JWT control proof and saves the public SIWE-wallet association.
- `GET /directory` returns verified public messaging recipients.
- `GET /mailbox` returns only envelopes involving the authenticated company's bound DID.
- `POST /relay` accepts only the Manufacturer request and Supplier acknowledgement message types with role, recipient, expiry, duplicate and thread checks.

The API stores encrypted DIDComm envelopes and routing metadata only. Participant private keys and decrypted message bodies are never accepted by these endpoints.

The integrated production evidence flow also provides participant-scoped retrieval and separate
verification/decision operations:

- `GET /api/production-flow/evidence-requests/:requestId`
- `GET /api/production-flow/evidence-requests/:requestId/review`
- `POST /api/production-flow/evidence-requests/:requestId/verify`
- `POST /api/production-flow/evidence-requests/:requestId/accept/prepare`
- `POST /api/production-flow/evidence-requests/:requestId/close/prepare`

Private details are restricted to the exact Supplier and Manufacturer wallets recorded for the
request. The authenticated API returns the existing backend-signed VP so the Supplier browser can
encrypt it for the verified DIDComm recipient; plaintext is not written to relay logs or URLs.

The Express API defaults to `http://localhost:3000`. It accepts credentialed browser requests only from the configured `FRONTEND_URL` origin. All authentication responses set `Cache-Control: no-store`, and authentication request bodies are limited to 10 KB.

## Verified stakeholder directory

`GET /api/stakeholders` requires an authorized HttpOnly-cookie session and returns only active, currently registry-validated stakeholder display records:

```json
{
  "stakeholders": [
    {
      "companyName": "Swift Distribution Sdn. Bhd.",
      "role": "DISTRIBUTOR",
      "walletAddress": "0x...",
      "active": true
    }
  ]
}
```

Company registration numbers, raw credentials, encrypted payloads, private profile data, and keys are never returned by this endpoint. Wallet addresses remain the authoritative identifiers for authorization and transactions; company names are verified presentation data.

## Environment

Copy the repository-root `.env.example` to the repository-root `.env`. The API loads this file using a repository-relative absolute path, independent of the terminal working directory. Available API values are:

| Variable                         | Default example          | Purpose                               |
| -------------------------------- | ------------------------ | ------------------------------------- |
| `PORT`                           | `3000`                   | HTTP port                             |
| `FRONTEND_URL`                   | `http://localhost:5173`  | Exact CORS origin                     |
| `NODE_ENV`                       | `development`            | Controls production cookie security   |
| `SIWE_DOMAIN`                    | `localhost:5173`         | Expected ERC-4361 domain              |
| `SIWE_URI`                       | `http://localhost:5173`  | Expected ERC-4361 URI                 |
| `CHAIN_ID`                       | `31337`                  | Active contract and SIWE chain ID     |
| `CHAIN_NAME`                     | `TraceChain Local`       | Browser-visible network name          |
| `CHAIN_RPC_URL`                  | Placeholder URL          | Ledger used for authorization reads   |
| `CHAIN_CURRENCY_SYMBOL`          | `ETH`                    | Browser-visible native token symbol   |
| `STAKEHOLDER_REGISTRY_ADDRESS`   | Zero-address placeholder | Deployed stakeholder registry         |
| `CREDENTIAL_REGISTRY_ADDRESS`    | Zero-address placeholder | Deployed credential registry          |
| `INGREDIENT_REGISTRY_ADDRESS`    | Address placeholder      | Deployed ingredient registry          |
| `EVIDENCE_REGISTRY_ADDRESS`      | Address placeholder      | Deployed evidence registry            |
| `PRODUCT_REGISTRY_ADDRESS`       | Address placeholder      | Deployed product registry             |
| `CUSTODY_TRANSFER_ADDRESS`       | Address placeholder      | Deployed custody-transfer contract    |
| `VITE_PUBLIC_APP_URL`            | `http://localhost:5173`  | Canonical public product-QR origin    |
| `AUTH_COOKIE_NAME`               | `tracechain_session`     | Session-cookie name                   |
| `AUTH_SESSION_TTL_SECONDS`       | `28800`                  | Session lifetime in seconds           |
| `SEPOLIA_RPC_URL`                | Placeholder URL          | did:ethr Sepolia resolver/provider    |
| `VERAMO_KMS_SECRET_KEY`          | Placeholder only         | 32-byte hex SecretBox encryption key  |
| `TRACECHAIN_AUTHORITY_DID_ALIAS` | `tracechain-authority`   | Authority DID lookup alias            |
| `BOOTSTRAP_ADMIN_WALLET`         | Zero-address placeholder | Public Admin wallet address           |
| `IPFS_PINNING_API_URL`           | Placeholder URL          | Encrypted credential pinning endpoint |
| `IPFS_PINNING_TOKEN`             | Placeholder only         | Scoped server-side pinning token      |
| `IPFS_ENCRYPTION_KEY`            | Placeholder only         | 32-byte hex credential encryption key |

`FRONTEND_URL`, `SIWE_DOMAIN`, and `SIWE_URI` must match the frontend origin used in the browser.

The root template also contains `DEV_DISTRIBUTOR_WALLET` for the chain-31337 seed command. It is a
public unlocked Hardhat address consumed by the CLI, not an API runtime secret.

For deployed product labels, `VITE_PUBLIC_APP_URL` must be the externally reachable HTTPS
application origin. Its URL parameters never choose the API's RPC endpoint.

SSI variables are loaded lazily when an SSI operation needs them. Blockchain RPC and registry configuration are required for direct login authorization, although injected SIWE unit tests do not require a live chain. The API and frontend both use `CHAIN_ID`; replace the RPC and registry placeholders with values from that same network. The example KMS value and zero addresses intentionally fail SSI operations or command validation. Never provide or store the Admin wallet private key.

## Endpoints

### `GET /api/health`

Returns API availability:

```json
{ "status": "ok", "service": "tracechain-api" }
```

### `POST /api/auth/nonce`

Accepts a valid Ethereum address:

```json
{ "address": "0x..." }
```

Returns a cryptographically random, address-bound nonce with a five-minute expiry:

```json
{ "nonce": "...", "expiresAt": "2026-10-29T08:05:00.000Z" }
```

### `POST /api/auth/verify`

Accepts a complete ERC-4361 message and wallet signature:

```json
{ "message": "...", "signature": "0x..." }
```

The API verifies the signature, recovered address, configured domain, URI and chain ID, nonce, issue time, and expiration. A successful request consumes the nonce, creates a server-side session, sets an HttpOnly SameSite=Lax cookie, and returns:

EOA wallets are supported. ERC-1271 contract-wallet verification is not configured or claimed.

```json
{
  "authenticated": true,
  "address": "0x...",
  "credentialVerified": false,
  "authorizationStatus": "AUTHORIZED",
  "authorizationReady": true,
  "role": "SUPPLIER",
  "expiresAt": "...",
  "message": "Wallet verified and currently authorized by the configured registries."
}
```

The response may instead report `UNREGISTERED`, `APPLICATION_PENDING`, `ADDITIONAL_EVIDENCE_REQUIRED`, `APPLICATION_REJECTED`, `ACTIVATION_PENDING`, `SUSPENDED`, `REVOKED`, `EXPIRED`, `UNAUTHORIZED`, or `UNAVAILABLE`. `credentialVerified` and `locallyVerified` remain false because login does not verify an off-chain VC.

### `GET /api/auth/session`

Returns the authenticated response above for a valid cookie, or:

```json
{ "authenticated": false }
```

### `POST /api/auth/logout`

Deletes the server-side session, clears the cookie, and returns `204 No Content`.

### `POST /api/ssi/company-role/verify` (separate diagnostic capability)

Requires the HttpOnly SIWE session cookie and accepts a JSON credential only:

```json
{ "credential": { "...": "W3C Company Role Credential" } }
```

The request is limited to 256 KB and rejects extra fields such as a submitted wallet address. The wallet comes exclusively from the verified SIWE session. The service resolves the configured authority DID by alias and checks the JWT signature, trusted issuer, subject DID, wallet binding, shared role, issuance and expiration dates, and local status. It then checks the wallet, role, credential hash, stakeholder lifecycle, and effective credential status through the configured `StakeholderRegistry`.

A successful response contains safe metadata only: `verified`, `credentialId`, `role`, `expirationStatus`, `locallyVerified`, `onChainStatusChecked`, `authorizationReady`, `reasons`, and a safe session summary. It never returns the credential, JWT, credential hash, issuer DID, or subject DID. `authorizationReady` becomes true only when both cryptographic and blockchain checks succeed. An unavailable RPC or missing contract returns `BLOCKCHAIN_AUTHORIZATION_UNAVAILABLE` with HTTP 503.

### `POST /api/ssi/company-role/issue`

Requires a blockchain-authorized System Admin session whose wallet is also the deployed contract administrator. The request contains an application ID, the confirmed on-chain role, independently verified company registration number, company name, and expiration date. The backend issues and cryptographically verifies the VC, encrypts and pins its deterministic serialization, and persists a restart-safe workflow record before returning unsigned transactions. Stakeholder approval is confirmed first, followed by credential registration. A retry reuses the same credential and CID and returns only unfinished transactions. The plaintext credential is returned for holder delivery but is never written to Ethereum.

### `POST /api/ingredient-batches/prepare`

Requires an authenticated session with a cryptographically verified Supplier Company Role Credential, active matching on-chain Supplier status, and both `ISSUE_INGREDIENT_CREDENTIAL` and `REGISTER_INGREDIENT` permissions. The wallet and Supplier issuer DID are derived server-side; the client cannot select either.

The request contains the batch reference, ingredient name, category, origin, production/expiry dates, positive integer quantity, unit, allergen information, and certification names. The service issues a typed JWT `IngredientCredential`, verifies its signature and wallet/issuer binding, deterministically hashes the canonical credential, encrypts the complete VC plus private metadata with AES-256-GCM, and pins only the encrypted envelope to IPFS. It then returns one of:

- `CREDENTIAL_REGISTRATION_REQUIRED` with unsigned `CredentialRegistry.registerCredential` calldata;
- `BATCH_REGISTRATION_REQUIRED` with unsigned `IngredientRegistry.registerBatch` calldata, only after the credential record is re-read and matched;
- `COMPLETE`, only after the batch record is re-read and matched.

Retries reuse the persisted workflow under `.tracechain/issuance/ingredient-batches.json` and resume from the first incomplete on-chain stage. The API never signs or broadcasts either transaction and never returns the full credential, encryption key, or plaintext private metadata.

### `GET /api/ingredient-batches`

Requires the same Supplier authorization. The API obtains batch IDs from `IngredientBatchRegistered` events, re-reads each batch with `getBatch`, filters by the authenticated Supplier wallet, and merges authorized private metadata from the encrypted local workflow envelope. It does not accept a Supplier wallet query parameter.

### Production flow endpoints

The following endpoints require a SIWE session and a fresh matching on-chain role, Company Role credential-record, and permission check. They use the session wallet as the actor and never accept a caller-selected sender wallet:

- `GET /api/production-flow/ingredients` lists active Supplier ingredient batches for a Manufacturer and marks batches already accepted for that Manufacturer.
- `POST /api/production-flow/evidence-requests/prepare` creates or resumes an encrypted, random-challenge evidence request and returns unsigned `EvidenceRegistry.requestEvidence` calldata until the exact contract record exists.
- `GET /api/production-flow/evidence-requests` returns authoritative request state scoped to the authenticated Manufacturer or intended Supplier.
- `POST /api/production-flow/evidence-requests/:requestId/respond/prepare` retrieves the intended Supplier's server-authorized issued Ingredient Credential, creates and verifies a challenge-bound VP containing the complete credential, encrypts it, and returns unsigned `respond` calldata.
- `POST /api/production-flow/evidence-requests/:requestId/accept/prepare` decrypts and cryptographically verifies the stored VP, challenge, Supplier issuer, batch, credential ID/hash, dates, current credential state, and Supplier role before returning unsigned `accept` calldata.
- `POST /api/production-flow/products/prepare` requires accepted evidence and sufficient available quantity for every ingredient, encrypts private product metadata, and returns unsigned `ProductRegistry.createProduct` calldata.
- `GET /api/production-flow/distributors` lists currently authorized Distributor wallets discovered from registry events and refreshed through `roleOf`.
- `POST /api/production-flow/transfers/prepare` validates the Manufacturer, product transferability, inventory, intended Distributor, quantity, and arrival date before returning unsigned `CustodyTransfer.createTransfer` calldata. Completion is reported only after `getTransfer` matches and reports `AwaitingReceipt`.
- `GET /api/production-flow/distributor/inventory` returns only positive available product inventory previously received by the authenticated, authorized Distributor.
- `GET /api/production-flow/retailers` returns active verified Retailer identities as company name, role, and wallet address; the wallet remains the transaction recipient.
- `POST /api/production-flow/distributor/transfers/prepare` rechecks Distributor authorization, product transferability, inventory, Retailer role and permission, encrypts shipment details, and returns idempotent unsigned `CustodyTransfer.createTransfer` calldata. A retry reports completion only after the on-chain record matches and is `AwaitingReceipt`.

Workflow retries reuse ignored metadata under `.tracechain/issuance/production-flow.json` and reject changed inputs. Complete credentials, VPs, private metadata, encryption keys, and pinning credentials are never returned to the browser. The current JWT VP contains the complete Ingredient Credential; selective disclosure is not supported or claimed.

### `POST /api/custody-transfers/resolve-qr`

Requires a SIWE session currently authorized against the blockchain registries. The request contains only the Stage 1 locator:

```json
{ "qrPayload": "tracechain://transfer/v1?chainId=31337&contract=0x...&transferId=0x..." }
```

The API verifies the configured chain and `CUSTODY_TRANSFER_ADDRESS`, reads
`getTransfer(transferId)`, requires status `1` (`AwaitingReceipt`), and requires the SIWE wallet to
equal the on-chain recipient. A successful response contains the safe transfer fields plus readable
product/company presentation and current usable, damaged, and rejected totals. Technical IDs and
wallets are kept in the frontend's collapsed Technical details.

Resolution is read-only. It does not call `confirmReceipt`, prepare a transaction, or change
custody. The frontend supports canonical QR generation plus camera, image-file, and manual-paste
scanning.

### `POST /api/product-traceability/resolve`

Accepts a canonical product link in `{ "qrPayload": "https://.../trace/product?..." }`. It is a
safely public, read-only endpoint and always resolves through the server-configured chain,
ProductRegistry, IngredientRegistry, CredentialRegistry, and CustodyTransfer gateways. It rejects
malformed or non-canonical parameters, a different application origin, chain, or ProductRegistry,
and unknown products.

The public response contains readable product and ingredient references, lifecycle and credential
verification summaries, verified stakeholder company names, current custody organisation, and a
chronological custody timeline. It excludes quantities, credential IDs, wallets, transaction hashes,
complete credentials, private claims, CIDs, encrypted content, keys, and private documents. If the
request includes an existing fully authorized session cookie, the response may add those permitted
technical IDs, wallets, quantities, and transaction hashes under a separate `technical` object.
Resolution never prepares or submits a transaction and never confirms receipt.

### `POST /api/custody-transfers/transactions/confirm-receipt`

Requires the fully authorized intended-recipient SIWE session. The request includes `transferId`,
`actualQuantity`, `damagedQuantity`, `rejectedQuantity`, optional ISO `actualArrivalAt`, receipt
`notes`, and up to three optional PNG/JPEG/WebP/PDF evidence envelopes. Quantities are non-negative
safe-integer strings and damaged plus rejected cannot exceed actual.

The service re-reads the transfer, rechecks current authorization and `AwaitingReceipt`, calculates
usable quantity, deterministically serializes the private metadata, encrypts it through the
injectable content store, and persists only its encrypted envelope and CID in ignored workflow
metadata. Drafts are keyed by transfer, action kind, and deterministic content hash; exact retries
reuse a draft and corrected input creates a new schema-version-2 draft without overwriting earlier
content. Storage must succeed before a transaction is prepared. If actual equals expected, the
response contains action `CONFIRM_RECEIPT`, usable quantity, and unsigned `confirmReceipt` calldata.
If actual differs, notes are required and the response contains action `REPORT_DISCREPANCY`,
`SHORTAGE` or `EXCESS`, usable quantity, and unsigned `reportDiscrepancy` calldata. The API never
signs or broadcasts.

### `POST /api/custody-transfers/transactions/reject`

Requires the authorized intended recipient and an `AwaitingReceipt` transfer. It encrypts the
rejection reason/type and optional evidence before returning unsigned `reject` calldata. The
current contract accepts a reason hash but not an evidence CID, so encrypted rejection evidence is
resolved through the authorized off-chain repository and is not placed on-chain.

### `GET /api/custody-transfers/discrepancies`

Requires current System Admin authorization. It combines real `DiscrepancyReported` events,
`getDiscrepancy`, `getTransfer`, product metadata, stakeholder display names, and decrypted private
details available to that Admin. Wallets, hashes, CIDs, and transfer IDs are returned in a separate
`technical` object for collapsed presentation.

### `POST /api/custody-transfers/transactions/resolve-discrepancy`

Requires current System Admin authorization, an unresolved discrepancy, a decision, and a reason.
It returns unsigned `resolveDiscrepancy` calldata. Accepting the actual quantity returns the contract
to `AwaitingReceipt`; it does not confirm receipt. Rejecting the discrepancy cancels the transfer
and releases reserved sender inventory according to the contract.

### `GET /api/custody-transfers/:transferId/evidence`

Requires current authorization and restricts access to the transfer sender, recipient, or System
Admin. It decrypts only the workflow record matching the authoritative on-chain receipt hash/CID,
discrepancy hash/CID, or rejection reason hash. It never returns a superseded draft, an encryption
key, or plaintext content to public product traceability.

### `GET /api/custody-transfers/:transferId`

Requires the authorized intended-recipient session and returns the same minimal safe transfer
summary. The frontend uses this endpoint after MetaMask mining to confirm `Received`, `Rejected`,
or `DiscrepancyReported`, and reloads operational inventory. After an Admin accepts a discrepancy,
the recipient uses the same endpoint and performs a separate final confirmation. For a confirmed
transfer, a currently authorized sender, recipient, or System Admin also receives the actual-arrival
time from the private record matching `ReceiptConfirmed`; a missing value is returned as `null`.

## Authentication boundary

SIWE proves control of a wallet address only. Workspace authorization comes from current configured registry state and is refreshed during restoration and protected operations. This login check does not cryptographically verify the off-chain Company Role VC. The frontend must not derive a role from its URL, wallet address, fixture data, or local storage.

### Blockchain gateway

- `GET /api/blockchain/applications` returns authoritative application records and requires an authorized System Admin session.
- `GET /api/blockchain/credentials` returns safe Company Role Credential metadata merged with authoritative registry lifecycle state and requires an authorized System Admin session.
- `GET /api/blockchain/credentials/me` returns the authenticated stakeholder's current linked Company Role credential and stakeholder lifecycle data. It never accepts a wallet parameter and does not expose or decrypt the complete VC.
- `GET /api/ssi/company-role/me` returns selected signed Company Role VC claims for the authenticated wallet together with current registry lifecycle state. The API decrypts its server-managed encrypted issuance record but never returns raw VC JSON.
- `POST /api/ssi/company-role/me/verify` retrieves the same current credential and explicitly verifies its signature, issuer, wallet/DID, role, dates, deterministic hash, replacement/lifecycle state, and current authorization. It does not modify login permissions.
- `POST /api/blockchain/transactions/company-application` validates public company-application arguments and returns an unsigned transaction.
- `POST /api/blockchain/transactions/application-rejection` requires an authorized System Admin session and returns an unsigned rejection transaction.
- `POST /api/blockchain/transactions/credential-lifecycle` validates a suspend, reactivate, or revoke transition and returns the unsigned CredentialRegistry transaction.
- `POST /api/blockchain/transactions/stakeholder-lifecycle` validates a stakeholder suspend, reactivate, or revoke transition and returns the unsigned StakeholderRegistry transaction.
- `GET /api/blockchain/role-permissions` returns the current on-chain operational permission matrix; `POST /api/blockchain/transactions/role-permission` returns an Admin-only permission grant/removal transaction.
- `GET /api/blockchain/operations` requires a fully authorized stakeholder session and returns wallet-scoped ingredient batches, product batches, evidence requests, custody transfers, and current inventory reconstructed from contract events and refreshed through contract getters.

Prepared transactions contain `chainId`, `to`, `data`, and `value`. The frontend verifies the chain ID and sends the transaction through MetaMask. The API never signs on behalf of a stakeholder, so Solidity still receives the user's wallet as `msg.sender`.

## Storage and production limitations

Nonce and session storage is accessed through repository interfaces, but the current implementations are in memory. Data does not survive a process restart and cannot be shared by multiple API instances. Nonces are wallet-bound, expire after five minutes, and are atomically single-use in the supported single-process model. Nonce creation and verification are rate-limited per wallet, expired records are cleaned opportunistically, and state-changing browser requests with an unexpected `Origin` are rejected. Cookies are HttpOnly, SameSite=Lax, explicitly expiring, and Secure in production. Production deployment still requires shared atomic repositories, trusted proxy configuration, HTTPS, monitoring, and stronger distributed rate limiting.
