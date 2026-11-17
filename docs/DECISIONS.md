# Project Decisions

## Repository and implementation

- End the per-transaction MetaMask preview-message trial (user-requested 2026-11-17): remove the extra signatures and unused metadata/formatters, preserve ordinary transaction confirmation, SIWE, application ownership signatures and duplicate-request guards. Profile location setup stays in one column at all sizes, with the empty-state icon/message centered across the section. This supersedes the earlier preview trial and two-column location presentation.


- Keep trial wallet messages brief: action purpose, key business values and essential wallet/network/contract/value context, with one reference binding omitted technical details (user-requested 2026-11-17). Preserve distinct message and transaction prompts and all required on-chain steps; coalesce duplicate pending wallet requests and guard Admin issuance against repeated clicks.


- Trial readable MetaMask message signatures before every contract transaction (user-requested 2026-11-17 follow-up). Show a clear two-prompt sequence: preview acknowledgement, then the real transaction. Derive displayed arguments from exact calldata, include wallet/site/chain/target/value context and a fresh preview identifier, verify locally and discard the preview signature. It is not a backend authorization token. Keep the app review dialog removed and preserve SIWE, business confirmations and contract checks.


- Keep affirmative actions to the right of their negative/secondary alternative in right-aligned page and modal action rows (user-requested 2026-11-17). Reorder actual markup so keyboard focus follows the displayed order; keep contextual links before paired decisions and preserve handlers/authorization.


- Make wallet signatures readable inside MetaMask, without a separate TraceChain transaction-review dialog (user clarification, 2026-11-17). Keep the shared readable company-application message and SIWE. Remove the added browser review and its unused API metadata; preserve actual calldata, transaction simulation, wallet network checks, authorization and existing business confirmations. MetaMask controls the normal transaction confirmation display.


- Defer physical dispatch/receiving location setup from registration to Profile (user-confirmed 2026-11-17). Keep legal business address and wallet registration requirements, existing application location drafts and logistics location requirements. Standardize page-level Back navigation at the top left with a left chevron, retaining bottom form-step controls. This supersedes requiring a physical logistics location during registration.

- Collect a separate physical location name and dispatch/receiving address during registration and location setup (user-requested 2026-11-17). Keep addresses encrypted off-chain and limit display to the owning company or actual logistics participants. Preserve stable location IDs; editing current profile details must not move stock or rewrite historical chain records. Existing name-only records remain readable until owners add addresses.

- Consolidate individual company permissions under Admin Manage companies (user-confirmed 2026-11-16). Rename the Company credentials navigation/page, remove the standalone individual-permission sidebar/tab, preserve role defaults/matrix and redirect legacy individual-permission links to company management. Credential lifecycle and permission writes retain their existing authorization and MetaMask confirmation.

- Stop readable Veramo VC/VP/claim/message cache persistence while preserving the Admin bootstrap/export lookup dependency (user-confirmed 2026-11-16). Store that cache in a separate AES-GCM file derived from the KMS secret; encrypt/read back legacy contents before removing them from public DID metadata. Keep business credentials encrypted on Pinata and retrieve the authenticated wallet's registry CID for identity display/verification.
- Remove browser-based backend IPFS/KMS key backup and restore-check tools and their dedicated HTTP endpoint (user-confirmed 2026-11-16; supersedes the earlier Admin UI backup decision). Preserve existing keys, encrypted files, downloaded backups and server-only operator helpers. Holder-signing recovery, credential issuance/verification, IPFS retrieval and SIWE remain separate and unchanged.

- Remove the two trace-direction controls for all roles (user-requested 2026-11-16). Present one clickable stage flow: Supplier-to-Retailer for Supplier, Manufacturer and Distributor; reverse order for Retailer source tracing. Keep batch/product-journey selection and authorized evidence actions. This supersedes the earlier Manufacturer/Distributor direction toggle.

- Standardize page-loading spinners, readable error/success notifications and backdrop/Escape modal dismissal; return to Login after confirmed company registration and logout (user-requested 2026-11-16). Keep Sent proof management separate from general order navigation and route proof links to their actual Sent/Received direction. Supplier traceability is forward-only; Retailer traceability is backward-only. Manufacturer/Distributor retain both directions. This refines the earlier bidirectional UI decision without granting extra data access or changing verification/stock rules.

