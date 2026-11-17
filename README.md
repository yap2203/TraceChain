# TraceChain

**Windows Solidity builds:** Hardhat uses its supported WASM compiler on Windows because Application
Control may block the downloaded native compiler (`spawn UNKNOWN`). Solidity version and optimizer
settings are preserved. See [contract setup](packages/contracts/README.md).

**Storage recovery:** Veramo VC/VP caches now use an encrypted local file instead of readable
copies in `public-data.json`. My company identity retrieves the current registry-referenced VC from
encrypted IPFS. Backend encryption-key backup and restore checks are not exposed in the web app
or HTTP API. Existing operator backups and the separate holder signing-key recovery flow are preserved.
See [storage and recovery](docs/STORAGE_AND_RECOVERY.md).

**Stakeholder record views:** inventory now uses one shared searchable list/detail presentation for
Manufacturer, Distributor and Supplier custody records, while shipment lists use the same scannable
product, sender, destination, quantity, ETA and status columns across roles. Distributor product
dispatch is available only after opening **View shipment**; opening the detail is read-only. Shared
status timelines show the real current workflow step. Product details decode only known on-chain
units (for example, `each` is shown as units) and keep unknown/raw values under Technical details.
Authenticated catalogue images are lazy-loaded, concurrent duplicate image/state reads are
deduplicated, and missing, denied and failed media have distinct fallbacks without weakening media
authorization.

**Workspace UI:** navigation is grouped by task for all five roles, with shared compact overview
summaries, attention/activity cards, searchable shipment and request lists, separate
stock/order/shipment destinations, clickable forward/backward traceability and responsive layouts.
Distributor pickup scheduling applies to both custody offers and direct buyer deliveries. Locations
are registered and edited in Profile. See the [role workflow test guide](docs/testing/ROLE_WORKFLOWS_TEST_GUIDE.md)
and [UI review](docs/UI_REFINEMENT.md).

Manufacturer **Send products to custody** shows the validated balance for the selected pickup
location. For a verifiably untouched product batch, its original quantity is available only at its
recorded production location. Once custody inventory has been initialized, the actual location
balance is authoritative, including zero. Creating an offer remains read-only and does not initialize,
reserve or transfer on-chain stock.

**Product orders:** Retailer requests → Manufacturer approves/rejects → Manufacturer chooses direct
Distributor delivery or sufficient received Distributor custody → Distributor dispatches → Retailer
scans and confirms receipt. Manufacturer proof requests use Information requests; Manufacturer now
has Custody inventory and Retailer has Shipments navigation. See the [product delivery test guide](docs/testing/PRODUCT_DISTRIBUTOR_RETAILER_FLOW.md).
This needs the updated complete suite with the automatically created ProductDelivery child.
The running local deployment has not been replaced: its ingredient delivery progressed beyond the
restricted migration helper's supported history, so preflight stopped before any writes. Current
ingredients, accounts and history remain intact; enabling the new product coordinator requires a
preservation-aware deployment migration.

**Local redeployment with preserved test data (2026-11-15):** the configured chain-31337 suite
was redeployed alongside the old contracts, and the root `.env` was updated after 25 state checks.
The existing ingredient, 12 custody units, three locations, approved order, Admin and four temporary
role accounts were retained, with the same credential hashes/CIDs and encrypted files. Expired proof
attestations for the completed custody intake remain historical on the old deployment; they were
not represented as fresh verification. The running API was reloaded and verified against the new
addresses. Refresh/sign in again, and regenerate QR labels because registry addresses changed.

`packages/contracts/scripts/redeploy-local-preserving-state.ts` is a deliberately restricted local
migration helper, not a general production migration. With Node 26, run
`node scripts/redeploy-local-preserving-state.ts` from `packages/contracts` for a read-only plan;
only setting `TRACECHAIN_REDEPLOY_APPLY=1` permits writes. It requires loopback Hardhat chain 31337
and unlocked local accounts, refuses unsupported activity, deploys alongside existing contracts,
replays supported records and updates `.env` only after verification. It uses no private keys,
uploads, chain resets or storage/code patching. Migration manifests in ignored `.tracechain/migrations/`
contain old/new addresses and public state comparisons. This standalone deployment does not create
an Ignition execution journal; existing Ignition journals are left intact.

**Two ingredient delivery modes:** Manufacturer sends a quantity request to Supplier. After
approval, Supplier chooses **direct Distributor delivery** (Distributor accepts/declines, then
scans pickup) or **delivery from existing Distributor custody** (enough received, unreserved
stock for the exact batch is required). New requests do not require warehouse selection by the
Manufacturer; Supplier custody selection reserves stock atomically. Manufacturer physical receipt
is required in both paths. See the [two-mode setup and test flow](docs/testing/TWO_MODE_INGREDIENT_DELIVERY.md).
This requires the updated full suite with `IngredientDelivery.fulfilmentPolicy() = 2`; no running
deployment or environment is changed automatically. Explicit older custody orders remain supported.

**Company ownership:** management records are scoped to the authenticated company wallet, with
separate permissions for actual order, evidence and custody participants. Manufacturer product
details reject other Manufacturers' records; API transaction preparation checks resource ownership
and location ownership before storing private workflow data. Public buyer catalogue discovery and
public traceability summaries remain available. See the [ownership access review and two-company
test flow](docs/OWNERSHIP_ACCESS_REVIEW.md). Restart/rebuild API and web to apply these checks;
this review does not require an additional contract deployment. Public blockchain data remains public.

**Custody inventory** is a separate navigation page for Suppliers and Distributors, with clickable
stock details. Each Distributor receives only its own inventory through the API; Suppliers can inspect
their own batches held by custodians. Shipments no longer contains inventory tabs. Manufacturer
ordering uses a minimal public availability summary. On-chain balances remain publicly readable.

**Information requests** is available to every stakeholder at `/{role}/information-requests`.
Received/Sent company-proof cards cover custody/delivery, quantity-order and ingredient-information
contexts, using existing proof signing, verification and DIDComm services. Ingredient evidence remains
available as a separate category. Admin visibility follows existing participant permissions; this page
does not grant new proof/credential powers. Old Supplier/Retailer evidence-request links still resolve.
These page/privacy changes need API/web restart or rebuild, with no additional contract deployment.

**Warehouse delivery:** Suppliers send ingredients to a registered Distributor warehouse.
Custody fulfilment uses physically received, unreserved stock. For new requests, Supplier selects
and reserves that stock after approval; older explicit warehouse orders reserve at placement.
Rejection/expiry releases the undispatched remainder. Supplier stays seller.
After approval, the Supplier selects **Arrange ingredient delivery** on the Manufacturer order.
Only then can the Distributor record dispatch to the selected Manufacturer location; scanned physical receipt
alone credits usable production stock. Each leg has its own shipment/QR. Supplier availability is
debited once at initial dispatch, never again at Manufacturer receipt.

**Shipments** replaces Distributor Incoming shipments and Ingredient deliveries, with Ingredient
and Product types, custody balances and onward transfer from detail. Supplier and Manufacturer also
have Transfers/Shipments. Road dispatch records vehicle, route, canonical quantity/unit, actual time,
ETA, block time and signer on-chain. Old Distributor links redirect to Shipments. This needs a fresh
full-suite deployment; old journals and root environment are not modified automatically.
See [setup, limitations and step-by-step testing](docs/testing/WAREHOUSE_CUSTODY_FLOW.md).
The older 48-hour assignment route remains documented for legacy compatibility only.

Supplier **Sent shipments** tracks its outbound custody stock and delivery orders. Distributor
**Custody & deliveries** reviews incoming Supplier custody offers: request/verify Supplier company VP,
then accept or reject. Acceptance does not credit stock; camera scanning or QR-image upload followed
by explicit physical receipt does. Rejection leaves stock in return-pending state until the Supplier
scans and confirms physical return. Ingredient dispatch jobs appear only for approved orders arranged
by their Supplier. Distributor **Product transfers** remains separate. Manual QR entry is removed
from shipment and legacy receipt scanners. This requires `IngredientDelivery.reviewPolicy() = 1`
in a fresh complete suite; the API reports an upgrade requirement for older deployments.

