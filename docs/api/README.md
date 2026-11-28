# TraceChain API

## Retailer product-order delivery

`GET /api/orders` reports `productDeliverySupported`, participant-scoped `productDelivery` and
`productDeliveryQr` records. The gateway discovers the ProductDelivery child from CustodyTransfer.
Assigned direct carriers are included in the operational shipment projection. Buyer/seller private
notes are not exposed to carriers. Manufacturer custody projections contain only its own products.

`POST /api/orders/logistics/prepare` accepts these unsigned-transaction actions:

| Action                   | Fields besides operationId/orderId                                     | Authorized actor                                                      |
| ------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `product-order-select`   | mode 1/2, distributor, fromLocation, toLocation                        | Original Manufacturer                                                 |
| `product-order-respond`  | accept                                                                 | Assigned direct Distributor                                           |
| `product-order-dispatch` | vehicle, occurredAt, expectedAt; qrPayload mandatory for direct pickup | Assigned Distributor                                                  |
| `product-order-close`    | none                                                                   | Manufacturer before dispatch; actual participants for expired cleanup |

Existing product shipment receipt preparation remains recipient-only, uses the final shipment QR
and completes the coordinator through CustodyTransfer. Existing delivery company-proof endpoints
resolve either ingredient or product coordinators from the exact context; they do not assume that
all seller credentials are Supplier credentials. Requested Manufacturer proof is verified separately
and its on-chain attestation gates pickup/dispatch. No new login prerequisite is added.

See [the product request/delivery test flow](../testing/PRODUCT_DISTRIBUTOR_RETAILER_FLOW.md) for
setup, stock timing, privacy and the current local deployment limitation.

## Supplier-selected ingredient fulfilment

Normal ingredient `request` preparation no longer requires `positionId`. The Manufacturer supplies
its own receiving `location`; the Supplier approves/rejects and then chooses delivery. Explicit old
`positionId` requests still prepare `placeCustodyOrder`. Supported ingredient delivery preparation
uses `requestIngredientDelivery` even with `requestOnly: true`, preserving the delivery-required flag.

`GET /api/orders` includes `fulfilmentSupported`, true only for child policy 2. Supplier selects
custody through `POST /api/orders/logistics/prepare` with `action: "arrange-from-custody"`,
`operationId`, `orderId`, `positionId` and `receivingLocation`. Preflight verifies ownership,
approval/selection state, exact batch, sufficient live availability and the buyer's location. It
returns unsigned `arrangeFromCustody` calldata; MetaMask confirmation is required. Existing
`delivery-assign` / `delivery-respond` / `delivery-pickup` actions remain the direct path.

Actual direct carrier participants receive `deliveryReceivingLocation`, validated against the
buyer's registered locations and sourced from the hashed encrypted request metadata. They do not
receive buyer/seller private notes. Direct receiving location is recorded by the existing on-chain
receipt action; this metadata projection is not described as an earlier on-chain location field.
See [the two-mode test guide](../testing/TWO_MODE_INGREDIENT_DELIVERY.md).

## Custody ownership and company proof inbox

`GET /api/orders` now scopes `logistics.positions` to the authenticated Distributor's inventory,
or the authenticated Supplier's own supplied batches (existing authorized Admin reads are preserved).
Unrelated Distributor positions are removed from catalogue/storage projections as well. Manufacturer
ordering gets only necessary public availability fields, not total/reserved warehouse inventory.
`logistics.productStock` remains scoped to the authenticated wallet; its available physical quantity
excludes the separately reported reserved/in-transit ledger balance.

`GET /api/orders/information-requests` lists Company Role proof workflows only for their exact
presenter/verifier participants, after current session/deployment authorization. It returns context,
reference, direction, company, purpose, deadline and status; no credential/presentation payload,
decryption key or challenge secret is returned. Existing proof services validate current bindings;
historical unavailable requests cannot be used to grant access. No additional database is introduced.

## Warehouse-first shipments