- Refine navigation by role and actual workflow (user-confirmed 2026-11-16): separate incoming/outgoing orders, custody offers/arrivals/deliveries, Received/Sent information requests and ingredient/product inventory. Retailer has product shipments only; Admin has administration, permissions, discrepancy review and audit, without general business oversight pages. Overview shortcuts remain; replace per-page guidance drawers with clear page structure.
- Provide clickable forward/backward batch traceability from Supplier through Retailer using actual registered links/events and authorized safe projections. Requesting extra ingredient evidence stays an explicit separate action; stage completion never implies VP verification. Collect the initial location name during registration and register/manage locations or Distributor warehouses in Profile; editable display labels do not rewrite historical chain records.
- Distributor arranges pickup after accepting both direct delivery assignments and custody intake offers (explicit user follow-up, 2026-11-16). Custody intake adds a participant-bound encrypted offer/accept/reject/schedule stage before existing sender-signed physical dispatch and receiver-scanned receipt. These coordination records are server-decryptable off-chain data, not inventory. For requested received-custody stock, seller approval still gates fulfilment and the Distributor arranges warehouse dispatch rather than another pickup from seller. Preserve original contract history, current stock guards and proof consent.

- Mirror Supplier → Distributor → Manufacturer ingredient requests for Manufacturer → Distributor → Retailer product orders (user-requested 2026-11-15). Retailer requests first; Manufacturer approves/rejects then chooses direct carrier delivery with Distributor accept/decline and scanned pickup, or enough already received exact-product custody stock at one Distributor location. Reserve custody at Manufacturer selection; credit Retailer only on its own scanned physical receipt. Reuse existing company-proof consent/signing/verification and keep optional evidence separate from order decisions. Isolate product coordination from the near-limit Orders/ingredient contracts in a CustodyTransfer-created ProductDelivery child. Preserve active local ingredient/account/order data rather than resetting or rewriting its historical times during deployment.

- Support two Supplier-selected ingredient fulfilment modes after Manufacturer quantity-request approval (user-requested 2026-11-15). Direct delivery requests an authorized Distributor, which may accept/decline, then scans physical pickup from Supplier; this does not create warehouse stock. Custody fulfilment requires enough physically received, unreserved stock for the exact Supplier batch and full quantity at one Distributor warehouse. Supplier selection reserves it atomically and arranges Distributor dispatch. Manufacturer does not select custody for normal new requests. This supersedes warehouse-only ordering and reservation-at-placement for those new requests; explicit historical custody orders keep their original semantics. Keep the original 48-hour selection window capped by expiry, Manufacturer scanned receipt, separate evidence consent and company ownership rules. Do not mix modes or allow reassignment after pickup/reservation.

- Give Supplier and Distributor separate Custody inventory navigation and authorized detail views, outside shipment pages (user-requested 2026-11-15). Enforce Distributor inventory ownership in serialized API responses, not just frontend filters; Supplier visibility covers its own supplied batches. Centralize existing Company Role credential proof requests under Information requests for every stakeholder, preserving existing presentation/verification permissions and ingredient evidence workflows.

- Separate role-specific shipment workflows (user-confirmed 2026-11-15). Supplier sends stock to custody and, only after a Manufacturer request and Supplier approval, explicitly arranges that order's ingredient delivery. Distributor cannot independently create ingredient delivery jobs; it records the arranged job's actual dispatch. For Supplier custody intake, Distributor may request a challenge-bound Supplier Company Role VP, then accept or reject; requested proof must be current before acceptance/receipt. Acceptance and scanned physical receipt are separate. Rejected goods are not automatically restocked: original Supplier confirms physical return. Receiver QR input is camera or image upload, with no manual-paste fallback. Login and credential issuance remain unchanged.

