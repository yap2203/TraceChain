# Smart Contracts

## Product orders through a Distributor

CustodyTransfer automatically creates ProductDelivery. Its immutable child coordinates Retailer
orders approved by the original Manufacturer, choosing accepted direct pickup or sufficient received
custody stock. It uses the existing Orders context, product ownership/lifecycle, company role/permission
checks, location ownership and credential-bound carrier proof attestations. ProductDelivery exposes
`select`, `respond`, `dispatch`, `close`, `get` and the existing-shaped proof `act` adapter.

Only that child can reserve/release/dispatch product-delivery balances. Direct pickup keeps stock
ownership on Manufacturer's ledger until final Retailer receipt while recording Distributor as the
authorized physical carrier and confirmer; it creates no Distributor warehouse balance. The normal
generic Manufacturer → Retailer transfer API remains forbidden. Custody selection reserves the full
quantity at one received location. Final dispatch reuses that reservation; receipt settles once.
CustodyTransfer alone completes/cancels the coordinator after receipt/Admin reconciliation.

Carrier assignment is within 48 hours of approval, capped by request expiry; acceptance and dispatch
remain within order expiry. Expired reservations require explicit participant cleanup, not a timer.
Automatic-restock cancellation/rejection is disabled after these deliveries dispatch; existing
receipt/discrepancy reconciliation remains available. Ingredient coordination and near-limit Orders
bytecode are preserved. Both delivery children are automatic: keep the seven top-level environment
addresses consistent, without adding a manually configured ProductDelivery address.

An updated complete suite is required. The current local dataset has newer ingredient history than
the restricted replay helper supports; this stage has not changed it. See the [manual product flow](../testing/PRODUCT_DISTRIBUTOR_RETAILER_FLOW.md).

## Two-mode ingredient fulfilment

`IngredientDelivery.fulfilmentPolicy() = 2` adds `arrangeFromCustody(orderId, positionId,
receivingLocation)`. Only the original Supplier of an approved, active direct ingredient request
in selection stage 1 can use it. The child checks exact Supplier/batch, current authorization,
received/unreserved quantity covering the full order and a location owned by the Manufacturer.
It reserves atomically in `custodyOrders`/`positionOrders`, assigns the actual custodian, records
Supplier arrangement and enables existing warehouse dispatch/receipt. Direct carrier actions cannot
then assign/pick up that order, and legacy approved receipt cannot bypass custody accounting.

Direct Supplier → Distributor → Manufacturer orders continue through existing carrier
accept/decline, scanned pickup and confirmed receipt. No warehouse stock is credited in that mode.
New ordinary requests leave selection to Supplier after approval; explicit earlier custody orders
keep reservation-at-placement behavior. Selection remains subject to the original deadline.

This requires a fresh complete-suite deployment because the immutable delivery child is created
inside Orders. With the Phase 2 encrypted-content references, current compiled runtime sizes are
Orders 24,192 and delivery 23,685 bytes; Orders creation bytecode plus five constructor addresses is
49,114 bytes. Preserve the deployment size tests when extending this suite: only 38 bytes of initcode
margin remain. No network was redeployed as part of this change. See
[setup and tests](../testing/TWO_MODE_INGREDIENT_DELIVERY.md).

## Custody review and Supplier arrangement

The new child reports `reviewPolicy() = 1`. `decideWarehouseShipment` lets only the intended authorized
Distributor accept/reject an unreceived Supplier offer. Requested Supplier company proof must be current
before acceptance/receipt. Acceptance alone adds no inventory; rejection credits none. The original
Supplier uses `confirmRejectedReturn` for an explicit physical return before its availability is restored.
`arrangeDelivery` requires the original Supplier and an approved, active Manufacturer custody order;
`dispatchCustodyOrder` requires that arrangement and a departure time at/after it. Distributor cannot
arrange an ingredient order. All writes retain actor, quantity, source lifecycle and replay guards.
These additions require a fresh full suite; the existing deployed contracts are not upgraded in place.

The earlier **warehouse-first** flow remains supported. `IngredientDelivery` adds registered
warehouses, received custody positions, immediate order reservations and two road-shipment legs.
`SupplyChainOrders` keeps Supplier seller approval and credits Manufacturer stock through a child-only
settlement callback. `CustodyTransfer` adds product road metadata and stock by registered location.
Both actual and block times are recorded. New orders cannot use legacy direct receipt/pickup to bypass
custody. This requires a fresh full-suite deployment; old journals/records are preserved.
See [manual and automated warehouse tests](../testing/WAREHOUSE_CUSTODY_FLOW.md).
The older 48-hour per-order assignment design below remains for compatibility only.

