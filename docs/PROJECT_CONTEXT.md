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

The confirmed 2026-11-16 workspace model separates role-specific stock, orders, shipments,
information requests, traceability and Profile. Distributor accepts and schedules custody intake
before sender handoff; direct delivery also requires accepted-carrier pickup planning. Coordination
offers/plans and location aliases use existing encrypted server-managed storage; physical stock
continues to depend on MetaMask-signed contract records. Forward/backward traceability exposes safe
batch/event facts, not confidential credential contents or implied cryptographic verification.
See `docs/testing/ROLE_WORKFLOWS_TEST_GUIDE.md` for current navigation and validation steps.

- React and Vite web application
- Tailwind CSS 4 with the existing TraceChain design tokens, layouts and dark/light workspace themes
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

- Registration collects legal business details, contact details, wallet identity and supporting documents without requiring a physical dispatch/receiving location. Companies add named physical locations in Profile when needed for orders, shipments or production. Existing signed application location drafts remain supported; registered addresses and edits use encrypted location presentation records. Stable on-chain IDs, stock/history and authorized-only address visibility remain unchanged.

- Registration now sends actual supporting document bytes, bound into the applicant signature and encrypted before IPFS upload. An encrypted local cache supports Admin application review and owner-only Profile/pending-login review. Legacy filename-only applications allow applicant-only supplemental attachment, without rewriting the original on-chain hash. No document bytes or decryption keys are exposed on-chain; no contract change is required.

- SSI data storage now separates public DID/key metadata from an AES-GCM encrypted VC/VP/claim/message cache. Legacy public-store contents migrate after encrypted write/read-back, preserving bootstrap/export compatibility. The company identity feature retrieves its authenticated wallet's current registry CID from encrypted IPFS. Backend encryption-key backup and restore checks are not exposed through the web app or HTTP API. Existing operator backups and holder presentation-signing recovery remain separate and preserved. See `docs/STORAGE_AND_RECOVERY.md`.

- Product orders now mirror two-mode ingredient fulfilment: Retailer requests, Manufacturer approves/rejects and selects an assigned direct carrier or sufficient received Distributor custody, Distributor dispatches, and Retailer scans/settles receipt. ProductDelivery is automatically deployed by CustodyTransfer, keeps owner/receiver/carrier roles separate and reuses product inventory, road QR/receipt services and Manufacturer company-proof verification. Manufacturer has Custody inventory; Retailer has Shipments. The running local suite remains unchanged because its newly completed ingredient delivery cannot be replayed safely by the existing restricted migration helper. See `docs/testing/PRODUCT_DISTRIBUTOR_RETAILER_FLOW.md`.

- New Manufacturer ingredient requests let the Supplier choose fulfilment after approval: direct Distributor delivery with carrier accept/decline and scanned pickup, or existing Distributor custody with sufficient exact-batch stock reserved atomically at Supplier selection. Manufacturer physical receipt remains mandatory. Explicit earlier custody-position orders still reserve at placement. `IngredientDelivery.fulfilmentPolicy() = 2` needs an updated full-suite deployment. See `docs/testing/TWO_MODE_INGREDIENT_DELIVERY.md`; the older warehouse-only normal-flow description below is superseded for new requests.

- Custody inventory is now a standalone Supplier/Distributor page. API responses isolate each Distributor's private custody stock and restrict Suppliers to their own supplied batches; ordering receives only minimal public availability. Both roles can open authorized inventory details. Information requests is available in all stakeholder workspaces, centralizing sent/received Company Role proof management while preserving ingredient evidence workflows. Application privacy does not conceal public on-chain balances. No additional contract deployment is needed for this navigation/access change.

- Shipment responsibilities are role-specific (2026-11-15): Supplier Sent shipments tracks custody offers and Supplier-arranged approved orders; Distributor Custody & deliveries provides Supplier VP review, accept/reject intake, scanned physical receipt and dispatch of Supplier-arranged orders only. Supplier approval alone does not create a delivery job. Rejected stock is return-pending until original Supplier confirmation. Camera/image upload replaces manual QR entry in current and legacy receipt scanners. `reviewPolicy() = 1` requires fresh full-suite deployment; no running deployment/environment is changed automatically.

- The normal ingredient flow is warehouse-first (user-confirmed 2026-11-13): Supplier dispatches stock to a registered Distributor warehouse; Distributor physical receipt adds custody availability; Manufacturer orders only available custody stock and reserves it immediately. Supplier remains seller, approves/rejects, and approved quantities dispatch Distributor → Manufacturer. Only Manufacturer physical receipt credits production stock. Separate shipment legs, actual vs block timestamps, vehicle/route/signer records, canonical units and responsive Ingredient/Product Shipments views are implemented. The legacy 48-hour route below remains compatibility history. Updated full-suite deployment is required; none is performed automatically. See docs/testing/WAREHOUSE_CUSTODY_FLOW.md.