`IngredientDelivery.reviewPolicy() = 1` adds `arrange-delivery` (Supplier, approved order),
`warehouse-decision` (intended Distributor, accept/reject) and `shipment-return` (original Supplier,
exact label and physical return) actions to `/api/orders/logistics/prepare`. State includes
`shipmentReviewSupported`, custody decisions, shipment-bound Supplier proof records and the Supplier's
arranged-order flag. Existing delivery identity endpoints now also resolve first-leg custody shipment
references; identity binding checks use the actual sender and recipient. No plaintext credentials or
private keys are added to shipment responses. On-chain guards remain authoritative for all writes.

`POST /api/orders/logistics/prepare` prepares explicit MetaMask transactions for warehouse publication,
Supplier stock dispatch, approved-order Distributor dispatch, product road dispatch and exact-QR receipt.
`GET /api/orders` exposes received custody positions, immediate reservations, registered warehouses,
participant-scoped shipment records and product balances per location. Modern ingredient requests
require `positionId`, the original `batchId`, canonical unit and the buyer's registered receiving location;
the contract reserves stock atomically at placement. Pending custodians cannot read private order notes.
See [setup, fields, permissions and tests](../testing/WAREHOUSE_CUSTODY_FLOW.md).
The old assignment endpoints below remain for legacy compatibility; new custody orders use Shipments.

## Ingredient delivery

`GET /api/orders` includes current ingredient delivery stages, deadlines, quantities, participant names,
an order-bound printable QR locator and public configured chain/Orders address. Only the Supplier,
Manufacturer, assigned Distributor and Admin can read an order; Distributor responses omit private
order notes and decision reasons. Supplier responses include active Distributor choices. Missing QR
configuration does not hide other order details.

`POST /api/orders/prepare` adds `delivery-assign` (Distributor wallet), `delivery-respond` (accept
boolean), `delivery-pickup` (actual time and scanned `qrPayload`) and `delivery-expire` (expired order).
Each action includes `orderId` and UUID `operationId`. Delivery-backed `approved-receipt` also requires
the matching `qrPayload` plus quantity, owned location and actual time. Preparation validates current
session/participant/state, configured origin/network/registry and pending-state contract simulation;
it returns unsigned calldata for explicit MetaMask confirmation. It never sends transactions itself.

`POST /api/orders/custody-offers/:offerId/prepare` still accepts an empty body. The first attempt
persists the physical handoff timestamp once in the encrypted offer; retries reuse it and the
existing operation/record. Product handoffs poll `latest` mined headers every three seconds, with a
30-second deadline and cancellation on client disconnect, then simulate `createRoadTransfer` with
the actual sender and an eligible mined block number. Session, offer/arrangement and evidence are
rechecked after waiting. Unsigned transactions carry `notBeforeTimestamp` and public ABI error
fragments (`simulationErrors`) so the wallet provider can repeat the time check and mined-state
simulation before signing. Other preparation paths retain their existing simulation behavior.
`BLOCKCHAIN_TIME_TIMEOUT` and `HANDOFF_CANCELLED` are controlled 409 responses where a response is
still possible; `HANDOFF_TIME_RECOVERY_REQUIRED` blocks legacy prepared offers whose original time
was never persisted. Restore that time from verified original calldata through an authorized operator
process, without substituting “now”. Other RPC and contract validation failures remain errors.

`POST /api/orders/:orderId/delivery/identity` reuses Company Role proof actions `request`, `material`,
`present`, `verify`, `decline`, `status`. Only the assigned Distributor can request/verify Supplier
proof; only that Supplier can retrieve/present its credential. Synthetic delivery-proof references
bind to the actual order and current assigned carrier, with independent challenge, purpose, claims,
expiry and encrypted DIDComm reply thread. Signature/source hash/holder/wallet/role/lifecycle checks
precede an unsigned verification attestation. Proof verification never confirms physical custody.

See [the end-to-end test and deployment guide](../testing/INGREDIENT_DISTRIBUTOR_DELIVERY.md).

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

Private details are restricted to the exact Supplier and requesting Manufacturer or Retailer wallets
recorded for the request. Unrelated callers receive not found so the endpoint does not disclose that
a private record exists. The authenticated API returns the existing backend-signed VP so the Supplier
browser can encrypt it for the verified DIDComm recipient; plaintext is not written to relay logs or
URLs.

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