- Change normal ingredient delivery to warehouse-first custody (user-requested 2026-11-13). Supplier remains seller/issuer; Distributor is physical custodian. Supplier dispatch debits origin availability once; Distributor receipt credits warehouse stock. Manufacturer orders only unreserved received stock and reserves at placement, as explicitly selected by the user. Reject/expiry releases undispatched reservations without a timer transaction. Supplier approval permits Distributor road dispatch to the Manufacturer's selected location; only Manufacturer receipt credits production stock. Keep original batch IDs/units, separate origin from current storage, record each leg, route, vehicle, actual/expected/block times and sender. Use unified Ingredient/Product Shipments and Supplier/Distributor/Manufacturer Transfers. Preserve the old per-order 48-hour route for compatibility, without applying its assignment deadline to new custody orders.

- Add Distributor-assisted ingredient delivery between Supplier and Manufacturer (user-requested 2026-11-12). Supplier approval shows a printable order-bound QR and starts a 48-hour Distributor-request window, as explicitly selected by the user, capped by request expiry. Require carrier acceptance and scanned physical pickup, followed by the Manufacturer's own scanned physical receipt. Reserve/debit Supplier stock at pickup exactly once and credit Manufacturer usable stock only on receipt. Preserve legacy direct receipts; new delivery-required requests cannot bypass the Distributor stage. The assigned Distributor can separately request and verify a Supplier Company Role VP through existing selective/full-disclosure proof and DIDComm services. Deadline cancellation is effective in contract reads/actions without pretending that a blockchain timer automatically broadcasts a transaction. Use an automatically created Orders-controlled delivery child module to keep deployed bytecode within the Ethereum size limit.

- Supplier approval alone never credits Manufacturer stock. For an approved ingredient quantity request, require the Manufacturer's explicit physical receipt confirmation at its own registered location before crediting usable stock (confirmed by the user on 2026-11-12). Allow partial receipts within the approved amount; debit Supplier stock and credit Manufacturer stock atomically. Product creation consumes one or more received batches; ingredient evidence requests/presentations are optional after receipt (user-confirmed follow-up on 2026-11-12). Valid registered ingredients, active Ingredient Credentials, current participant authorization and received-stock limits remain mandatory; optional evidence is never automatically marked verified. Unit choices may convert compatible units exactly into whole registered units, without implicit rounding or cross-dimension conversion. This adds a receipt step to request-only flows while leaving legacy reservation/dispatch controls deferred.

- Treat Supplier document extraction as local, assistive data entry only. Accept signature-validated PDF, DOCX, PNG and JPEG files up to 10 MB in memory; use embedded-text extraction or bundled local English OCR, return per-field confidence, and require editable Supplier review plus explicit confirmation. Never persist the extraction upload, send it to an external AI service, infer missing values, register a batch, issue a credential, prepare a transaction or describe extracted claims as independently verified (user-confirmed scope, 2026-11-12).

- Manufacturer browsing belongs inside Products, alongside owned product batches. Provide separate My orders and Information requests pages with sent/received tables. Supplier requests for company evidence may be linked to either ingredient information or quantity requests; a valid proof must not automatically approve or fulfil either request (user-confirmed scope, 2026-11-12).

- Use Tailwind CSS for web styling while preserving the existing TraceChain visual design, as requested on 2026-11-12. Use its official Vite integration, reuse the existing theme tokens and retain the current reset rather than introducing Preflight layout changes.

- Present Browse & requests as a responsive B2B catalogue with search/filter/sort, verified company names, safe item details and separate quantity/evidence actions. Keep the workflow request-only: no cart, checkout, payment, reservation or automatic fulfilment.

- Treat optional ingredient images and company logos as presentation metadata. Accept only validated PNG/JPEG/WebP files up to 2 MB, encrypt/store them through the existing content abstraction, require authoritative ownership for writes and authenticated safe routes for reads, and never treat them as credential claims or physical-quality evidence. Require every company application to carry an applicant-wallet signature bound to the exact application ID and complete submitted metadata; include the validated logo digest when present and validate everything before persistence. Pending/rejected media is limited to authorized Admin review, and stakeholder visibility begins only when that exact application is active (user-confirmed 2026-11-16). Keep the public QR page logo-free for this stage.

- Supplier navigation separates owned Ingredient batches, incoming My orders, and Received/Sent Information requests. Supplier does not need a separate Browse function. Order decisions and company evidence review are separate actions and do not initiate payment or physical fulfilment.

- The current Browse & requests stage is limited to browsing, quantity/detail requests and company evidence exchange. Defer the numbered physical workflow, location setup, proposal, reservation, dispatch, receipt and recall controls from this page until the user requests them. Preserve their existing implementation and records for later review.

