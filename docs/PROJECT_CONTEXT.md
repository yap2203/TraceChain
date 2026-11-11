# TraceChain Project Context

## Project

- **Name:** TraceChain
- **Formal title:** Blockchain-Based Supply Chain Traceability System: Self-Sovereign Identity Credential Verification
- **Repository:** Private TypeScript npm monorepo with React, Express, shared, SSI, and Solidity workspaces

## Stakeholder roles

- System Admin, also acting as the Product Traceability Authority
- Supplier
- Manufacturer
- Distributor
- Retailer

## Confirmed target architecture

- React and Vite web application
- Node.js and Express application server
- MetaMask wallet authentication and transaction signing
- Ethereum Sepolia test network
- ERC-4361 Sign-In with Ethereum
- Veramo agent services and stakeholder-specific repositories
- Company Role Credentials for credential-based RBAC
- Ingredient Credentials and request-bound full-credential presentations covering request, batch, parties, purpose, challenge, dates, and exact credential identity; selective disclosure requires a future credential format
- Solidity smart contracts and a blockchain gateway
- QR-code generation and scanning

## Current implementation

- Supplier uses an owned ingredient grid with listing CRUD/archive/restore, a My orders table for Manufacturer requests and approve/reject decisions, and separate Received/Sent evidence tables under Information requests. There is no Supplier Browse tab. Signed ingredient fields and historical traceability remain immutable; listing amendments are distinct Supplier business metadata. Decisions never move stock or automatically grant evidence access.

- Current Browse & requests UI scope is browsing, request-only quantity interest, details evidence and company proof exchange. Location/proposal/reservation/dispatch/receipt/recall controls are deferred from this page. New request-only records cannot reserve/dispatch or credit stock; existing physical-flow APIs/contracts and historical records remain intact. See docs/BROWSE_REQUESTS_README.md.

- Browse & requests discovers registered ingredient/product batches without manual publishing, shows only whitelisted business metadata and optional indicative unit prices, and uses request terminology without payments.
- New quantity-request-linked Company Identity proofs support issuer-derived SD-JWT attestations referencing existing Company Role VCs, required/optional claim selection and browser holder signing. Legacy signed Company Role JWTs remain unchanged and cannot be selectively redacted.

- Responsive React UI with public login and registration pages
- Integrated admin, supplier, manufacturer, distributor, and retailer workspace screens
- Development sample data, simulated interactions, responsive dialogs, accessible loading states, and table pagination
- SIWE nonce issuance, signature verification, HttpOnly-cookie sessions, restoration, and logout
- State-safe MetaMask extension reuse and Mobile QR connection with bounded attempts and listener cleanup
- In-memory nonce and session repository interfaces and development implementations
- Shared `CompanyRole` enum
- Versioned HTTPS product-traceability QR encoding with strict untrusted-locator decoding
- Safely public product, ingredient-verification, current-custodian, and chronological custody resolution from configured contracts
- Permanent product QR display, PNG download, name-first printable label, copied link, phone route, image upload, and manual-paste fallback; readable product names and batch references remain presentation data outside the locator payload
- Versioned custody-transfer QR locator encoding and strict untrusted-payload decoding
- Authenticated, credential-authorized custody-transfer resolution with intended-recipient checks
- Canonical custody-transfer QR rendering, PNG download, camera/image/manual scanning, and API-verified transfer summaries
- Development-only chain-31337 custody-transfer seeding against existing deployments
- Recipient-only quantity reconciliation, encrypted receipt evidence, discrepancy reporting, rejection, and confirmation through backend-validated unsigned calldata and MetaMask
- System Admin discrepancy review using real contract events and unsigned `resolveDiscrepancy` transactions
- Versioned, content-addressed encrypted receipt drafts with authoritative contract-reference matching after finalization
- Authorized participant/Admin actual-arrival presentation; public traceability excludes actual arrival and private receipt content
- Server-side Veramo agent with did:ethr Sepolia, JWT VC/VP, encrypted JSON key storage, Company Role Credential issuance/verification, Admin bootstrap, and development holder export
- Supplier-specific did:ethr issuer DIDs, typed JWT Ingredient Credential issuance/verification, AES-GCM encrypted IPFS storage, and sequential MetaMask registration of credential and batch records
- Authenticated Supplier ingredient batch list/detail/overview data reconstructed from `IngredientBatchRegistered` events, contract reads, and authorized encrypted metadata
- Real Manufacturer-to-Distributor production workflow: encrypted evidence requests, Supplier challenge-bound full-credential VPs, cryptographic acceptance, accepted-ingredient product creation, transfer preparation, and QR generation from the verified transfer ID
- Real Distributor-to-Retailer transfer workflow: received inventory filtering, verified Retailer selection, encrypted shipment details, unsigned transaction preparation, MetaMask signing, authoritative post-write verification, and QR handoff
- Direct SIWE-to-registry login authorization with fresh stakeholder, role, and Company Role credential-record checks; manual VC verification remains separate from login
- Verified stakeholder identity presentation from existing Company Role issuance records, with current registry cross-checks, safe legacy fallbacks, and company-name enrichment for authenticated operational responses
- On-chain Company Role credential linkage for every company role plus an Admin bootstrap-to-registry workflow; complete credentials remain encrypted off-chain
- Wallet-scoped on-chain credential pages for Supplier, Manufacturer, Distributor, and Retailer, with optional private issuance metadata and no presentation fixtures
- Readable Company Digital Identity cards backed by the actual encrypted Company Role VC, explicit Veramo/on-chain verification, copyable technical details, and PDF summaries
- Seven-contract Hardhat 3 traceability suite with Ignition deployment and integration tests, including SupplyChainOrders for catalogue requests, reservations, physical ingredient receipts, location-based Manufacturer stock and recall links; existing deployments require redeployment to use this stage
- Order-bound optional Company Role VPs using the existing full-disclosure credential format and browser-held presentation keys; versioned batch proposals require freshly bound Ingredient evidence without changing the existing SD-JWT format
- Administrator transfer that preserves historically valid Company Role Credentials while removing the former administrator's authority
- Participant-scoped private evidence and receipt retrieval with existence-hiding not-found responses
- Atomic workflow persistence that fails closed on corruption and confirmed-transaction refresh recovery in the UI