| Variable                         | Default example          | Purpose                                           |
| -------------------------------- | ------------------------ | ------------------------------------------------- |
| `PORT`                           | `3000`                   | HTTP port                                         |
| `FRONTEND_URL`                   | `http://localhost:5173`  | Exact CORS origin                                 |
| `NODE_ENV`                       | `development`            | Controls production cookie security               |
| `SIWE_DOMAIN`                    | `localhost:5173`         | Expected ERC-4361 domain                          |
| `SIWE_URI`                       | `http://localhost:5173`  | Expected ERC-4361 URI                             |
| `CHAIN_ID`                       | `31337`                  | Active contract and SIWE chain ID                 |
| `CHAIN_NAME`                     | `TraceChain Local`       | Browser-visible network name                      |
| `CHAIN_RPC_URL`                  | Placeholder URL          | Legacy/single-provider and browser chain URL      |
| `CHAIN_RPC_PRIMARY_URL`          | Optional backend URL     | Preferred ordinary-read endpoint                  |
| `CHAIN_RPC_SECONDARY_URL`        | Optional backend URL     | Ordinary-read failover                            |
| `CHAIN_RPC_EMERGENCY_URL`        | Optional backend URL     | Last ordinary-read failover                       |
| `CHAIN_LOG_RPC_URL`              | Optional backend URL     | Dedicated `eth_getLogs` endpoint                  |
| `CHAIN_LOG_FALLBACK_URL`         | Optional backend URL     | Explicit log failover                             |
| `CHAIN_EVENT_START_BLOCK`        | Empty                    | Suite deployment lower bound or auto-discovery    |
| `CHAIN_EVENT_CONFIRMATIONS`      | `2`                      | Confirmations before events enter the index       |
| `CHAIN_EVENT_PAGE_SIZE`          | `5000`                   | Blocks per incremental event query                |
| `CHAIN_EVENT_FALLBACK_PAGE_SIZE` | `10`                     | Blocks per fallback log query                     |
| `RPC_READ_CONCURRENCY`           | `8`                      | Concurrent RPC transport ceiling                  |
| `RPC_BULK_READ_CONCURRENCY`      | `6`                      | Bulk-log ceiling reserving normal capacity        |
| `RPC_BATCH_MAX_COUNT`            | `20`                     | Safe JSON-RPC read batch size                     |
| `RPC_BATCH_STALL_TIME_MS`        | `10`                     | Read-batch collection window                      |
| `RPC_MIN_REQUEST_INTERVAL_MS`    | `10`                     | Delay between transport starts                    |
| `RPC_READ_MAX_RETRIES`           | `2`                      | Idempotent read retry count                       |
| `RPC_RETRY_BASE_DELAY_MS`        | `1000`                   | Initial rate-limit backoff                        |
| `RPC_ENDPOINT_COOLDOWN_MS`       | `30000`                  | Open-circuit cooldown before one recovery probe   |
| `RPC_REQUEST_TIMEOUT_MS`         | `15000`                  | Per-transport request timeout                     |
| `OPERATIONAL_READ_CONCURRENCY`   | `8`                      | Dashboard record worker count                     |
| `CHAIN_CURRENCY_SYMBOL`          | `ETH`                    | Browser-visible native token symbol               |
| `STAKEHOLDER_REGISTRY_ADDRESS`   | Zero-address placeholder | Deployed stakeholder registry                     |
| `CREDENTIAL_REGISTRY_ADDRESS`    | Zero-address placeholder | Deployed credential registry                      |
| `INGREDIENT_REGISTRY_ADDRESS`    | Address placeholder      | Deployed ingredient registry                      |
| `EVIDENCE_REGISTRY_ADDRESS`      | Address placeholder      | Deployed evidence registry                        |
| `PRODUCT_REGISTRY_ADDRESS`       | Address placeholder      | Deployed product registry                         |
| `CUSTODY_TRANSFER_ADDRESS`       | Address placeholder      | Deployed custody-transfer contract                |
| `VITE_PUBLIC_APP_URL`            | `http://localhost:5173`  | Canonical public product and receipt-QR origin    |
| `AUTH_COOKIE_NAME`               | `tracechain_session`     | Session-cookie name                               |
| `AUTH_SESSION_TTL_SECONDS`       | `28800`                  | Session lifetime in seconds                       |
| `SEPOLIA_RPC_URL`                | Placeholder URL          | did:ethr Sepolia resolver/provider                |
| `VERAMO_KMS_SECRET_KEY`          | Migration only           | Legacy 32-byte key imported by `keystore:migrate` |
| `TRACECHAIN_AUTHORITY_DID_ALIAS` | `tracechain-authority`   | Authority DID lookup alias                        |
| `BOOTSTRAP_ADMIN_WALLET`         | Zero-address placeholder | Public Admin wallet address                       |
| `IPFS_PINNING_API_URL`           | Placeholder URL          | Encrypted credential pinning endpoint             |
| `IPFS_PINNING_TOKEN`             | Placeholder only         | Scoped server-side pinning token                  |
| `IPFS_ENCRYPTION_KEY`            | Migration only           | Legacy 32-byte key imported by `keystore:migrate` |