- Registered ingredients and products should be discoverable without a separate seller publishing step. Use supply requests rather than payment/checkout orders; unit prices are informational.
- Requesters specify necessary evidence claims and holders explicitly choose optional disclosures. Verified company identity does not automatically authorize confidential ingredient disclosure.

- Use one GitHub repository as an npm monorepo.
- Work directly on `main`; do not create additional branches unless requested later.
- Use npm workspaces with the folder structure `apps/*` and `packages/*`.
- Use TypeScript for React, Express, Veramo integration, shared code, and contract tooling.
- Use Solidity for smart contracts.
- Use React Router for frontend route composition.
- Organize frontend implementation by feature with shared UI and layout components.
- Use Ethers.js for Ethereum wallet, contract, and address utilities.
- Use the SIWE package for ERC-4361 message construction and verification.
- Use Vitest and Supertest for API authentication tests.
- Keep Hardhat in `packages/contracts`.
- Use one ignored repository-root `.env` and one tracked root `.env.example`; Vite exposes `VITE_API_BASE_URL` plus explicitly selected public `CHAIN_*` values, while the API loads the same file through a repository-relative absolute path. All other variables remain server-only.
- Use Hardhat 3 with Solidity 0.8.34, ethers, Mocha, Ignition, and Foundry-compatible Solidity tests for the current contract workspace.
- Treat the included Counter contract, tests, deployment module, and scripts as toolchain starter code rather than TraceChain business contracts.

## Blockchain-first data architecture

- Preserve a batch's registered numeric quantity and named unit when listing it or ordering stock. Keep one exact unit per catalogue item, require matching batch/request units, and do not silently convert or rescale values. The initial g/each-only catalogue restriction is removed; current ledger quantities remain whole numbers.

- Build TraceChain without a centralized SQL business database.
- Describe the architecture as **blockchain-first with no centralized SQL business database**, rather than claiming that every value is stored on-chain or that the system has no off-chain storage.
- Use Ethereum Sepolia as the authoritative development ledger for stakeholder roles, credential statuses, batch relationships, custody transfers, and receipt confirmations.
- Use Solidity contracts to enforce role permissions and valid supply-chain state transitions.
- Store only hashes, content identifiers, status values, references, quantities, relationships, and traceability events on-chain.
- Never store complete credentials, private keys, recovery phrases, plaintext supporting evidence, or other sensitive identity data on-chain.
- Avoid MySQL, PostgreSQL, SQLite, SQL Server, TypeORM SQL storage, and other centralized SQL databases for authoritative TraceChain business records.
- Allow optional Veramo metadata to use a non-SQL local format or reconstructable configuration after its exact storage design is confirmed.

## Technology responsibilities

| Technology         | Confirmed responsibility                                                              |
| ------------------ | ------------------------------------------------------------------------------------- |
| Hardhat            | Compile, test, debug, and deploy Solidity contracts during development                |
| Ethereum/Sepolia   | Maintain authoritative role, status, and traceability records                         |
| Solidity contracts | Enforce permissions and business rules                                                |
| Ethers.js          | Connect the frontend and API to Ethereum                                              |
| Veramo             | Create, issue, present, and cryptographically verify DIDs and credentials             |
| MetaMask           | Protect wallet keys and sign SIWE messages and blockchain transactions                |
| IPFS               | Store encrypted credentials, evidence, photographs, and reports                       |
| React              | Provide the user interface                                                            |
| Express API        | Coordinate authentication, Veramo verification, IPFS references, and blockchain reads |

## Blockchain gateway and transaction signing

- Store configurable operational permissions by stakeholder role in `StakeholderRegistry`; require System Admin MetaMask transactions for every permission grant or removal, while keeping System Admin authority and structural custody-route constraints non-removable.

- Keep blockchain RPC URLs, deployed contract addresses, ABIs, and authoritative reads in the Express API rather than duplicating contract configuration in the frontend.
- Expose narrowly scoped API operations that validate inputs and prepare unsigned contract transactions.
- Return only the target chain ID, contract destination, calldata, and value required for a prepared transaction.
- Require MetaMask to sign and broadcast each user-authorized write so the stakeholder wallet remains Solidity's `msg.sender`.
- Never send wallet private keys to the API and never use a backend wallet to impersonate stakeholder transactions.
- Require an authorized SIWE session and matching role for protected reads and privileged transaction preparation.