Ingredient Distributor delivery now adds an `IngredientDelivery` child created by `SupplyChainOrders`.
The API discovers it through `ingredientDelivery()`; no additional environment address or Ignition
future is required. New ingredient requests are delivery-required, Supplier approval starts the
user-selected 48-hour assignment window (capped by request expiry), carrier pickup sets stock aside,
and Manufacturer partial/full receipt credits it once. Effective deadline cancellation is computed in
reads/action guards; `act(7, ...)` optionally records expiry. Only Orders may initialize delivery,
consume reserved stock or close expiry, while participant actions require the exact signing actor and
current role/permission. Legacy evidence-source validation is delegated to the child without changing
its acceptance rules. Full-suite redeployment is required; existing deployed contracts are unchanged.

The parent uses an optimizer-runs override of 1 to remain under Ethereum's 24,576-byte runtime limit;
other roots retain their existing configuration. Tests assert real deployed size for parent and child,
and run with the normal size limit enabled. See [the delivery test guide](../testing/INGREDIENT_DISTRIBUTOR_DELIVERY.md).

`packages/contracts` contains seven top-level TraceChain registry/ledger contracts plus the automatically created ingredient-delivery module, using Solidity 0.8.34, Hardhat 3, ethers, Mocha, Hardhat Ignition, and Foundry-compatible Solidity tests. The contracts implement stakeholder authorization, credential lifecycle, ingredient evidence, ingredient/product traceability, inventory, and custody transfers.

## Phase 2 encrypted-content discovery

The current suite emits or stores immutable encrypted content references for company branding,
ingredient/product media, location details, order and dispatch details, identity presentations,
corrections and custody rejection reasons. Existing credential, batch, evidence, transfer and receipt
records retain their established CID/hash references. Contracts store no plaintext private content;
the authorized API follows the reference, decrypts off-chain and validates the saved hash and binding.
These ABI changes require full-suite redeployment. Older records without a CID are preserved but cannot
be made cross-device through a server-local index.

## Current package

```text
packages/contracts/
  contracts/access/              Stakeholder registry and permissions
  contracts/credentials/         Credential registry and lifecycle
  contracts/traceability/        Evidence, ingredient, product, and custody contracts
  contracts/interfaces/          Cross-contract read interfaces
  test/TraceChain.ts              End-to-end contract integration tests
  ignition/modules/TraceChain.ts Complete deployment and wiring
  hardhat.config.ts               Solidity 0.8.34 and network configuration
```

Run commands from `packages/contracts`:

```bash
npx hardhat compile
npx hardhat test
npx hardhat test solidity
npx hardhat test mocha
```

The local simulated networks require no wallet key. Sepolia configuration reads `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY` through Hardhat configuration variables. Store secrets with the Hardhat keystore or an ignored local environment mechanism; never commit them.

## Current security behavior

- Company Role Credentials issued before an administrator transfer remain valid when their current status, expiry, subject, type, stakeholder lifecycle, and hash link remain valid. The former administrator is revoked and cannot issue new credentials.
- Evidence acceptance requires the exact credential registered for the requested ingredient batch, the expected Supplier, Ingredient type, valid lifecycle, unexpired presentation, and an unconsumed request challenge.
- Retailer evidence acceptance records request completion but never sets the Manufacturer-only evidence-acceptance flag. Receipt-backed product creation no longer requires that flag: Ingredient evidence is optional, while valid source/credential status and Manufacturer received stock remain mandatory. `ProductRegistry.receivedProductionPolicy() = 1` identifies this policy; an older deployed suite must be replaced to use it. Legacy integrations without a receipt ledger retain their previous evidence gate.
- Ingredient Credentials still require an authorized Supplier issuer.
- Complete credentials and private evidence remain off-chain; contracts store only identifiers, hashes, CIDs, statuses, timestamps, quantities, and relationships.

The CredentialRegistry administrator-transfer correction changes bytecode. Existing local deployments must be redeployed before testing this behavior; this task does not deploy to local networks or Sepolia. See [`packages/contracts/README.md`](../../packages/contracts/README.md) for the full deployment and verification guide.