`FRONTEND_URL`, `SIWE_DOMAIN`, and `SIWE_URI` must match the frontend origin used in the browser.

The root template also contains `DEV_DISTRIBUTOR_WALLET` for the chain-31337 seed command. It is a
public unlocked Hardhat address consumed by the CLI, not an API runtime secret.

For deployed product and receipt labels, `VITE_PUBLIC_APP_URL` must be the externally reachable HTTPS
application origin. Its URL parameters never choose the API's RPC endpoint.

Normal API runtime obtains the IPFS and Veramo secrets from the uploaded administrator keystore, not
these two legacy environment variables. They remain documented only for the one-time existing-installation
migration. Blockchain RPC and registry configuration are required for direct login authorization,
although injected SIWE unit tests do not require a live chain. The API and frontend both use
`CHAIN_ID`; replace the RPC and registry placeholders with values from that same network. Never
provide or store the Admin wallet private key.

## Endpoints

### `GET /api/health`

Returns API availability:

```json
{ "status": "ok", "service": "tracechain-api" }
```

### Administrator keystore

All keystore responses use `Cache-Control: no-store`. Every route requires an authorized SIWE
session whose wallet equals the current administrator returned by the stakeholder registry.

- `GET /api/admin/keystore/status` returns `Locked`/`Unlocked`, `initializationAllowed` and the
  boolean `backupRequired`. It never returns key metadata.
- `POST /api/admin/keystore/unlock` accepts the encrypted JSON as a string plus its password.
- `POST /api/admin/keystore/initialize` creates an initial bundle only when no legacy key/workflow
  material or initialization marker exists. Its body requires matching `password` and
  `confirmPassword` fields.
- `POST /api/admin/keystore/export` re-encrypts the current in-memory bundle using the supplied new
  download password and confirmation, then returns `tracechain-admin-keystore.json` as an attachment.
- `POST /api/admin/keystore/lock` removes the current in-memory bundle. It returns
  `KEYSTORE_BACKUP_REQUIRED` when issuer key changes have not yet been exported.

Wrong passwords, invalid files and authenticated metadata/ciphertext changes all return the same
safe `INVALID_KEYSTORE` response. Five failed unlocks per Admin wallet in fifteen minutes are
rate-limited. Protected content/signing operations return HTTP 423 with `KEYSTORE_LOCKED` while the
API remains otherwise available.

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

The API verifies the signature, recovered address, configured domain, URI and chain ID, nonce, issue time, and expiration. A successful request consumes the nonce, creates a server-side session, sets an HttpOnly cookie, and returns. With `NODE_ENV=production`, the cookie is Secure and SameSite=None to support cross-site frontend/API origins; local and test environments use SameSite=Lax.

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

### `POST /api/ingredients/extract-document`

Requires the same current SIWE-authenticated Supplier role, Company Role credential and ingredient
issuance/registration permissions as batch preparation. Send one multipart field named `document`.
Supported files are PDF, DOCX, PNG and JPG/JPEG up to 10 MB. The API checks the extension, declared
MIME type and detected file signature before processing; legacy DOC, DOCM/macro-enabled,
password-protected, executable and mismatched files are rejected.