Hardhat is development tooling. It is not the production blockchain and does not replace persistent storage.

## Identity and role authorization

- MetaMask proves control of a wallet address; it does not issue credentials or determine a stakeholder role.
- Normal login uses SIWE only for wallet authentication, followed by direct authorization from the configured `StakeholderRegistry` and `CredentialRegistry`. It does not upload, retrieve, decrypt, or present the Company Role VC.
- For a company wallet, require an active stakeholder, unexpired matching credential reference, active Company Role credential record with the expected type and subject, and the effective role returned by `roleOf`. The current constructor administrator is authorized through `administrator()` without requiring a credential reference.
- Preserve a validly registered Company Role Credential across administrator transfer without requiring its historical issuer to equal the current administrator. Continue checking its active status, expiry, subject, type, stakeholder lifecycle, role, and matching stakeholder credential hash. Only the current administrator may issue or manage Company Role Credentials, and the former administrator loses System Admin authority.
- Allow the current constructor administrator to bootstrap through `administrator()`, then explicitly connect its verified `SYSTEM_ADMIN` Company Role VC to both credential and stakeholder registries using Admin-signed transactions. Keep this bootstrap exception recoverable so a missing or damaged Admin credential reference cannot permanently lock registry administration.
- Keep off-chain Company Role VC issuance and Veramo verification as separate capabilities; never report direct registry authorization as cryptographic verification of the off-chain VC.
- Resolve user-facing company identities from the existing Company Role issuance repository only after the wallet, role, and credential are revalidated against current registries. Expose only safe display fields, use wallet addresses for authorization and transaction values, and place technical identifiers behind optional details for non-admin users.
- Require smart contracts to check `msg.sender` and its assigned on-chain role before changing authoritative state.
- Treat frontend route restrictions as usability controls only. Every sensitive API request and contract transaction must be independently authorized.
- Never derive authority from a URL, frontend fixture, wallet address alone, or browser storage.

The target authorization sequence is:

```text
MetaMask proves wallet ownership
            ↓
API resolves current stakeholder and credential records
            ↓
Registry returns the wallet's effective role
            ↓
Protected APIs recheck current authorization
            ↓
Smart contract checks msg.sender and assigned role
```

## SSI foundation

- Use `did:ethr` on Ethereum Sepolia (chain ID `11155111`).
- Use JWT as the initial Verifiable Credential and Verifiable Presentation proof format.
- Use `@veramo/data-store-json` for non-SQL local SSI metadata and issuer credential storage.
- Store Veramo private key material in a separate JSON tree encrypted at rest with `PrivateKeyStoreJson` and `SecretBox`.
- Treat `@veramo/data-store-json` as a beta package acceptable for this FYP prototype, not automatically as an industry production recommendation.
- Use a server-managed Product Traceability Authority issuer DID for Company Role Credentials.
- Use a distinct server-derived issuer DID for each Supplier's Ingredient Credentials; never accept the issuer DID or Supplier wallet as client-controlled issuance input.
- Keep stakeholder wallet keys, including the bootstrap Admin wallet key, controlled by MetaMask.
- Keep the bootstrap Admin Company Role Credential off-chain.
- Require current on-chain credential-hash and status verification before enabling role-based access control.
- For this prototype, keep Supplier issuer keys in the existing encrypted Veramo KMS; production requires organizational stakeholder key custody, rotation, recovery, auditing, and multi-operator controls.
- Use typed JWT W3C Ingredient Credentials now. Do not claim selective disclosure; a later presentation format requires a separate confirmed design.

## Supplier Ingredient Credential registration