- Ingredient quantity requests now support Supplier → Distributor → Manufacturer delivery. Approval prompts a printable locator QR and a 48-hour carrier-request deadline; the assigned carrier may request Supplier company evidence, then accept and scan pickup. Manufacturer scanned physical receipt alone credits production stock. Pickup debits Supplier availability once, and outstanding-demand summaries exclude already collected stock. Tracking is participant-scoped and refreshed from chain records; missed assignment deadlines are effectively cancelled without timer transactions. This requires the updated Orders suite and its automatically created IngredientDelivery child; old direct-receipt history remains supported. See docs/testing/INGREDIENT_DISTRIBUTOR_DELIVERY.md.

- Manufacturer uses Products (owned finished-product grid and Supplier ingredient grid), My orders (sent/received quantity-request tables) and Information requests (sent ingredient evidence and received company-proof requests). Linked product ingredients open the same Supplier ingredient detail/request view. Existing quantity, proof, verification, approval and physical-stock rules remain separate.

- Supplier uses a compact responsive owned-ingredient inventory with authoritative summaries, combined search/filter/sort controls, a remembered horizontal List or stable three-column Grid view, structured expandable details, listing CRUD/archive/restore and optional owned-batch presentation images. Ingredient registration offers manual entry or local document-assisted prefilling from validated PDF, DOCX, PNG and JPEG uploads; extracted values carry confidence labels and require explicit Supplier review and confirmation. Extraction neither stores the document nor registers, issues, transacts or certifies its claims. Wallets and identifiers remain collapsed; mixed quantity units are never combined. The compact Order requests inbox uses its calculated summaries as accessible status filters and keeps technical identifiers inside the review dialog while handling Manufacturer quantity requests and approve/reject decisions. Information requests retains separate Received/Sent evidence tables. There is no Supplier Browse tab. Signed ingredient fields and historical traceability remain immutable; listing amendments and images are distinct Supplier business metadata. Decisions never move stock, take payment, dispatch goods or automatically grant evidence access.

- Current request flows support browsing, quantity interest, optional details evidence, company proof and an explicit Manufacturer receipt step after Supplier approval. Approval does not credit stock. The Manufacturer confirms physical arrival at an owned location and receives usable stock within the approved amount. Routed deliveries set Supplier stock aside at Distributor pickup; legacy direct receipts debit Supplier stock at receipt. Multiple received ingredients can be consumed in a product without requesting/accepting an ingredient presentation, with exact unit conversion and automatic remaining balances. Source status, active Ingredient Credentials and received-stock limits remain enforced; evidence verification is separate and optional for production. Legacy proposal/reservation/dispatch/recall controls remain deferred and their historical records remain intact. Receipt confirmation and optional-evidence production require an updated full-suite deployment. See docs/testing/MANUFACTURER_REQUESTS.md.

- Browse & requests discovers registered ingredient/product batches without manual publishing, shows only whitelisted business metadata, optional validated presentation media and optional indicative unit prices, and uses request terminology without payments. It provides responsive search/filter/sort cards, a safe detail dialog, distinct quantity/evidence actions, and desktop/mobile request history. Verified company names come from the stakeholder directory; wallets and IDs remain collapsed technical details.
- Catalogue images and company logos are authenticated, ownership-checked, encrypted off-chain presentation records. Every registration is applicant-signed over its exact application ID and complete submitted metadata, whether or not it includes a logo; an optional logo contributes its validated byte digest to the same proof. Validation completes before metadata/media persistence, exact retries are idempotent, conflicting retries fail and concurrency-safe atomic JSON updates preserve simultaneous applications. Registration logos remain Admin-review-only while pending or rejected and become stakeholder-visible only when that exact application has an active verified identity. Approved companies retain their own upload/replace controls, with a shared media revision refreshing both identity and workspace-header avatars immediately. Authorized workspace headers, identity, catalogue, order, shipment and business-traceability views use the shared initials-safe `CompanyAvatar`; the public QR page intentionally remains unchanged. Logos never replace Credential Registry, Stakeholder Registry or batch ownership checks and are never treated as signed credential evidence.
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
- Versioned HTTPS custody-transfer QR locator encoding, exact deployment-origin validation, and strict untrusted-payload decoding
- Authenticated, credential-authorized custody-transfer resolution with intended-recipient checks
- Canonical Receipt Confirmation QR rendering, copy/PNG/print actions, public mobile `/receive/transfer` entry, camera/image/manual scanning, and API-verified transfer summaries
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