Text PDFs and DOCX documents are read locally. PNG/JPEG images use bundled local English OCR. PDFs
are limited to 50 pages, images to 12,000 pixels per side and 40 million pixels total. Scanned PDFs
without usable embedded text are not OCR-rendered in this phase; upload their pages as PNG/JPG or use
manual entry.

The response contains safe document metadata, mapped ingredient fields with `High`, `Review
required` or `Missing` confidence, and warnings. Missing or unsafe values remain empty. Extraction is
assistive only: the upload stays in memory, is discarded after the response and is never stored,
sent to an external AI service, uploaded to IPFS, placed on-chain, used to issue a credential or used
to prepare a transaction. TraceChain does not certify that the Supplier document's claims are true.

### `GET /api/ingredient-batches`

Requires the same Supplier authorization. The API obtains batch IDs from `IngredientBatchRegistered` events, re-reads each batch with `getBatch`, filters by the authenticated Supplier wallet, and merges authorized private metadata from the encrypted local workflow envelope. It does not accept a Supplier wallet query parameter.

### Production flow endpoints

The following endpoints require a SIWE session and a fresh matching on-chain role, Company Role credential-record, and permission check. They use the session wallet as the actor and never accept a caller-selected sender wallet:

- `GET /api/production-flow/ingredients` lists active Supplier ingredient batches for a Manufacturer and marks batches already accepted for that Manufacturer.
- `POST /api/production-flow/evidence-requests/prepare` creates or resumes an encrypted, random-challenge evidence request and returns unsigned `EvidenceRegistry.requestEvidence` calldata until the exact contract record exists.
- `GET /api/production-flow/evidence-requests` returns authoritative request state scoped to the authenticated Manufacturer or intended Supplier.
- `POST /api/production-flow/evidence-requests/:requestId/respond/prepare` retrieves the intended Supplier's server-authorized issued Ingredient Credential, creates and verifies a request-bound VP containing the complete credential, encrypts it, and returns unsigned `respond` calldata.
- `POST /api/production-flow/evidence-requests/:requestId/accept/prepare` decrypts and cryptographically verifies the stored VP, signed request/party/purpose/challenge/date context, Supplier issuer, exact registered batch credential ID/hash, current credential state, and Supplier role before returning unsigned `accept` calldata. A completed Retailer acceptance is idempotently detected through the request's `Accepted` status and never relies on or sets the Manufacturer-only product-creation flag.
- `POST /api/production-flow/products/prepare` requires accepted evidence and sufficient available quantity for every ingredient, encrypts private product metadata, and returns unsigned `ProductRegistry.createProduct` calldata.
- `GET /api/production-flow/distributors` lists currently authorized Distributor wallets discovered from registry events and refreshed through `roleOf`.
- `POST /api/production-flow/transfers/prepare` validates the Manufacturer, product transferability, inventory, intended Distributor, quantity, and arrival date before returning unsigned `CustodyTransfer.createTransfer` calldata. Completion is reported only after `getTransfer` matches and reports `AwaitingReceipt`.
- `GET /api/production-flow/distributor/inventory` returns only positive available product inventory previously received by the authenticated, authorized Distributor.
- `GET /api/production-flow/retailers` returns active verified Retailer identities as company name, role, and wallet address; the wallet remains the transaction recipient.
- `POST /api/production-flow/distributor/transfers/prepare` rechecks Distributor authorization, product transferability, inventory, Retailer role and permission, encrypts shipment details, and returns idempotent unsigned `CustodyTransfer.createTransfer` calldata. A retry reports completion only after the on-chain record matches and is `AwaitingReceipt`.

Workflow retries reuse ignored metadata under `.tracechain/issuance/production-flow.json` and reject changed inputs. The repository uses atomic replacement, preserves records across API restarts, and fails closed without overwriting a malformed file. Complete credentials, VPs, private metadata, encryption keys, and pinning credentials are never returned to the browser. The current JWT VP contains the complete Ingredient Credential; selective disclosure is not supported or claimed.