- Require SIWE authentication, current on-chain Supplier authorization, an active matching Company Role credential record, and both ingredient issuance/registration permissions.
- Bind the Ingredient Credential subject to the authenticated Supplier wallet and derive its Supplier-specific issuer DID on the server.
- Verify the newly issued VC cryptographically before deterministic canonical SHA-256 hashing or transaction preparation.
- Encrypt the complete VC and private metadata with AES-256-GCM before IPFS upload. Put only identifiers, hashes, the encrypted CID, status/lifecycle data, and required traceability fields on-chain.
- Register the Ingredient Credential first, re-read and match it, then register the ingredient batch and re-read and match that record.
- Prepare unsigned transactions in the API and keep signing/broadcasting in the Supplier's MetaMask. Persist an ignored recovery record so a retry resumes the first unfinished stage.
- Reconstruct the Supplier batch list from registration events plus authoritative `getBatch` reads, scoped to the authenticated Supplier wallet.

## Target smart-contract boundaries

- `StakeholderRegistry` manages company approval, wallet-to-role mappings, role assignment and removal, credential references, and replacement of lost or compromised company wallets.
- `CredentialRegistry` manages credential hashes, IPFS CIDs, expiry, suspension, and revocation status.
- `IngredientRegistry` manages supplier ingredient batches and evidence references.
- `ProductRegistry` manages product batches and product-to-ingredient relationships.
- `CustodyTransfer` manages intended receivers, quantities, transfer state, and receipt confirmation.
- Other contracts must query the stakeholder registry or use a proven access-control library before permitting role-restricted operations.
- Smart-contract records represent custody and traceability; they do not claim to determine legal ownership.

The intended contract layout is:

```text
packages/contracts/contracts/
  access/StakeholderRegistry.sol
  credentials/CredentialRegistry.sol
  traceability/IngredientRegistry.sol
  traceability/ProductRegistry.sol
  traceability/CustodyTransfer.sol
  interfaces/IStakeholderRegistry.sol
```

## Custody-transfer QR locator

- Use the phone-camera-compatible canonical HTTPS locator `{publicAppUrl}/receive/transfer?v=1&chainId={chainId}&contract={custodyTransferAddress}&transferId={transferId}` for all newly generated custody-transfer QRs, copied links, PNGs, and labels. Require the exact configured origin and allow the legacy `tracechain://` form only for explicit manual-paste compatibility.
- Keep the payload limited to the configured chain ID, CustodyTransfer deployment address, and existing bytes32 transfer ID. It is a locator, not trusted transfer data or an authorization token.
- Never put quantities, product data, credentials, JWTs, company data, private documents, encryption keys, wallet secrets, or receipt data in the QR payload.
- Treat every decoded field as untrusted until the authenticated API resolves `getTransfer(transferId)` against the configured CustodyTransfer contract.
- Require the API to verify the configured chain and contract, transfer existence, `AwaitingReceipt` status, and that the authenticated SIWE wallet is the on-chain recipient.
- Expose resolution through authenticated `POST /api/custody-transfers/resolve-qr`; require a locally verified Distributor/Retailer credential, completed on-chain authorization, and effective `RECEIVE_TRANSFER` permission before returning transfer data.
- Keep the contract read behind an injectable, read-only gateway and return only the transfer ID, product batch ID, sender, recipient, quantity, dispatch/expected timestamps, and status.
- Generate QR images through the shared canonical encoder only after a successful on-chain transfer provides a real `bytes32` transfer ID; do not generate fixture receipt QRs.
- Support camera, image-file, and manual-paste inputs, but send the complete payload to the authenticated resolution endpoint and display no decoded transfer fields before that endpoint succeeds.
- Release camera tracks on completion, failure, close, or unmount and suppress duplicate scan-resolution requests while one is active.
- Require receipt confirmation through a separate MetaMask-signed transaction. Scanning alone must never change custody.
- For local custody testing, seed only already-deployed chain-31337 contracts with unlocked Hardhat accounts; require the recipient Distributor to be independently onboarded and credential-authorized, and never load a private key in the seed command.
- Revalidate the authorized SIWE recipient and current transfer state before returning unsigned `confirmReceipt` calldata. Keep signing and broadcasting exclusively in the recipient's MetaMask, wait for its receipt, and refresh the authoritative contract record before showing `Received`.

## Product traceability QR locator