**Supplier remaining stock:** Ingredient batches and Supplier order details calculate remaining
stock after open requests automatically: current on-chain stock minus pending and approved quantities
not yet received. Partial receipts are not deducted twice. Rejected, expired and completed requests
are excluded; excess demand shows a shortfall. This is a demand estimate, not a stock reservation.
Actual Supplier stock decreases at warehouse dispatch, at pickup for legacy routed deliveries, or
at receipt for legacy direct requests. New custody orders are excluded from Supplier demand estimates
because that stock has already left Supplier availability. Use **Refresh** to load
requests or receipts submitted by another company. No contract deployment is needed for this display.

**Production ingredients:** Supplier approval does not add usable stock. In Manufacturer **My orders
→ View request → View shipments & receipt**, open the Distributor shipment and scan/confirm the
quantity physically received at your selected location. Ingredient evidence is optional for production from that received
stock; it can still be requested and verified separately when more information is needed.
Under **Products → Create product batch**, select that location, choose multiple ingredients and
their quantities/compatible units, and review automatically calculated remaining balances. Product
confirmation deducts each ingredient atomically on-chain; remaining stock is reloaded afterward.
Order preparation simulates against the pending block, so a real receipt time after an idle local
chain's last block is not falsely rejected. This does not mine a block or alter the recorded time.
See [the receipt and production test flow](docs/testing/MANUFACTURER_REQUESTS.md#receipt-and-multi-ingredient-production).

This receipt action requires the updated `SupplyChainOrders` contract (`approvedReceiptPolicy() = 1`),
and optional-evidence production requires `ProductRegistry.receivedProductionPolicy() = 1`.
Existing deployments show an explicit update message; they are not modified automatically. The suite's
one-time immutable wiring requires a fresh full-suite deployment and matching root `.env` addresses.
Preserve your existing journals/keys and register test participants and requests against the new suite.

Manufacturer navigation now uses **Products**, **My orders** and **Information requests**.
Products contains a searchable **My products** grid and **Supplier ingredients** grid. Open an
ingredient to request information/evidence or a quantity; linked ingredients in product details
open that same request view. My orders separates requests sent to Suppliers from requests received
from product buyers. Information requests separates sent ingredient evidence from received company
proof requests, including Supplier challenges linked to either an ingredient-information or quantity
request. Review [the Manufacturer flow and test checklist](docs/testing/MANUFACTURER_REQUESTS.md).

The web application uses **Tailwind CSS 4** through the official Vite plugin, preserving the
existing TraceChain navy/teal theme, typography, page layouts and dark/light workspace themes.
Run `npm install` at the repository root after updating dependencies, then `npm run dev` as usual.

Styling starts in `apps/web/src/styles/tailwind.css`, imported by `main.tsx`. Its inline theme
aliases expose existing tokens as utilities such as `bg-ws-surface`, `text-ws-teal`, `font-ui`
and `font-code`. Shared buttons, cards, form controls, tables, badges and alerts use utilities.
Existing page selectors use Tailwind `@apply` in the `components` layer; each stylesheet imports
the theme with `@reference`. Keep utility class names complete in variant maps so Tailwind can
discover them. Add new source styles under `apps/web/src`.

Preflight is deliberately omitted to preserve the existing reset and native control appearance
([Tailwind's documented selective imports](https://tailwindcss.com/docs/preflight)). Theme variables,
specialized effects, animations, print styles and runtime/data-dependent inline styles remain
where needed. Existing media/container breakpoints are retained. To validate styling changes,
run `npm run test:frontend`, `npm run typecheck` and `npm run build --workspace @tracechain/web`.

Supplier workspaces now use **Ingredient batches** (a searchable inventory with a remembered compact
List or three-column Grid view), **Order
requests** (a responsive Manufacturer quantity-request inbox), and **Information requests**
(separate Received and Sent evidence tables). The request inbox provides calculated status
summaries, search, workflow filters, sorting and structured review dialogs while keeping wallets and
technical identifiers collapsed. There is no Supplier Browse tab. Ingredients support create/read,
version-checked listing edits, archive/delete and restore. Listing edits change the business name,
category, description and indicative price; signed credential claims, quantities and units stay
intact. Suppliers can also attach an optional validated presentation image to an owned batch.
Supplier decisions are recorded on-chain and never reserve stock, process payment or dispatch goods.
See [the Supplier management flow](docs/BROWSE_REQUESTS_README.md#supplier-management).

Supplier ingredient registration also supports document-assisted data entry. An authorized Supplier
may upload one PDF, DOCX, PNG or JPG/JPEG document up to 10 MB; the API extracts embedded text or
runs local English OCR, then prefills the existing registration form with per-field confidence
labels. The Supplier must review, edit and explicitly confirm every extracted value before the
existing credential and MetaMask registration workflow can continue. Extraction does not register a
batch, issue a credential, submit a transaction, store the source document, upload it to IPFS or
independently verify that its claims are truthful. Scanned PDFs without embedded text should be
uploaded as PNG/JPG pages or entered manually.

The updated IngredientRegistry and SupplyChainOrders require a fresh complete suite deployment
to enable listing management and approve/reject. Missing capabilities produce explicit update
messages; existing source credentials, keys, deployment journals and `.env` are preserved.

DIDComm transport is entirely backend-managed: the API packs/encrypts and unpacks/decrypts
messages with separate company-agent keys. Registration and evidence/request screens have no
messaging key setup or backup panel. Presentation signature settings are separate, under
**My company credential → Presentation signing settings**, with links from presentation flows.
Those browser keys sign approved VPs; they are not used for DIDComm message encryption.

Company-agent role/name metadata follows current authenticated authorization while preserving its
messaging DID and encrypted key. If the original ingredient-request notification was never delivered,
a Supplier can still request company evidence as a new encrypted thread anchored to the exact current
on-chain evidence request and its live identity challenge. Replies must reference that actual company
request message. Stale local workflow records after a chain reset do not authorize delivery; create a
new valid evidence request instead. Retrying a pending company request keeps its existing challenge.

**Current review scope:** Browsing, quantity/detail requests and company evidence remain separate.
Manufacturer My orders now adds explicit physical receipt after Supplier approval, with receiving
location setup when needed. Request/approval alone never changes stock. The earlier proposal,
reservation, dispatch and recall controls remain outside this page; request-only records cannot
enter those older reservation/dispatch methods.

Read [Browse & requests — current functions and deferred work](docs/BROWSE_REQUESTS_README.md)
for the active five-part flow, the purpose of each retained physical-flow function and the checks
needed before implementing those steps later. The physical-flow references below document retained
backend/contract capabilities, not the current page's controls. Updated contract deployment is
required to submit location-free request-only records; existing records and configuration remain intact.

**Browse & requests** now discovers registered ingredients and finished products automatically.
There is no separate publishing step. The responsive one-to-four-column catalogue includes search,
filters, sorting, result counts, lifecycle/credential summaries, verified company names and safe
empty/loading/error states. Open an item to inspect its allowlisted business summary, request
additional ingredient evidence, or request a quantity. Requests do not reserve stock, move goods or
take payment. New registrations accept an optional
indicative price per registered unit and a three-letter currency code; existing prices remain
unavailable until recorded in new registration metadata.

Suppliers can upload one optional PNG/JPEG/WebP catalogue image per owned ingredient batch, and a
verified company can upload or replace its own optional logo, each limited to 2 MB. Company
registration also accepts an optional logo separately from supporting documents. Every application,
including one without a logo, requires an applicant-wallet signature over the exact application ID
and all submitted metadata. When present, the same proof includes the validated logo digest. The API
validates the complete proof and actual image bytes before persisting either record, rejects
conflicting application-ID retries and keeps identical retries idempotent. It stores pending logos
encrypted off-chain. They are visible only to an authorized Admin during review and become available
through authenticated stakeholder branding
routes only after that exact application is active. Rejected and still-pending logos are not exposed
to other stakeholders. Catalogue responses expose authenticated media routes rather than storage
CIDs or ciphertext. Images and prices are presentation data, not credential claims or independent
physical-quality evidence. The public QR traceability page does not display company logos.

The receiver of a quantity request can request Company Identity Proof before sharing evidence.
New request-linked company proofs use an authority-derived SD-JWT attestation tied to the existing
Company Role VC hash and browser-held signing key. Necessary claims are enforced, optional claims
are holder-selected, and wallet/role/subject binding always remains visible. Existing signed
Company Role VCs and legacy full-disclosure challenges are preserved. The API verifies and can
decrypt the source credential and needs its original issuer key to create this derived attestation;
only the holder signs the presentation. This is not holder-exclusive credential storage.

**Contract update required:** direct registered-batch requests use the new `requestBatch` method.
Deploy the complete suite using a fresh deployment ID and update all seven root addresses before
testing this flow; no deployment or data migration is performed automatically. See the updated
[request test flow](docs/ORDERS_PHYSICAL_FLOW_TEST_GUIDE.md#browse-and-requests-review-flow).

Workspace controls share responsive sizing and theme styles. Order forms use two desktop columns
and collapse to one column at narrow usable widths, including beside the tablet sidebar. Long
identifiers wrap, wide tables scroll within their own containers, and dialogs stay within the
viewport. Responsive layout checks cover mobile, tablet and desktop sizes; real role-by-role
business testing remains described in the guide below.

Catalogue orders now connect evidence decisions to physical ingredient dispatch, receipt,
location-based usable stock, production consumption and downstream recall tracing. The new
**Catalogue & orders** workspace page uses an on-chain `SupplyChainOrders` ledger and preserves
Manufacturer → Distributor → Retailer custody routes. Read the
[local setup and role-by-role test guide](docs/ORDERS_PHYSICAL_FLOW_TEST_GUIDE.md) before testing.

Catalogue & orders includes a role-specific workflow guide, visible location setup and a dedicated
order workspace with a current-state **Next step** message. Numbered sections separate proposing,
reserving, reviewing evidence, dispatching and receiving. Optional identity checks, interrupted
evidence-binding recovery and cancellation have separate expandable sections. Buyers review,
verify and accept evidence in Ingredient evidence before linking it to the order. The guide is
operational guidance; the API and contracts still enforce authorization and current state.
The workflow tiles provide section navigation without a duplicate tab row. **Refresh data** is
beside the page title; **Recall & tracing** is a separate stock-safety utility below the workflow
(Administrators use their **Trace recalls** workflow tile).
Reservation forms pre-fill the unfulfilled order quantity and block repeated reservation while
stock remains allocated. The API reports specific proposal, expiry, existing-reservation,
quantity, stock, permission and ingredient-usability problems before preparing calldata.
Dispatch preparation also checks the remaining reservation, buyer authorization, required
identity and current credential hash, every linked evidence presentation, source validity and
finished-product Distributor routing. The dispatch form shows missing evidence/identity blockers
and defaults to the remaining reserved quantity; contract simulation still rechecks the final action.

Catalogue entries retain the batch's registered quantity and named unit, including `g`, `kg`,
`litre`, `each` and `unit`. Requests must use that item's exact unit; no automatic conversion
or quantity rescaling occurs. Quantities remain whole numbers. Older deployments with the
former g/each restriction return `CATALOGUE_UPGRADE_REQUIRED` for other units until redeployed.
Deploy the complete **seven-contract** suite with a fresh Ignition deployment ID and configure
the root `SUPPLY_ORDERS_ADDRESS` plus the six existing addresses. Existing chain data is preserved;
it is not automatically migrated. No public network deployment is part of this change.

New authenticated endpoints: `GET /api/orders`, `POST /api/orders/prepare`,
`POST /api/orders/:orderId/evidence/prepare`, `POST /api/orders/:orderId/identity`,
`GET /api/orders/recall/:batchId`, `GET /api/orders/branding/me`,
`POST|GET /api/orders/branding/:wallet/logo`, and
`POST|GET /api/orders/catalogue/ingredients/:batchId/image`, and
`POST|GET /api/orders/catalogue/products/:batchId/image`. Writes remain unsigned transaction
preparations for MetaMask or authenticated presentation-media updates;
the identity endpoint also reuses existing credential retrieval, holder-proof verification and
backend-managed encrypted DIDComm transport. Company Role VCs remain full disclosure. Ingredient
SD-JWT selective presentations remain supported. Run `npm run test:orders` for the scoped suite.

Admin Access Control includes **Individual Permissions** alongside Role Permissions and the
Permission Matrix. Select a registered company wallet and choose **Inherit role**, **Allow**,
or **Deny** for each operational permission, then confirm through MetaMask. Individual settings
take precedence over role defaults; current stakeholder/credential validity and operation-specific
role/participant restrictions still apply. Settings reset on an approved role change and do not
carry over to a replacement wallet. This controls company wallets, not separate employees.

Admin-only API endpoints: `GET /api/blockchain/personal-permissions/:account` and
`POST /api/blockchain/transactions/personal-permission` (`account`, permission hash, `setting`:
0 inherit, 1 allow, 2 deny). The API prepares unsigned calldata and the administrator signs it.
**This feature changes StakeholderRegistry bytecode and requires a fresh, consistently wired
contract-suite deployment and updated root environment addresses.** Existing deployments do not
gain these methods automatically; no deployment or environment changes are performed by this feature.

Forms provide required-field feedback and validate names/references, whole-number quantities,
date ranges, recipient selections, email/contact/DID formats and file type/size limits before
transaction preparation. Protected APIs retain their independent validation; date inputs reject
numeric/boolean/null coercions and impossible calendar dates. Shared action buttons keep icons
and labels aligned horizontally.

> Evidence messaging uses backend-managed DIDComm company agents beneath the existing business screens. MetaMask + SIWE remains the login, holder presentation-signing keys remain client-controlled, and OpenID4VP is deferred. See [`docs/DIDCOMM_STAGE1.md`](docs/DIDCOMM_STAGE1.md) for protocol, custody, migration and security boundaries.

The real Manufacturer/Retailer–Supplier Ingredient Evidence workflow now uses this channel for
encrypted request and full-credential VP delivery. Suppliers can separately request a fresh,
challenge-bound Company Role VP from the requesting Manufacturer or Retailer before deciding
whether to disclose ingredient evidence. Identity presentation, evidence verification, and
business acceptance remain separate actions. Ingredient credential issuer proofs use Supplier
Veramo keys, holder presentations use browser-controlled keys, and separate DIDComm encryption
keys are protected by the TraceChain API. TraceChain can therefore decrypt messages; this is not
confidential from the TraceChain operator. The EvidenceRegistry and CredentialRegistry hardening
changes contract bytecode and requires redeployment before using the updated evidence-acceptance
and administrator-transfer behavior.

TraceChain is a blockchain-based supply-chain traceability system with Self-Sovereign Identity credential verification. It is a TypeScript npm monorepo developed as a final-year project.

The current version includes a responsive React application, five stakeholder workspaces, Sign-In with Ethereum wallet authentication, an Express API, server-side Veramo SSI services, encrypted IPFS content storage, shared role types, and the TraceChain Solidity contract suite. Primary operational dashboards and their batch, shipment, inventory, detail, and company-identity views use authenticated services. Admin workflows, Supplier Ingredient Credential registration, Manufacturer production transfers, Distributor-to-Retailer transfers, custody receipt reconciliation, discrepancy management, and public product traceability history are connected to authenticated services; remaining non-admin report screens still require migration from fixtures.

## Current implementation status

| Area                                     | Status                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Public login and company-registration UI | Three-step onboarding submits real local applications; optional logo is encrypted off-chain  |
| MetaMask and ERC-4361 authentication     | Environment-driven; local chain 31337 for testing and Sepolia as the public target           |
| Nonce and session storage                | Implemented in process memory for development                                                |
| Stakeholder workspace UI                 | Admin, custody receipt, and Supplier batch registration use authenticated services           |
| Responsive UI                            | Implemented for mobile, tablet, and desktop layouts                                          |
| Loading and table pagination             | Implemented; tables support 5, 10, 25, 50, or 100 rows per page                              |
| Company Role Credential presentation     | Separate diagnostic API retained; no VC upload is required during normal login               |
| Company Role Credential verification     | JWT signature, issuer, wallet binding, role, dates, and local status implemented             |
| Credential-based RBAC                    | Local/API verification checks wallet role, lifecycle, credential hash and status             |
| Stakeholder identity presentation        | Issuance names are rechecked against current registries before display                       |
| SSI and Veramo services                  | did:ethr Sepolia agent, encrypted JSON storage, issuance, verification, and bootstrap        |
| Supplier Ingredient Credentials          | Typed JWT VC issuance, encrypted IPFS storage, and sequential on-chain registration          |
| Manufacturer production flow             | Real evidence VP, product creation, Distributor transfer, and transfer QR implemented        |
| Company identity proof for evidence      | DIDComm-linked challenge, preview/approve/decline, VP verification, expiry and replay guards |
| Distributor transfer flow                | Real inventory, verified Retailer transfer, MetaMask signing, and QR implemented             |
| Smart contracts                          | Seven modular TraceChain contracts plus an Ignition deployment module                        |
| Private IPFS content                     | AES-256-GCM envelope and injectable HTTP pinning gateway implemented                         |
| Custody-transfer QR workflow             | Reconciliation, encrypted evidence, discrepancies, and MetaMask writes implemented           |
| Product traceability QR                  | Permanent public locator, safe resolver, and custody timeline implemented                    |
| Business persistence                     | Not implemented                                                                              |

## Repository structure

```text
apps/
  web/             React 19, Vite 8, React Router, ethers, and MetaMask Connect
  api/             Express 5, SIWE authentication, and in-memory repositories
packages/
  shared/          Shared role definitions plus custody-transfer and product QR codecs
  ssi/             Veramo agent, did:ethr, JWT VC/VP, encrypted JSON storage, and verification
  contracts/       Hardhat 3 starter, Solidity example, tests, and deployment module
docs/
  architecture/    Component boundaries and trust model
  api/             HTTP endpoints and environment configuration
  ssi/             SSI scope and unresolved decisions
  smart-contracts/ Contract toolchain and planned contract scope
  testing/         Current checks and future coverage
scripts/           Repository-wide automation documentation
```

## Prerequisites

- Node.js 22 or later
- npm 10 or later
- Git
- MetaMask browser extension or MetaMask Mobile for the wallet sign-in flow

## Setup

From the repository root:

```bash
npm install
```

Copy the shared root environment template. On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

On macOS or Linux:

```bash
cp .env.example .env
```

The real root `.env` file is ignored. The example file must contain safe defaults or placeholders only. Never add private keys, seed phrases, API secrets, real credentials, or personal supporting documents to the repository.

Local `.tracechain/` stores, deployment journals, build output, downloaded credential exports and
TraceChain recovery/backup files are ignored. Keep recovery kits and operator backups outside the
repository with a separate secure backup. Git ignore rules do not encrypt files, create backups or
remove files already tracked by Git; review staged files before committing. Source code, tests and
`.env.example` remain versioned.

## Development

Run the frontend and API together:

```bash
npm run dev
```

The root development command builds the shared and SSI workspaces before starting Vite and the API, so it also works directly after a clean `npm ci`.

Or run them separately:

```bash
npm run dev:web
npm run dev:api
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000`
- Health check: `GET http://localhost:3000/api/health`

### Local contract testing

The development environment can target the persistent Hardhat chain at `31337`. Start the node from `packages/contracts` and leave it running:

```bash
npx hardhat node --chain-id 31337
```

In a second terminal, deploy the complete module:

```bash
npx hardhat ignition deploy ignition/modules/TraceChain.ts --network localhost --deployment-id tracechain-orders-stage
```

Copy all seven resulting backend contract addresses from `ignition/deployments/tracechain-orders-stage/deployed_addresses.json` into the ignored root `.env`, including `SUPPLY_ORDERS_ADDRESS`. Keep old deployment journals and records; use a new deployment ID for a new bytecode version. The root example's six older deterministic addresses are illustrative, not this new deployment. Restart both development servers after changing environment variables.

To create one real Manufacturer-to-Distributor transfer without redeploying, first set
`DEV_DISTRIBUTOR_WALLET` to an unlocked Hardhat account that is already an active Distributor and
has its matching Company Role Credential. Then run:

```bash
npm run dev:seed-custody-transfer
```

The command refuses any chain other than 31337, discovers the already-deployed traceability
contracts through the configured registries, creates only the minimum upstream local test records,
and prints the real transfer ID and canonical QR payload. It uses unlocked Hardhat accounts through
the local RPC and never reads or stores a private key. It does not create or bypass the
Distributor's SSI credential.

MetaMask can add the configured local network automatically. Hardhat account 0 is the deployed System Admin; use a different generated account to test a new company application because an active administrator cannot submit a stakeholder application. Hardhat development private keys are public test keys and must never be funded or reused on a public network.

The registration review screen submits a real `StakeholderRegistry.submitApplication` transaction locally. Before retaining metadata, the API verifies an applicant-wallet signature bound to every submitted registration field. An optional company logo is included in that proof, byte-validated and encrypted; it is not part of the supporting-document bundle or an on-chain credential claim. Application metadata uses atomic, concurrency-safe JSON persistence so simultaneous registrations do not overwrite one another. Supporting files are now encrypted and pinned before the transaction is prepared, with an encrypted local review cache. Their exact contents are bound into the applicant signature. The existing on-chain profile reference remains unchanged; the document CID and encrypted cache are maintained off-chain, without a contract change.

### Environment variables

The root `.env` is shared by the API and Vite. Vite explicitly exposes `VITE_API_BASE_URL`, `VITE_PUBLIC_APP_URL`, the public `CHAIN_*` network values, and the ProductRegistry and CustodyTransfer addresses; server secrets remain backend-only:

```text
PORT=3000
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
SIWE_DOMAIN=localhost:5173
SIWE_URI=http://localhost:5173
CHAIN_ID=31337
CHAIN_NAME=TraceChain Local
CHAIN_RPC_URL=http://127.0.0.1:8545
CHAIN_CURRENCY_SYMBOL=ETH
STAKEHOLDER_REGISTRY_ADDRESS=0x...
CREDENTIAL_REGISTRY_ADDRESS=0x...
INGREDIENT_REGISTRY_ADDRESS=0x...
EVIDENCE_REGISTRY_ADDRESS=0x...
PRODUCT_REGISTRY_ADDRESS=0x...
CUSTODY_TRANSFER_ADDRESS=0x...
SUPPLY_ORDERS_ADDRESS=0x...
DEV_DISTRIBUTOR_WALLET=0x...
AUTH_COOKIE_NAME=tracechain_session
AUTH_SESSION_TTL_SECONDS=28800
SEPOLIA_RPC_URL=https://example.invalid
VERAMO_KMS_SECRET_KEY=replace-with-a-64-character-hexadecimal-key
TRACECHAIN_AUTHORITY_DID_ALIAS=tracechain-authority
BOOTSTRAP_ADMIN_WALLET=0x0000000000000000000000000000000000000000
IPFS_PINNING_API_URL=https://example.invalid/pinning/pinFileToIPFS
IPFS_PINNING_TOKEN=replace-with-a-scoped-pinning-token
IPFS_ENCRYPTION_KEY=replace-with-a-64-character-hexadecimal-key
IPFS_GATEWAY_URL=https://gateway.pinata.cloud/ipfs

VITE_API_BASE_URL=http://localhost:3000
VITE_PUBLIC_APP_URL=http://localhost:5173
```

The CORS origin, SIWE domain, and SIWE URI must match the address used to open the frontend.

### IPFS upload and retrieval

`IPFS_PINNING_API_URL` uploads AES-256-GCM encrypted content using the backend-only
`IPFS_PINNING_TOKEN`. `IPFS_GATEWAY_URL` downloads that content by CID; it is not the upload URL.
Set a full HTTPS gateway base ending in `/ipfs`, without a CID, for example:

```env
IPFS_GATEWAY_URL=https://your-gateway.mypinata.cloud/ipfs
```

My company identity reads the authenticated wallet's current credential CID from the registries,
retrieves the encrypted envelope through the gateway, then decrypts and checks its hash/wallet
binding on the backend. **Verify My Credential** performs the separate cryptographic and current
authorization checks. Gateway retrieval does not require an npm Pinata SDK.

The current retrieval client sends no gateway authentication headers. A restricted gateway may
return HTTP 403 even when it is reachable; check its Pinata access configuration. The pinning token
is not automatically sent to the gateway. Network failures and denied retrieval do not establish
credential tampering. Restart the API after changing gateway configuration.

Backend IPFS/KMS key backup controls and `POST /api/ssi/storage-key-backup` have been removed;
the retired route returns 404. Existing encrypted stores and operator backup files remain intact.
The holder presentation-signing recovery kit is separate and remains available.

Contract addresses and ABIs are backend configuration. For writes, the API validates the requested operation and returns an unsigned transaction containing the chain ID, destination, calldata, and value. MetaMask signs and broadcasts that transaction so the authenticated stakeholder remains the contract `msg.sender`; private wallet keys never reach the API.

For Sepolia, set `CHAIN_ID=11155111`, `CHAIN_NAME=Sepolia`, and replace `CHAIN_RPC_URL` with a browser-safe Sepolia endpoint. The active chain URL is deliberately public because MetaMask needs it in the browser. Restrict any embedded hosted-provider key to the intended frontend domains and Sepolia methods. Never put a privileged or unrestricted secret in a browser-exposed chain URL.

SSI variables are loaded lazily when an SSI request or command needs the Veramo agent, so API startup and SIWE-only tests do not require SSI secrets. Replace every SSI placeholder locally before bootstrapping or presenting a credential. `BOOTSTRAP_ADMIN_WALLET` is a public address; never provide its private key or recovery phrase.

Admin approval activates the encrypted Company Role Credential without automatically downloading
a readable credential file. The company retrieves its own credential through **My Company Identity**.
Approved applications retain **Complete credential activation** for unfinished registry transactions.

Admin can also open **Manage companies ? Manage ? Individual company permissions** to set
Allow, Deny or Inherit for that exact company wallet. This uses the existing company permission API and
requires an explicit MetaMask confirmation. The separate Individual permissions tab is removed from Permissions. Role defaults remain in Access Control; individual
overrides cannot bypass credential expiry, suspension, revocation or protected Admin authority.

Document previews center images at their original aspect ratio within the available dialog space.
Download actions occupy a separate right-aligned row below the preview.

### Readable wallet confirmations

Company registration uses a readable wallet-ownership signature: company name, registration number,
requested role and wallet appear before the exact application/profile/document references. The shared
frontend/API formatter binds the same submitted fields; this signature does not submit a transaction
or transfer ETH. Existing SIWE sign-in remains unchanged.

Contract actions now open MetaMask's normal transaction confirmation directly. The extra preview
message-signing trial has been removed, including its unused ABI metadata/formatter. Existing
business confirmations, prepared calldata, network checks and duplicate-request protection remain.
Company approval still has two real transactions (application approval and credential registration),
so two transaction confirmations can be expected. SIWE login and company-registration ownership
signatures are separate required flows and remain unchanged. No extra app review dialog is shown.

Restart the API and refresh the browser together after this signing-format update. Earlier in-progress
application signatures use a different format; retry the application from the refreshed page. Existing
on-chain applications, credentials, SIWE sessions and contracts are not rewritten or redeployed.

Registration's **Connect MetaMask** button explicitly requests account permissions before reading the
selected address, so an existing connection is not silently reused. While waiting, the page asks the
user to choose an account in MetaMask; success is announced and **Change account** reopens selection.
Cancellation preserves the previous address, and a pending wallet request gets a readable message.
See [MetaMask account permissions](https://docs.metamask.io/metamask-connect/evm/guides/manage-user-accounts/).

Registration uses `react-phone-number-input` for the company contact number, with a country
selector (Malaysia by default), international formatting and country-aware validation. The closed
selector shows only the selected flag; its searchable dropdown shows flags beside country names
and supports keyboard selection, Escape and outside-click dismissal. The form
normalizes the number to E.164 before review/signing. Country flags are bundled locally. Registration
is currently the only phone-entry form; changing the country supports international companies.
The dependency is installed by the normal root `npm install` command.

Required-field asterisks share a red marker across public registration, workspace forms and custom
document/production/receipt labels. Optional fields have no required marker, and existing native
required validation remains in place.

Registration is split into five short steps: **Company details**, **Contact & representative**,
**Wallet & identity**, **Supporting documents**, and **Review & submit**. Only the current step
is shown and validated before Continue. Back preserves entered values, selected files and the
connected wallet; step changes focus the new heading. Progress steps are clickable and keyboard-accessible:
backward navigation preserves entries, while a forward jump opens the first incomplete prerequisite.
Step navigation is disabled during wallet selection or final submission.

Page-level Back navigation appears at the top left with a left-chevron icon and consistent styling.
Form-step Back buttons remain next to their Continue/Submit controls. Page, card, form and modal
action rows align to the right and wrap within narrow screens; page-level Back navigation stays left.
Negative/secondary actions precede the positive action (Reject then Approve, Decline then Accept,
Cancel then Save/Confirm). Buttons follow this order in the markup as well as visually for keyboard users. Shared action buttons use
centered icons and labels with a consistent 6 px gap; file metadata styles do not affect button labels.

### Dispatch and receiving addresses

Profile location setup places the location name above the full-width address field at every screen
size. Registration actions stay in a separate right-aligned row, and the empty-location icon/message
are centered across the full section.

Registration does not require a dispatch/receiving location. Set it up later in
**Profile > Company profile & locations**: enter the **Location name** and **Dispatch / receiving address**
when adding a location or warehouse, and use **Edit location** to correct its current name/address.
A registered location is still selected for orders, dispatch, receipt and production; its stable
on-chain ID links the stock and history. Location registration still needs MetaMask confirmation.

Addresses are encrypted before IPFS upload and retained in the existing encrypted application or
location metadata cache. Full addresses are returned only to the owner and authorized order,
shipment or custody-offer participants, not general catalogue/public-traceability readers. Relevant
selectors and route details show the name and authorized address. Existing registration location drafts remain available in Profile for older applications. Old records without an address show **Address not provided** until edited.

Address edits update current profile details; they do not move inventory or rewrite historical
on-chain IDs. Register a new location for a different physical site. These changes require no
contract redeployment and preserve old name-only records/API clients.

Before submission, **Review & submit** lists every selected document with its filename, size and
local PDF/image preview. Previews use temporary object URLs that are revoked when closed; no file
is uploaded by preview or Continue. Review requires a fresh declaration and an explicit final
**Submit application** click. PDF preview has a download fallback when browser sandbox restrictions
prevent inline viewing.

### Reviewing registration documents

- Admin: open **Company applications ? application details ? Registration documents** to view or
  download applicant-provided PDF/image files before making an approval decision.
- Applicant: open **Profile ? Company profile ? Registration documents**. Pending applicants can
  review documents from the signed-in application status screen on Login without workspace access.
- Older applications saved only filenames/hashes; those hashes cannot recover the files. The
  applicant can attach the three original documents again from either applicant view. This is a
  supplemental upload and does not change the original application/profile hash. Saved sets cannot
  be overwritten, and Admin cannot attach files on behalf of the applicant.

Files remain private: the API checks the confirmed application's owner or the currently authorized
on-chain Administrator before listing or serving them. Other companies receive no file access.
Allowed formats are PDF, PNG and JPEG, up to 10 MB each; all three required document kinds must be
present. Preview is sandboxed, with Download available if the browser blocks inline PDF rendering.
Reviewing an uploaded file does not cryptographically verify its claims or certify its contents.

The backend stores AES-256-GCM encrypted IPFS copies and an encrypted review cache at ignored
`.tracechain/applications/documents.encrypted.json`. Original bytes are decrypted only for an
authorized request. No files, private keys or decryption keys are placed on-chain or in browser
localStorage. Keep the encrypted cache backed up with existing operator state. Browser key-backup
controls remain removed. See [storage and recovery](docs/STORAGE_AND_RECOVERY.md).

## SSI and System Admin bootstrap

`@tracechain/ssi` configures Veramo 7 with did:ethr on Sepolia, JWT credentials, DID/credential/message metadata in a public JSON store, and SecretBox-encrypted private issuer keys in a separate JSON store. Runtime files are written under `.tracechain/veramo/` and ignored by Git. The beta `@veramo/data-store-json` package is accepted for this FYP prototype, not presented as an automatic production recommendation.

Generate a 32-byte hexadecimal development KMS secret without placing it in source code:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put that value, a real Sepolia RPC URL, the authority alias, and the public Admin wallet address in the ignored root `.env`, then run:

```bash
npm run ssi:bootstrap-admin
npm run ssi:export-admin-credential
```

Do not run these commands with `.env.example` placeholders. The bootstrap command creates or reuses the server-managed Product Traceability Authority DID, derives the Admin subject DID from the public wallet address, and issues at most one active bootstrap `SYSTEM_ADMIN` Company Role Credential. The export command copies that verified credential to `.tracechain/holder/admin-company-role-credential.json` for development-only holder delivery. It will not silently overwrite a different credential. CLI output contains safe identifiers and status only. The credential and encrypted issuer key remain off-chain; MetaMask continues to control the Admin wallet key.

The credential verification service returns a deterministic SHA-256 hash used for blockchain registration. After local cryptographic verification, the API checks the session wallet, role, stakeholder lifecycle, credential hash, subject, type, and current status against the configured registries. The constructor-created System Admin remains a narrow bootstrap exception until its credential is connected. From **Admin → Company Credentials**, use **Connect Admin credential** to encrypt and pin the bootstrapped VC, register its hash/reference in `CredentialRegistry`, and link the same reference in `StakeholderRegistry`. Both steps require Admin MetaMask transactions; the complete VC remains off-chain.

## Frontend routes

The root route redirects to `/login`. Unknown routes also return to the login page.

| Role         | Canonical pages                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public       | `/login`, `/register-company`                                                                                                                                                   |
| Admin        | `/admin/overview`, `/admin/applications`, `/admin/credentials`, `/admin/stakeholders`, `/admin/discrepancies`, `/admin/reports`                                                 |
| Supplier     | `/supplier/overview`, `/supplier/ingredients`, `/supplier/evidence-requests`, `/supplier/credentials`, `/supplier/reports`                                                      |
| Manufacturer | `/manufacturer/overview`, `/manufacturer/ingredient-evidence`, `/manufacturer/product-batches`, `/manufacturer/transfers`, `/manufacturer/credentials`, `/manufacturer/reports` |
| Distributor  | `/distributor/overview`, `/distributor/incoming-shipments`, `/distributor/inventory`, `/distributor/transfers`, `/distributor/credentials`, `/distributor/reports`              |
| Retailer     | `/retailer/overview`, `/retailer/incoming-products`, `/retailer/scan`, `/retailer/traceability`, `/retailer/evidence-requests`, `/retailer/credentials`, `/retailer/reports`    |

Each role root redirects to its overview. Internal page identifiers such as `/supplier/batches` are normalized to their canonical system paths while retaining search parameters used by detail screens.

The `/register-company` route provides the complete five-step application interface: company and representative information, MetaMask wallet association, required supporting-document selection with 10 MB validation, review, and declaration. It can submit a real application transaction to the configured local registry. Actual PDF/PNG/JPEG document bytes are encrypted and pinned through the configured content store; storage failure prevents transaction preparation.

### Local workspace access

Localhost uses the same SIWE and current on-chain role/status gate as other environments. There is no account-free sample-data bypass. An authorized session is required before workspace controls are enabled.

## Authentication

The login page restores an existing HttpOnly-cookie session without requesting wallet access. After an explicit user action, it reuses an already-authorized injected MetaMask extension provider when available, or uses MetaMask Connect for Mobile QR and extension fallback. Connection attempts are serialized and time-bounded, and progress plus cancellation remains visible inside the authentication card. It then requires the environment-configured chain, requests a five-minute nonce, builds an ERC-4361 message, requests a signature, and sends the signed message to the API. Local development uses chain 31337; the public test deployment uses Sepolia.

The API verifies the SIWE signature, address, domain, URI, chain ID, nonce, issue time, and expiration. It atomically consumes the nonce, creates a process-local HttpOnly-cookie session, and resolves current authorization from the configured registries. The current administrator is checked through `administrator()`. Company wallets must have an active stakeholder, matching active/unexpired Company Role credential record and reference, valid subject/type, and a nonzero effective `roleOf` result. A Company Role Credential that was validly registered by a former administrator remains valid after an administrator transfer; its current lifecycle, expiry, subject, role, and stakeholder hash still govern authorization. No VC upload, vault password, VP, Snap, transaction, or gas is required for login.

Authorized session responses also contain a safe company display name resolved from the existing Company Role issuance record. The stakeholder directory rechecks the wallet, role, credential ID, stakeholder lifecycle, and credential status through the live registry authorization rules before returning `companyName`, `role`, `walletAddress`, and `active`. Missing legacy names use a role-based fallback, duplicate names gain a shortened-wallet suffix, and stale or revoked identities are excluded. Names are presentation data only: authorization and transactions continue to use verified wallet addresses.

SIWE authentication and registry authorization are distinct. Direct registry authorization does not claim that the off-chain VC signature was cryptographically verified. Manual Company Role VC verification remains available as a separate SSI capability, while protected APIs refresh authorization from chain state before use. A URL, frontend role, historical approval, fixture, environment allowlist, or browser value never grants access.

Login displays connecting, challenge, signature, wallet verification, registry-check, authorized, application-status, denied, and unavailable states. Unregistered, pending, evidence-required, rejected, activation-pending, suspended, revoked, and expired wallets remain authenticated only for permitted status/onboarding operations. Active wallets are redirected to the workspace mapped from the authoritative role.

The current SIWE verifier is tested for EOA wallets. ERC-1271 contract-wallet authentication is not configured and must not be assumed to work.

For local testing, start `npx hardhat node` from `packages/contracts`, deploy the suite to `localhost`, place the resulting addresses plus `CHAIN_ID=31337` and `CHAIN_RPC_URL=http://127.0.0.1:8545` in the root `.env`, then run `npm run dev` from the repository root. Import the relevant unlocked Hardhat account into MetaMask, select TraceChain Local, and connect from `/login`. Login requests one message signature and no gas; active wallets go directly to their role workspace, while other wallets remain on the status view.

## Workspace UI

The role sidebars separate incoming/outgoing orders, custody offers, warehouse arrivals and outbound
deliveries. Retailer shipments contain products only. Administrator navigation contains company
administration, permissions, discrepancies and audit rather than operational ordering.
Received/Sent Information requests are distinct destinations.
The Sent evidence lists contain only outgoing evidence requests and their responses; incoming
company-proof response controls are managed on Received requests rather than embedded in Sent.
Company-proof details do not embed general order navigation. Loading pages use the shared centered
spinner; dismissible notifications show success or readable errors instead of raw RPC/JSON payloads.
Success notifications disappear after 4 seconds; error notifications after 7 seconds. Only the exact
current sidebar page is highlighted, including separate Received and Sent request destinations.
Workspace modals dismiss on backdrop clicks or Escape. Confirmed registration and logout return to
Login. Supplier traceability is forward-only; Retailer traceability is backward-only.
Traceability has one stage flow per role, without direction-switch buttons. Manufacturer and
Distributor use Supplier-to-Retailer ordering; Retailer keeps the source-tracing reverse order.
See the
[role and process matrix](docs/testing/ROLE_WORKFLOWS_TEST_GUIDE.md).

New authenticated Orders endpoints: `GET /api/orders/traceability?kind=ingredient|product&batchId=…`,
`GET /api/orders/profile`, `PATCH /api/orders/profile/locations/:location`,
`GET|PUT /api/orders/:referenceId/pickup`, `GET|POST /api/orders/custody-offers`,
`GET /api/orders/custody-offers/:offerId`, and
`POST /api/orders/custody-offers/:offerId/action|prepare`. Each checks current session authorization;
private coordination data is participant-scoped and encrypted through existing storage. Pickup plans,
offer decisions and editable location labels are off-chain; the API can decrypt them. Existing
MetaMask-signed contracts remain authoritative for dispatch, receipt and stock. No contract change
or redeployment is required solely for this workspace/pickup stage; previously pending ProductDelivery
deployment requirements still apply. No new environment variables or npm dependencies were added.

Integrated pages live in `apps/web/src/features/workspaces`, grouped by stakeholder and workflow. `WorkspaceApp.tsx` owns canonical routing and the access boundary; `WorkspaceScreen.tsx` dispatches detailed pages. Shared workspace presentation components, receipts, reports, and table controls are kept in focused subfolders.

The Admin overview, company-application, Company Credential, Access Control, and Registry Audit screens use authenticated blockchain gateway reads. Credential management lists authoritative `CredentialRegistry` records and prepares MetaMask-signed lifecycle transactions. Access Control displays contract-enforced role and stakeholder lifecycle data, and the Admin audit screen produces exportable current-state snapshots. Application rejection, approval, Company Role Credential issuance, encrypted IPFS storage, and sequential registry writes are backend-validated and MetaMask-signed, with restart-resumable workflow records under `.tracechain/issuance/`.

Supplier, Manufacturer, Distributor, and Retailer **My Credential** pages use the authenticated wallet-scoped `GET /api/blockchain/credentials/me` read. Credential identifiers, hashes, subjects, issuers, lifecycle status, expiry, encrypted CID, and update time come from the configured registries. Company name and registration number are merged from the private issuance journal when available; fake transaction hashes, block numbers, DIDs, and company identities are not displayed.

The company workspace now presents this information as **My Company Identity**. `GET /api/ssi/company-role/me` retrieves selected claims from the current wallet's server-managed encrypted Company Role VC and merges them with current registry state. `POST /api/ssi/company-role/me/verify` explicitly runs Veramo signature, trusted-issuer, wallet/DID, date, role, deterministic-hash, lifecycle, replacement, and current-authorization checks. Verification is user-triggered and remains separate from SIWE login. The API can decrypt credentials issued through this server-managed prototype; it does not expose raw credentials, encryption keys, or claim holder-exclusive storage.

The identity card supports accessible wallet/DID/identifier copying, a collapsed technical section, lifecycle and cryptographic states, and a generated PDF summary carrying the required limitation statement. The PDF is a readable summary, not the original signed credential.

The operational gateway reconstructs wallet-scoped ingredient, product, evidence-request, custody-transfer, and inventory lists from contract events, then refreshes each item through its current-state getter. Supplier, Manufacturer, Distributor, and Retailer primary dashboards and their batch, shipment, inventory, and detail screens therefore display current contract state.

Authenticated operational responses enrich records with verified display fields such as `supplierName`, `manufacturerName`, `senderName`, and `recipientName`. Recipient lists return safe identity objects while preserving `walletAddress` as the select value and transaction recipient. Normal stakeholder screens show company names first; wallets, bytes32 IDs, CIDs, and hashes remain available under optional Technical details. Admin access-control and audit screens retain their technical identifiers.

The Supplier ingredient screen issues a typed `IngredientCredential` whose subject is the authenticated Supplier wallet and whose issuer is a server-derived, Supplier-specific DID. The backend verifies the signed VC before hashing it, encrypts the complete credential and private batch metadata with AES-256-GCM, pins only the encrypted envelope to IPFS, and prepares `CredentialRegistry.registerCredential` followed by `IngredientRegistry.registerBatch`. MetaMask remains the signer, retries resume the first incomplete stage, and the authenticated Supplier receives enriched private metadata only through the narrower ingredient-batch API. This JWT VC implementation does not claim selective disclosure. The prototype server-managed KMS must be replaced by an organizational stakeholder key-custody design for production.

The Manufacturer production flow now uses real contract records. A Manufacturer selects an active Supplier batch, prepares an encrypted evidence request, and signs `EvidenceRegistry.requestEvidence`. The request challenge is a digest of the request ID, batch, requester, verifier, Supplier, purpose, issue time, and deadline. The intended Supplier retrieves its server-authorized issued Ingredient Credential and presents the complete JWT VC in a Veramo-signed VP whose signed context also binds those fields, the challenge, presentation dates, and exact credential ID/hash. JWT selective disclosure is not supported or claimed. Before returning unsigned `accept` calldata, the API verifies the VP and nested credential signatures plus every request binding and rechecks the exact registered batch credential, lifecycle, hash, expiry, and Supplier authorization. Accepted batches can then be consumed by a real `createProduct` transaction and transferred to an active Distributor through `createTransfer`. Only a verified `AwaitingReceipt` transfer ID is passed to the existing QR renderer.

New product registrations bind the same stable Manufacturer location ID to ingredient consumption
and the on-chain product record. The form can also capture optional product presentation data:
PNG/JPEG/WebP image, category, country of manufacture, description and an indicative currency/unit
price. The textual
presentation is encrypted off-chain and integrity-bound to the product metadata hash; the image is
stored through the authenticated encrypted catalogue-media path after the product transaction is
confirmed. Authenticated catalogue and custody views receive only allowlisted presentation fields
and a safe media URL, while public traceability receives only the intended textual catalogue fields.
Storage CIDs, ciphertext and raw image data are not exposed. Existing products are not assigned
invented presentation values. Presentation editing is not currently offered because the deployed
product record has no versioned metadata-update operation.

Retailer catalogue availability is read from current CustodyTransfer inventory, including the
fresh-product initialization rule, rather than from the registered production total. Reserved or
transferred units are therefore not presented as orderable Manufacturer stock. Product cards report
the current ProductRegistry traceability result, which includes the lifecycle of every linked
Ingredient Credential, instead of implying that products carry a separate Product Credential.

Private evidence and receipt endpoints derive participants from the SIWE session and authoritative workflow or custody records; caller-supplied wallet values never grant access. Unrelated callers receive a not-found response so the API does not confirm that a private record exists. Workflow JSON is written atomically and corrupt files fail closed without being overwritten. If a MetaMask transaction is mined but the following authoritative refresh fails, the UI reports that confirmation succeeded and offers a refresh action instead of asking the user to submit the transaction again. Process-local SIWE sessions are still lost on API restart and require a new sign-in.

The Distributor transfer screen lists only positive on-chain inventory previously received by the authenticated Distributor and resolves active Retailers through the verified stakeholder directory. The API rechecks the Distributor credential, role, `INITIATE_TRANSFER` permission, product transferability, inventory, Retailer role, and `RECEIVE_TRANSFER` permission. Shipment references and handling notes are encrypted through the existing IPFS abstraction; the browser receives only unsigned `createTransfer` calldata. After MetaMask mines the transaction, the API verifies its sender, recipient, product, quantity, and `AwaitingReceipt` state before the real bytes32 ID reaches the QR renderer. The existing Retailer scanner and recipient-only MetaMask receipt confirmation complete the custody handoff.

Remaining non-admin report screens still contain fixture data or simulation handlers and must be migrated before they are authoritative.

Access Control also provides live role counts and a configurable on-chain permission matrix. Every grant or removal is prepared by the API, signed by the System Admin in MetaMask, recorded by `StakeholderRegistry`, and enforced by the affected contracts. System Admin authority and structural custody routes remain fixed safety constraints. This contract upgrade requires a fresh deployment.

## Smart contracts

`packages/contracts` uses Hardhat 3 and Solidity 0.8.34. From that package:

See the [smart-contract process and verification guide](packages/contracts/README.md) for deployment wiring, role permissions, lifecycle transitions, end-to-end workflows, and known limitations.

```bash
npx hardhat compile
npx hardhat test
```

The contract suite contains stakeholder/application and reviewed role-change management, credential lifecycle, evidence requests, ingredient batches, product composition, and custody/inventory transfers. Deploy and wire all contracts as one module:

```bash
npx hardhat ignition deploy ignition/modules/TraceChain.ts --network sepolia
```

Resume the same Ignition deployment after a provider interruption; do not deploy contracts individually. Sepolia settings use Hardhat configuration variables named `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY`; never commit their real values.

Private company documents and evidence are encrypted before being sent to a configured pinning provider. Only their CID and integrity hash belong on-chain. `IPFS_ENCRYPTION_KEY` must decode to exactly 32 bytes and must be backed up outside the repository; losing it makes encrypted content unrecoverable.

## Custody-transfer QR locator

TraceChain uses this canonical phone-camera-compatible version 1 reference:

```text
{publicAppUrl}/receive/transfer?v=1&chainId={chainId}&contract={custodyTransferAddress}&transferId={transferId}
```

The QR payload is only an untrusted locator for an existing on-chain transfer. It never contains
quantity, product, credential, company, private-document, key, wallet-secret, or receipt data.
The frontend generates the QR only from a successful on-chain `bytes32` transfer ID, using
`VITE_PUBLIC_APP_URL`, the configured `CHAIN_ID`, and `CUSTODY_TRANSFER_ADDRESS`. The public
`/receive/transfer` route validates that exact origin and path, restores an existing SIWE session,
or opens the existing MetaMask Mobile flow on a phone. Legacy `tracechain://` payloads are accepted
only by manual paste for backwards compatibility. Decoded fields are never treated as verified data.

`POST /api/custody-transfers/resolve-qr` requires a fully credential-authorized SIWE session,
resolves `getTransfer(transferId)` through a read-only gateway, and verifies the configured chain,
contract deployment, `AwaitingReceipt` status, intended Distributor/Retailer recipient, and current
`RECEIVE_TRANSFER` permission before returning a minimal transfer summary. The frontend displays
that summary only after this response succeeds. Scanning never prepares or sends a transaction.

After resolution, the intended recipient records actual, damaged, and rejected quantities; usable
quantity is calculated as `actual - damaged - rejected`. Receipt notes and optional PNG, JPEG,
WebP, or PDF evidence are deterministically serialized, AES-256-GCM encrypted, and pinned through
the existing injectable IPFS content store before any transaction is prepared. Identical retries
reuse the encrypted workflow record, while changed details are rejected as a conflict.

When actual quantity matches the transfer, `POST
/api/custody-transfers/transactions/confirm-receipt` returns unsigned `confirmReceipt` calldata
containing only required quantities, the deterministic receipt hash, and encrypted CID. A shortage
or excess instead returns unsigned `reportDiscrepancy` calldata and leaves the transfer awaiting
System Admin review. Complete and wrong-product rejection use the separate unsigned `reject`
transaction. The frontend validates the destination, network, and recipient wallet, asks MetaMask
to sign, waits for mining, then refreshes `GET /api/custody-transfers/:transferId` and operational
inventory.

Encrypted receipt preparations are versioned, content-hash-addressed drafts. An identical retry
reuses its existing draft, while corrected quantities, notes, arrival time, or evidence create a new
draft without overwriting the earlier one as long as the transfer remains `AwaitingReceipt`. After
the contract action is finalized, private retrieval selects only the draft matching the
authoritative receipt hash/CID, discrepancy hash/CID, or rejection reason hash. Superseded drafts
are never returned as finalized evidence. Existing single-record JSON receipt repositories remain
readable as schema version 1; new records use schema version 2.

Confirmed transfers show the private recorded actual-arrival time to the authorized sender,
recipient, and System Admin. If the recipient omitted it, the UI says **Not recorded**. Actual
arrival is not included in public product traceability.

The Admin **Receipt discrepancies** screen reads real discrepancy events and current contract
records. An authorized System Admin can prepare `resolveDiscrepancy` to accept the reported actual
quantity or cancel the transfer. Acceptance returns the transfer to `AwaitingReceipt`; the intended
recipient must then confirm separately. Cancellation releases the sender reservation according to
the contract. All APIs return unsigned transactions only; the backend never signs or broadcasts.

The deployed contract's direct `reject` method stores a reason hash but has no CID parameter.
TraceChain therefore keeps encrypted rejection evidence in its authorized off-chain receipt
repository and places only the deterministic reason hash on-chain. Public product traceability
shows safe receipt/discrepancy lifecycle wording and never returns private notes, files, hashes, or
encrypted CIDs.

## Product traceability QR

Each real product batch can expose a separate permanent Product Traceability QR:

```text
https://tracechain.example/trace/product?v=1&chainId={chainId}&registry={productRegistryAddress}&batchId={batchId}
```

The QR is a read-only locator containing only its version, configured chain, ProductRegistry
deployment, and real `bytes32` product batch ID. Manufacturers can display it after product
creation, download a PNG, print a name-first label containing the readable product name and batch
reference, or copy the link. The readable values are display data resolved outside the QR payload.
It is distinct from the custody-transfer QR and can never confirm receipt or change custody.

The public `/trace/product` page and `POST /api/product-traceability/resolve` reject malformed,
duplicate, missing, unknown, wrong-chain, and wrong-registry parameters before resolving configured
contract records. Public visitors receive a privacy-minimized product, ingredient-verification,
company-name, current-custodian, and chronological custody summary. An authorized session may also
receive technical IDs, wallets, quantities, and transaction hashes in collapsed Technical details;
complete credentials, private claims, CIDs, encrypted content, keys, and documents are never
returned. A verified blockchain traceability record does not by itself prove the physical item is
genuine.

Set `VITE_PUBLIC_APP_URL` to the externally reachable HTTPS application origin when generating
production labels. A normal phone camera can open that HTTPS link. Another phone cannot open a
developer machine's `localhost`. A complete phone test needs an externally reachable HTTPS
frontend and API, reachable RPC, configured deployed contracts, an onboarded recipient wallet, and
a real `AwaitingReceipt` transfer; Sepolia is recommended for the final demonstration. Keep the
session cookie HttpOnly, Secure in production, and SameSite=Lax for a same-site frontend/API.
For local browser testing, set `VITE_PUBLIC_APP_URL=http://localhost:5173` in the root `.env` and
restart Vite after editing it. A missing or invalid QR configuration displays an error in the QR
section while the Manufacturer's on-chain product details remain available.

## Ingredient selective disclosure

New Ingredient Credentials use RFC 9901 SD-JWT through `@sd-jwt/core` 0.24.3 when the Supplier has a wallet-bound browser messaging identity. The issuer signs the credential while its `cnf.jwk` binds presentations to the participant-controlled Ed25519 key. Manufacturers select Required and Optional claims; Suppliers preview the values and explicitly approve optional disclosures before their browser creates the audience- and challenge-bound presentation. The private key never enters the API. Legacy JWT Ingredient Credentials remain supported as clearly labelled full disclosure.

OpenID4VP remains deferred. Key loss currently requires the original encrypted recovery kit; automated key rotation and replacement issuance are remaining work. See [the selective-disclosure design and limitations](docs/INGREDIENT_SELECTIVE_DISCLOSURE.md).

## Validation

From the repository root:

```bash
npm run build
npm run typecheck
npm run test:auth
npm run test:blockchain
npm run test:ssi
npm run test:ssi-api
npm run test:ingredient-batches
npm run test:production-flow
npm run test:stakeholder-directory
npm run test:contracts
npm run test:custody-transfers
npm run test:product-traceability
npm run test:ingredient-batches
npm run test:qr
npm run test:content --workspace @tracechain/api
npm run test:frontend
npm run test:workspace-access
npm run format:check
npm audit --omit=dev
```

The authentication suite contains 18 tests, the SSI package contains 22 offline tests, the SSI presentation API contains 12 tests, the custody-transfer API contains 37 tests, and the product-traceability API contains 11 tests. The stakeholder-directory suite covers verified resolution, revoked exclusion, legacy fallback, and duplicate-name disambiguation. The frontend suite contains 98 tests and includes wallet-adapter, authentication-hook, credential, workspace-access, identity presentation, both QR workflows, reconciliation validation, corrected MetaMask-cancellation retries, Admin discrepancy decisions, public traceability states, receipt transaction errors, and confirmed-transaction refresh recovery. Product-traceability and custody-transfer API tests inject blockchain and encrypted-content gateways and do not require Hardhat, Pinata, or an RPC endpoint. Frontend tests use fixed chain-31337 public test values from Vite test mode and do not require a private root `.env`; non-test builds retain normal environment validation. Neither suite contacts a relay or RPC endpoint. SSI tests use temporary files and a controlled local did:ethr resolver; they do not call Sepolia, spend test ETH, or depend on MetaMask.

The root `test:auth`, `test:ssi-api`, and `test:custody-transfers` commands build their required shared and SSI workspace dependencies first, so they can run directly after a clean `npm ci`.

See [project context](docs/PROJECT_CONTEXT.md), [decisions](docs/DECISIONS.md), and [progress](docs/PROGRESS.md) for the project source of truth.