### `POST /api/custody-transfers/resolve-qr`

Requires a SIWE session currently authorized against the blockchain registries. The request contains only the Stage 1 locator:

```json
{
  "qrPayload": "https://tracechain.example/receive/transfer?v=1&chainId=11155111&contract=0x...&transferId=0x..."
}
```

The API verifies the exact configured application origin, chain and `CUSTODY_TRANSFER_ADDRESS`,
reads `getTransfer(transferId)`, requires status `1` (`AwaitingReceipt`), requires the SIWE wallet
to equal the on-chain recipient, and rechecks the active Distributor/Retailer credential and
effective `RECEIVE_TRANSFER` permission. A successful response contains safe fields plus readable
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
Admin. Unrelated callers receive not found. It decrypts only the workflow record matching the authoritative on-chain receipt hash/CID,
discrepancy hash/CID, or rejection reason hash. It never returns a superseded draft, an encryption
key, or plaintext content to public product traceability.

### `GET /api/custody-transfers/:transferId`

Requires the authorized intended-recipient session and returns the same minimal safe transfer
summary. The frontend uses this endpoint after MetaMask mining to confirm `Received`, `Rejected`,
or `DiscrepancyReported`, and reloads operational inventory. After an Admin accepts a discrepancy,
the recipient uses the same endpoint and performs a separate final confirmation. For a confirmed
transfer, a currently authorized sender, recipient, or System Admin also receives the actual-arrival
time from the private record matching `ReceiptConfirmed`; a missing value is returned as `null`.

## Catalogue presentation media

All routes require the existing fully authorized SIWE session. Presentation media never changes
credential, stakeholder, batch or inventory state.

- `GET /api/orders/branding/me` returns the verified session company's safe name/role and optional
  authenticated logo route.
- `POST /api/orders/branding/:wallet/logo` accepts a PNG/JPEG/WebP data envelope up to 2 MB. The
  path wallet must equal the SIWE wallet and the stakeholder directory must verify the company.
- `GET /api/orders/branding/:wallet/logo` rechecks the verified company and returns the decrypted,
  revalidated image with private caching, content sniffing disabled and a safe filename.
- `POST /api/orders/catalogue/ingredients/:batchId/image` accepts the same image envelope only when
  the authenticated Supplier is the authoritative on-chain batch owner.
- `GET /api/orders/catalogue/ingredients/:batchId/image` rechecks that batch ownership before
  returning the safe image bytes.
- `POST /api/orders/catalogue/products/:batchId/image` accepts the same image envelope only when
  the authenticated Manufacturer is the authoritative on-chain product owner.
- `GET /api/orders/catalogue/products/:batchId/image` rechecks product ownership before returning
  the safe image bytes. Catalogue responses expose only this authenticated route, never encrypted
  storage identifiers.

For an active company or catalogue owner, a media `POST` stores the encrypted immutable object and
returns `state: TRANSACTION_REQUIRED` plus unsigned reference-update calldata until its exact hash/CID
is confirmed on-chain. The frontend submits that transaction through the authenticated MetaMask wallet
and repeats the request idempotently; the confirmed response is `COMPLETE`. The backend never signs or
broadcasts it. A different API with an empty business-data directory reads the confirmed reference,
downloads/decrypts the image and validates its plaintext hash plus deployment/owner/record binding.
The same chain-plus-encrypted-IPFS recovery pattern is used for confirmed order/location/shipment
private records, evidence, custody receipt data and ingredient certification documents. Missing legacy
references return `LEGACY_RECORD_NOT_MIGRATED`; RPC, IPFS, keystore and integrity failures are not
reported as an empty successful view.

`GET /api/blockchain/applications/manifest-configuration` returns the public chain, registry and
declaration-version context used for applicant content authorization. `POST
/api/blockchain/applications/manifest` accepts the complete registration and selected files only
after verifying the applicant's content signature. It validates actual bytes, encrypts attachments,
creates and encrypts the canonical version-1 manifest, and returns its `ipfs://` reference, exact
profile hash and second human-readable binding message. It never returns encryption keys or stored
ciphertext.