- Keep the permanent product QR separate from the one-time custody-transfer receipt QR. Use the canonical HTTPS path `{publicAppUrl}/trace/product?v=1&chainId={chainId}&registry={productRegistryAddress}&batchId={batchId}` so a normal phone camera can open the deployed application.
- Limit the QR to version, configured chain ID, configured ProductRegistry address, and an existing `bytes32` product batch ID. Reject missing, duplicated, unknown, malformed, wrong-chain, and wrong-registry values; QR input must never select an RPC endpoint.
- Resolve product state, ingredient links, credential status, custody events, and company display names through configured read-only services. Public responses are privacy-minimized; only an authenticated authorized session receives additional technical identifiers, wallets, quantities, and transaction hashes.
- Never return complete credentials, confidential claims, encrypted content, CIDs, keys, or private documents from product tracing. Product scanning is read-only and must not call or prepare receipt confirmation.
- Describe a successful result as a verified blockchain traceability record, not proof that the physical product is genuine.

## Credential and evidence storage

- Use the existing issued Ingredient Credential repository as the only source for Supplier evidence responses; never accept a browser-submitted credential ID or credential body for evidence acceptance.
- Bind every evidence request challenge to the request ID, ingredient batch ID, requester/verifier, Supplier, purpose, issue time, and deadline. For full JWT VPs, sign and verify those values plus the challenge, presentation expiry, and exact credential ID/hash. For holder-signed SD-JWT presentations, use the same context-bound digest as the nonce. Encrypt the presentation before IPFS upload and recheck the nested credential, exact registered batch credential, issuer/subject/type, hash, dates, on-chain status, and Supplier authorization before preparing acceptance calldata.
- Treat `Accepted` request status as the idempotent completion signal for Retailer evidence acceptance. Only Manufacturer acceptance may set or require `acceptedForManufacturer`; Retailer acceptance must never grant product-creation authority.
- Derive private evidence and receipt participants from the authenticated SIWE wallet and authoritative records, never from caller-selected wallet fields. Return not found to unrelated callers where revealing existence would leak private workflow information. System Admin access is limited to explicitly defined operations.
- Persist prototype workflow files with queued atomic replacement, treat malformed files as a fail-closed operator-recovery condition, and never overwrite a corrupt source automatically. When a transaction is mined but the subsequent read fails, report the confirmed transaction separately and offer an authoritative refresh instead of resubmission.
- Present the complete JWT Ingredient Credential in Phase 6. JWT selective disclosure is not supported and must not be claimed in the UI or documentation.
- Persist only ignored recovery metadata for evidence/product/transfer preparation so rejected or interrupted MetaMask writes can resume without generating different content or calldata inputs.
- Store receipt preparations as versioned, content-hash-addressed encrypted drafts. Reuse exact retries, preserve corrected drafts without overwriting earlier encrypted content while the transfer is still `AwaitingReceipt`, and reject further preparation after finalization.
- Resolve finalized private receipt content only by the authoritative contract reference: receipt hash plus CID for `ReceiptConfirmed`, details hash plus CID for discrepancies, and reason hash for direct rejection. Never select a draft merely because it is newest.
- Keep recorded actual-arrival time inside matched private receipt metadata. Return it only to a currently authorized sender, recipient, or System Admin, and never through public product traceability.
- Prepare evidence, product, and transfer writes in the API, but keep every transaction signature and broadcast in the authenticated stakeholder's MetaMask.
- For Distributor-to-Retailer custody, derive selectable products from positive received `CustodyTransfer` inventory, resolve recipients through the verified stakeholder directory, retain the Retailer wallet only as the internal transaction recipient, encrypt shipment references and handling notes, and expose the real QR only after `getTransfer` verifies the mined `AwaitingReceipt` record.

- Encrypt complete credentials, supporting documents, photographs, and reports before uploading them to IPFS.
- Treat an IPFS CID as a content-addressed integrity reference, not a password or access-control mechanism.
- Use authenticated encryption such as AES-256-GCM for sensitive IPFS content.
- Never upload plaintext credentials, private keys, or recovery phrases to IPFS.
- Never store an encryption key beside the encrypted content it unlocks.
- Minimize public metadata and use non-descriptive filenames.
- Pin important content through at least two independent nodes or services and periodically test retrieval.
- Treat published IPFS content as potentially permanent, even after unpinning.
- Use on-chain revocation or suspension status to invalidate credentials because deleting every IPFS copy cannot be guaranteed.
- Keep wallet private keys and recovery phrases under the user's MetaMask control only.