Several non-admin stakeholder screens still use presentation fixtures. Workspace access requires a
SIWE session and current matching blockchain authorization in every environment; there is no
account-free localhost bypass. Normal login does not cryptographically verify the off-chain Company
Role VC, although issuance and manual verification remain available separately.

## Identity and security rules

- MetaMask proves control of a wallet; it does not issue Company Role Credentials or Ingredient Credentials.
- Veramo manages the current DID, credential, and presentation foundation.
- Login roles come only from current contract authorization. Company Role VCs remain independently verifiable off-chain and their registered type, subject, hash/reference, lifecycle, and expiry constrain on-chain company access.
- A historical Company Role Credential is not invalidated solely because its issuer is no longer the current administrator; the current credential and stakeholder records remain authoritative.
- Suppliers issue Ingredient Credentials through their authenticated, permission-checked workflow. Selective disclosure is not implemented by the current JWT credential format.
- Invalid, expired, suspended, or revoked credentials must never grant access.
- Routes, wallet addresses, fixture data, and browser storage are not trusted role evidence.
- Complete credentials, supporting identity documents, and sensitive identity data remain off-chain.
- Private keys, seed phrases, API secrets, and real credentials must never enter the repository.
- Blockchain records may contain hashes, statuses, references, and traceability events.

## Supply-chain rules

- System Admin reviews company applications and approved companies receive Company Role Credentials.
- Suppliers register ingredient batches and issue Ingredient Credentials.
- Manufacturers request and verify ingredient evidence, create product batches, and link verified ingredients.
- Manufacturers transfer products to Distributors.
- Distributors receive products, reconcile quantities, and transfer available products to Retailers.
- Retailers confirm receipt, inspect authorized history, request evidence, and export authorized reports.
- QR codes contain a reference to a product or pending transfer.
- Scanning a QR code alone must never change custody.
- Only the intended authenticated receiver may confirm receipt.
- Receipt confirmation requires a MetaMask transaction signature.
- The system records custody and does not claim to determine legal ownership.
- Product photographs do not automatically prove delivery.

## Current limitations

- Nonce and session repositories remain development-only and in memory; issuance recovery currently uses ignored atomic JSON files rather than a production shared database
- No finalized production SSI storage/key-custody design, hosting platform, or production topology
- Receipt encryption currently reuses the prototype server-managed AES key and ignored atomic JSON workflow repository; production needs durable shared metadata storage and managed key custody
- Superseded encrypted receipt drafts remain in prototype storage for audit-safe non-overwrite behavior; retention and cleanup policy requires a future production design
- Direct contract rejection records only a reason hash, so its encrypted evidence CID remains in the authorized off-chain receipt repository rather than on-chain
- Remaining non-admin reports still contain presentation fixtures and are not authoritative
- SIWE nonce and session state is process-local; restarting the API requires users to sign in again
- Ignored atomic JSON workflow files are restart-recoverable on one host but are not shared, replicated production storage; corruption fails closed and needs operator recovery from a trusted backup

## Important system qualities

- Security
- Privacy
- Reliability
- Usability and accessibility
- Responsive compatibility
- Performance
- Maintainability and explicit package boundaries