`POST /api/blockchain/transactions/company-application` requires `applicantWallet` and
`applicantSignature` for every request, including applications without a logo. The signature covers
the exact application ID, wallet, company metadata, profile reference/hash, prior application, role
and initial location. When a company-logo envelope is present, the same signed message includes its
validated image digest. The server validates the signature and actual PNG/JPEG/WebP bytes (maximum
2 MB) before persisting metadata or media. Identical retries are idempotent; reusing an application
ID with any changed signed value returns a conflict even when the profile hash is unchanged. For new
`ipfs://` registrations the endpoint reloads and validates the manifest context and first signature,
then verifies the second CID/hash binding before returning unsigned calldata. Local metadata writes
are best-effort legacy caches and are not required for the transaction.

Authorized System Admin application responses include `pendingLogoPath` when a pending logo belongs
to the exact on-chain applicant. `GET /api/blockchain/applications/:applicationId/logo` is Admin-only
and serves that private review image with no-store and content-sniffing protections. The normal
`GET /api/orders/branding/:wallet/logo` route does not expose it until the verified active stakeholder
identity references the same application ID. A rejected or unrelated pending application therefore
cannot leak branding into stakeholder views.

Upload validation checks the allowlisted MIME type, matching filename extension, base64 encoding,
binary signature, dimensions and maximum size before encrypted storage. Catalogue JSON exposes only
safe media paths. It never exposes raw image data, a storage CID, ciphertext or an encryption key.

## Authentication boundary

SIWE proves control of a wallet address only. Workspace authorization comes from current configured registry state and is refreshed during restoration and protected operations. This login check does not cryptographically verify the off-chain Company Role VC. The frontend must not derive a role from its URL, wallet address, fixture data, or local storage.

### Blockchain gateway

- `GET /api/blockchain/applications` returns authoritative application records enriched from validated encrypted manifests and requires an authorized System Admin session. It does not download attachments for the list.
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

The former raw backend-key `POST /api/ssi/storage-key-backup` route is removed and returns 404.
Its replacement exports only the encrypted portable Admin bundle through the authorization rules
above. Credential issuance and authenticated IPFS retrieval/verification require an unlocked
bundle. Company presentation-signing recovery uses a different per-company keystore.
See [storage and recovery](../STORAGE_AND_RECOVERY.md).

### Role workflows (2026-11-16)

- `GET /api/orders/traceability?kind=ingredient|product&batchId=<bytes32>` returns company-scoped
  trace roots and safe linked batch/event stages. Unrelated roots are not available. The response is
  not a credential-signature verification result and contains no private proof or stock payloads.
- `GET /api/orders/profile` returns only the session company's locations and optional initial draft.
  `PATCH /api/orders/profile/locations/:location` accepts `{label}` for an owner-only display alias;
  original location IDs and registered names stay fixed.
- `GET|PUT /api/orders/:referenceId/pickup` reads/saves `{pickupAt}` for accepted direct carriers.
  Only actual participants may read and only the accepted Distributor may arrange pickup.
- `GET|POST /api/orders/custody-offers` lists participant offers/creates an owned-stock offer.
  `GET /api/orders/custody-offers/:offerId` returns one authorized offer.
  `POST .../:offerId/action` accepts `accept`, `reject` or `schedule` plus `pickupAt` for schedule.
  `POST .../:offerId/prepare` returns unsigned existing dispatch calldata after checking sender,
  pickup, source, route, expiry, participant authorization and requested company proof.
- Custody sender proof reuses `POST /api/orders/:referenceId/delivery/identity`, bound to the offer,
  batch and parties. No on-chain proof attestation is fabricated for the off-chain offer.

Offer decisions, schedules and location aliases use existing encrypted content and atomic JSON
workflow storage. The API can decrypt them. They are not on-chain reservations or receipts; signed
dispatch and exact-QR physical receipt remain authoritative. All these routes return `no-store`.