The target storage flow is:

```text
Credential or evidence
        ↓
Encrypt on an authorized user's device
        ↓
Upload encrypted bytes to IPFS
        ↓
Receive CID
        ↓
Record CID, integrity hash, and status on Ethereum
```

## Authentication and transient state

- Use ERC-4361 Sign-In with Ethereum for wallet authentication.
- Reuse MetaMask's injected EIP-1193 provider for browser-extension connections, including existing authorized accounts, and use the official `@metamask/connect-evm` client for Mobile QR and extension fallback. Keep one connection attempt active, use bounded timeouts, retry one stale SDK transport once after disconnecting only that transport, and skip duplicate EIP-6963 announcement from SDK clients owned directly by TraceChain.
- Present Browser extension and Mobile QR tabs so the user explicitly selects the transport. Clear only MetaMask Connect's persisted transport-choice marker before a mobile connection so an earlier extension choice cannot override the QR tab, while preserving the existing SIWE proof flow.
- Access nonce and session storage through repository interfaces.
- Use development-only, in-memory nonce and session repository implementations for the current demonstration.
- Use fixed, non-secret chain-31337 public defaults only in Vite `test` mode so frontend tests do not depend on a developer's ignored `.env`; production and development modes continue using validated repository configuration.
- Keep authentication state short-lived.
- Recheck on-chain role and revocation state before sensitive operations.
- Document that in-memory state disappears after an API restart and cannot support multiple API instances without shared transient storage or a different token design.
- Require the same wallet, credential, and blockchain authorization gate on local development hosts; do not add an account-free sample-data bypass.
- Use the SIWE session wallet as the only wallet input for Company Role Credential verification; never trust a wallet address in the credential-presentation request body.
- Store only a safe local-verification summary in the development session, never the credential or encoded JWT.
- Keep `onChainStatusChecked` and `authorizationReady` false after local-only verification; set them true only after the configured registries confirm the credential and stakeholder authorization.
- Use one shared `CompanyRole`-to-workspace mapping for future authorization decisions.
- Deliver the bootstrap Admin credential through an explicit development-only export under ignored `.tracechain/holder/` storage, with no silent overwrite of a different credential.

## Recovery requirements

- A credential hash or blockchain record cannot reconstruct a lost credential, wallet key, DID key, or encryption key.
- If a credential is lost while the registered wallet remains available, require a signed reissuance request, revoke the previous credential, issue a replacement, encrypt it, upload it to IPFS, and register the new reference and status.
- If a wallet is lost, require independent company re-verification before disabling the old wallet, assigning the role to a new wallet, revoking the old credential, and issuing a replacement.
- If a DID key is lost, rotate and revoke it when supported by the selected DID method; otherwise create a new DID and reissue the credential.
- Avoid making an organizational stakeholder dependent on one employee's device.
- Plan for multiple authorized operators, a company recovery contact, and stronger approval such as multisignature authorization for high-risk recovery operations.

## Confirmed limitations

- Public Ethereum state is visible and expensive.
- IPFS does not provide confidentiality or guaranteed retention by itself.
- Encryption cannot provide recovery when the only decryption key is lost with a device.
- In-memory or stateless authentication makes immediate token revocation and horizontal scaling harder.
- Direct blockchain queries can be slower than indexed database queries.
- Sepolia is suitable for development and demonstration, not an industry production deployment.
- Smart-contract defects and incorrect role assignments can have persistent consequences.

## Unconfirmed decisions

- Whether each company has one wallet or multiple authorized operator wallets
- Which party encrypts credentials and controls decryption keys
- How recovery keys are protected independently from user devices
- Which IPFS nodes or pinning services provide redundancy
- Which evidence remains on IPFS and which evidence is disclosed only when requested
- How the System Admin independently re-verifies a company during wallet recovery
- Production replacement or hardening strategy for the beta JSON SSI store
- Immediate session-revocation design if signed stateless tokens replace server-side sessions
- Smart-contract upgrade policy and final authorization-library choice
- Hosting and deployment platform
- Whether references to “Veramo 2” mean the historical Veramo 2.0 release, DIDComm v2, or W3C VC Data Model 2.0