Nonce and session storage is accessed through repository interfaces, but the current implementations are in memory. Data does not survive a process restart and cannot be shared by multiple API instances. Nonces are wallet-bound, expire after five minutes, and are atomically single-use in the supported single-process model. Nonce creation and verification are rate-limited per wallet, expired records are cleaned opportunistically, and state-changing browser requests with an unexpected `Origin` are rejected. Cookies are HttpOnly and explicitly expiring; production cookies are SameSite=None and Secure for cross-site frontend/API origins, while local/test cookies use SameSite=Lax. Production deployment still requires shared atomic repositories, trusted proxy configuration, HTTPS, monitoring, and stronger distributed rate limiting.

## Production stock and optional evidence

`GET /api/production-flow/ingredients?purpose=production&location=<bytes32>` reads the authenticated
Manufacturer's received stock at the selected location using REGISTER_PRODUCT permission. It does
not read evidence acceptance or require REQUEST_EVIDENCE permission. Without a received-stock
ledger it returns no usable production quantity, rather than substituting Supplier inventory.
The default ingredient query retains the existing evidence-request behavior.

Product preparation does not require an accepted ingredient presentation when consuming received
stock. Valid source status/credentials, location, stock bounds and contract policy still apply.
An old ProductRegistry returns `OPTIONAL_EVIDENCE_DEPLOYMENT_REQUIRED` before metadata preparation;
update the full suite and configured addresses. Evidence verification/acceptance endpoints remain
separate and never run automatically during production.

### Registration document review

- GET /api/blockchain/applications/documents/me lists the signed-in applicant's confirmed applications.
- GET /api/blockchain/applications/:applicationId/documents lists private document metadata.
- GET /api/blockchain/applications/:applicationId/documents/:index downloads an authorized file with no-store, nosniff and sandbox headers.
- POST /api/blockchain/applications/:applicationId/documents accepts {documents} for applicant-only legacy reattachment. An existing set cannot be overwritten.
- Company-application preparation accepts optional documents with kind, fileName, mimeType and base64 data; the document digest is included in the applicant's signed binding. Current registration UI requires three supporting files. The 58 MB JSON ceiling accommodates four 10 MB files encoded as base64 plus the optional logo; per-file type/signature and 10 MB limits are checked separately.

Review requires SIWE ownership of the confirmed application or current authorized on-chain Admin; pending applicants can review their own files without operational role access. New applications resolve documents on demand through the signed encrypted manifest. The local document index remains a legacy source only. Download does not establish authenticity of applicant-provided claims. No contract changes are needed.

### Physical location details

Company application preparation accepts optional initialLocationAddress (1-1000 trimmed characters),
bound into the applicant signature. The new registration form requires it. The API encrypts/pins
the address and persists initialLocationDetails ciphertext/CID rather than readable address bytes.
GET /api/orders/profile returns the authenticated company's initial name/address draft and registered
locations with optional address. Location preparation accepts address beside label; PATCH
/api/orders/profile/locations/:location accepts {label, address}. Owner checks precede persistence;
a legacy label-only patch preserves any saved address. Addresses are encrypted in existing location
metadata and returned only inside authorized participant views. No contract ABI changes.

### Wallet confirmation

Prepared transactions contain chain ID, target, value and encoded call data. The optional
`walletAction` metadata and preview-message helpers were removed when the trial ended.
The browser requests normal MetaMask transaction confirmation without an extra preview signature.
Company-registration ownership signatures, SIWE, authorization and transaction simulation remain.

### Evidence preview and decision separation

Company identity status reads (GET /api/production-flow/evidence-requests/:requestId/company-identity
and Orders delivery-identity action status) expose only the received presentation's disclosed fields to
its authorized reviewer, plus missing/undisclosed field names and technical verification state.
PASSED, FAILED and UNAVAILABLE are independent of the existing business status. These reads do not
accept/reject, prepare transactions or change proof history. No source-credential claims are backfilled.
The legacy company-identity /verify operation remains the explicit acceptance operation and rechecks
all existing cryptographic, expiry, revocation, participant and request bindings before recording it.
Ingredient /review allows preview before acceptance; /verify records technical checks only;
/accept/prepare requires verification and rechecks it before preparing the separate wallet transaction.
Permitted attachment retrieval retains its own authorization and fresh cryptographic/integrity checks.
