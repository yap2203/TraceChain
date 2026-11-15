# Warehouse-first ingredient custody and shipments

For new requests, follow [Supplier-selected two-mode delivery](TWO_MODE_INGREDIENT_DELIVERY.md).
Manufacturer no longer has to select a warehouse. Supplier chooses direct delivery or sufficient
custody after approval. The explicit warehouse-order instructions below remain useful for older
records and custody intake/dispatch; they no longer define the only normal ordering path.

## Inventory isolation and Information requests

- Supplier and Distributor now open **Custody inventory** from navigation. It is not a tab inside
  Sent shipments/Custody & deliveries. Open **View custody details** for stock, reservations, location
  balances, original batch and related shipments. Suppliers see their own supplied batches; a
  Distributor sees only its own custody stock. Product reserved/in-transit amounts are reported
  separately from currently available physical warehouse stock.
- To test isolation, authorize a second Distributor using the normal onboarding process. Sign in as
  Distributor A, note an owned custody detail URL, then sign out and sign in as Distributor B. B must
  see only its own stock; A's detail URL must report unavailable. In DevTools, B's `/api/orders`
  response must not contain A's private positions or other-Distributor catalogue positions. Merely
  editing frontend state or query parameters must not change the authenticated API owner.
- Sign in as the original Supplier and check that its own stock at different custodians is visible,
  while another Supplier's batches are absent. Manufacturer ordering still uses minimal public
  availability; full warehouse quantity/reservation totals are not provided to the Manufacturer.
- Every stakeholder now has **Information requests**. Its Company credential requests category
  separates Received and Sent requests with purpose, linked context, deadline and status. The
  Ingredient evidence category preserves the existing role-specific ingredient request workflow.
- On an incoming custody shipment, the Distributor follows **Manage Supplier credential request in
  Information requests**, then explicitly requests Supplier proof there. Supplier opens its Received
  requests, previews the actual presentation and signs using its existing holder key. Distributor opens
  Sent requests, verifies and attests separately. Return to the shipment for acceptance/receipt; no
  proof action automatically accepts custody, approves an order or credits stock.
- Check Manufacturer/Retailer company requests linked to ingredient/quantity requests in the same
  inbox. Incorrect/foreign direct references must show unavailable. Admin has the navigation page but
  does not gain new cross-company proof powers. Old Supplier/Retailer evidence-request URLs redirect
  to the new Information requests route.
- This is application/API access control. Public blockchain stock/events remain readable directly
  from the chain. No additional contract deployment or environment change is needed for these pages;
  restart/rebuild API and web to load the updated routes and filters.

## Updated role-specific flow (2026-11-15)

This section supersedes the older direct-receipt/Distributor-arrangement instructions below.
Deploy a fresh full suite with `IngredientDelivery.reviewPolicy() = 1`; no running deployment is
modified automatically. Use a fresh deployment ID rather than reconciling changed bytecode into an
old completed journal. The API discovers the new child through Orders; no new `.env` key is needed.

1. Supplier → **Send to custody**: select owned stock and its Distributor. This creates a custody
   offer/first-leg shipment, not a Manufacturer delivery job.
2. Distributor → **Custody & deliveries**: open the incoming Supplier shipment. Optionally request
   Supplier Company Role VP. Supplier opens the same shipment under **Sent shipments**, previews and
   signs the requested company presentation. Distributor separately verifies/attests it. Proof uses
   the incoming shipment ID, exact Supplier and intended Distributor, not an invented Manufacturer
   order. Signature, wallet, role, challenge and current credential checks reuse existing services.
3. Distributor selects **Accept custody delivery** or **Reject custody delivery**. Requested Supplier
   proof must be current before acceptance. Accept does not credit inventory. Reject blocks receipts
   and never credits Distributor inventory; original Supplier stock stays unavailable while returning.
4. After acceptance, Distributor scans the physical package using **Scan package QR** or **Upload QR
   image**. No pasted link or manual reference field is offered. Receipt details appear only after a
   valid scan; review quantity/time, explicitly confirm physical arrival and sign MetaMask. Only then
   does custody become usable/orderable. Opening an external camera-scanned label may use the normal
   authenticated receipt landing page; it never automatically signs or confirms receipt.
5. If rejected, Supplier opens its rejected outbound shipment, scans the returned package and confirms
   full physical return with MetaMask. Supplier availability is restored exactly once. Rejection does
   not prove physical return. Partial return/rejection after acceptance needs a later reconciliation flow.
6. Manufacturer requests available custody stock and selects its receiving location. Placement reserves
   quantity immediately. Supplier reviews its Manufacturer order and approves it, then explicitly selects
   **Arrange ingredient delivery**. Approval and arrangement are distinct signed transactions.
7. Only Supplier-arranged approved orders appear in the Distributor dispatch queue. Distributor opens
   **Record physical dispatch**; the original batch, Manufacturer, warehouse and receiving location are
   fixed by the order. It records actual quantity, vehicle, departure and ETA, then signs. The Distributor
   cannot select arbitrary ingredient stock or create an ingredient delivery independently.
8. Manufacturer opens the resulting second-leg shipment and scans/uploads its package QR, then confirms
   physical receipt. Product creation uses only this received stock; ingredient evidence remains optional.

Negative checks: before acceptance receipt fails; proof pending/expired blocks acceptance or receipt;
wrong-company proof/reference fails; replayed decision/return/receipt fails; rejection creates no stock;
Distributor cannot arrange orders; Supplier cannot arrange unapproved, expired or unrelated orders;
Distributor dispatch before Supplier arrangement fails, including a backdated departure before arrangement.
Supplier and Distributor navigation/actions must differ. Camera/image upload must remain available,
manual QR controls absent, and invalid/wrong-package images must not unlock confirmation.

The UI limits QR entry methods; a QR is a public locator, and neither the API nor the contract can
cryptographically prove that a caller used a camera or that goods physically arrived. Recipient
authorization, current proof, lifecycle, batch/party/quantity binding and replay checks remain enforced.

This is the current normal flow. The older per-order 48-hour Distributor assignment flow is retained
for compatibility tests/history; new warehouse orders do not use that assignment deadline.
Supplier remains the seller and ingredient issuer. Distributor is the physical custodian.
MetaMask + SIWE login, company credential issuance and optional ingredient evidence are unchanged.

## Deployment prerequisite

This change needs new `SupplyChainOrders`, its automatically created `IngredientDelivery` child,
and `CustodyTransfer` bytecode. The registries use one-time wiring: deploy a fresh complete suite,
preserve previous deployment journals/credentials and configure all matching root `.env` addresses.
No deployment, chain reset or environment replacement is performed by this implementation.

With your local node already running, from `packages/contracts`:

```powershell
npx hardhat ignition deploy ignition/modules/TraceChain.ts --network localhost --deployment-id tracechain-warehouse-local
```

Use a new deployment ID if that ID already has an older deployment. Register/authorize your test
companies against the new suite. Restart API/web after configuration changes. The API discovers the
child through `SupplyChainOrders.ingredientDelivery()`; no extra environment address is needed.
`IngredientDelivery.custodyPolicy()` and `CustodyTransfer.transportPolicy()` return `1`.
Do not point the new artifact-backed gateway at old deployed bytecode and expect new getters to work.

Set `VITE_PUBLIC_APP_URL` in the root environment to the actual web origin, with matching chain ID and
Orders address. A phone cannot use your computer's `localhost`; phone scanning needs a reachable web
origin, camera permission/HTTPS where required, and a MetaMask RPC accessible from that device.

## Test the main flow

Use separate browser profiles/company wallets, or sign out and change MetaMask account between steps.
Use a valid active ingredient batch whose Ingredient Credential will not expire during the test.

1. **Locations:** Supplier → Transfers → Locations: register a dispatch location. Distributor →
   Shipments → Locations: register/publish **Warehouse A**. A new warehouse requires two explicit
   transactions (location, then warehouse name); if interrupted, select the existing location to
   finish. Manufacturer registers **Factory B**, either in Shipments → Locations or when ordering.
2. **Supplier stock placement:** create an ingredient with **100 kg**. Its registered unit can also
   be litre, g, each or another accepted registration unit; no implicit conversion occurs. Ingredient
   batches → View details → Send stock to a Distributor warehouse (or Transfers). Select the batch,
   Supplier departure location and an authorized Distributor; enter **70 kg**, actual dispatch time
   and ETA. Review the route, explicitly confirm physical dispatch and sign in MetaMask. Supplier
   custody dispatch does not require a vehicle; the Distributor may record one at receipt.
3. Supplier available stock is now **30 kg**, and the first shipment is **Dispatched**. Distributor
   custody available is still **0**; goods in transit cannot be ordered. Print/attach its shipment QR.
4. **Distributor receipt:** Shipments → Ingredients → open the incoming shipment. Scan its package
   QR, upload its image or paste the exact label link and select Check label. Enter **70 kg** and
   actual receipt time; explicitly confirm physical receipt and sign. Custody inventory now shows
   **70 kg physical / 0 reserved / 70 available**. Partial receipts credit only the quantity received.
5. **Manufacturer order:** Products → Supplier ingredients → open that batch → Request quantity.
   Choose Warehouse A, Factory B, **20 kg** and a future response deadline. Submit/sign the request.
   The Supplier remains the order recipient/seller. Warehouse values become **70 / 20 / 50** at
   placement, before Supplier approval. There is no payment or separate catalogue publishing step.
6. **Supplier decision:** Order requests → open request → Approve. Optional buyer company evidence
   can still be requested/reviewed separately. Approval alone does not dispatch or credit stock.
7. **Distributor onward dispatch:** Shipments → Ingredients → Approved orders ready to dispatch →
   Arrange dispatch. The warehouse and Factory B are bound to the order. Enter **20 kg**, vehicle,
   actual departure and ETA; explicitly confirm dispatch and sign. A second shipment/QR is created.
   Warehouse values become **50 / 0 / 50**. Supplier remains **30 kg**; Manufacturer usable remains 0.
   Distributor can separately request Supplier company proof in this approved order's evidence panel;
   if requested, a current verification attestation is required before dispatch. This is not automatic
   evidence acceptance or a replacement for the Supplier's approval.
8. **Manufacturer receipt:** My orders → request → View shipments & receipt, or Shipments →
   Ingredients. Open the **Distributor → Manufacturer** shipment; scan its own QR and explicitly
   confirm **20 kg** at Factory B. Manufacturer now has **20 kg usable**; Supplier stays **30 kg** and
   Distributor stays **50 kg**. Receive 5 then 15 to test partial receipts instead. Duplicate or
   excessive receipts must fail.
9. **Production:** Products → Create product batch. Choose Factory B and received ingredients/units.
   Creating a product using 12 kg leaves **8 kg** Manufacturer usable stock. Multiple ingredients
   are supported. Ingredient evidence remains optional for this production flow.
10. **Finished products:** Manufacturer → Transfers: select product stock at its registered production
    location and a Distributor receiving location. Enter quantity, vehicle and times; sign dispatch.
    Distributor → Shipments → Products: scan/receive. Custody inventory shows the real warehouse
    balance. Open the received shipment → Arrange onward transfer → Products → choose a Retailer and
    registered receiving location. Retailer can open the printed `/receive/shipment` link and sign in
    to confirm receipt. Product and ingredient shipment lists remain separate types in one workspace.

## Reservation and negative checks

- With 70 kg received, order 60 kg then try another 11 kg: the second request must fail atomically.
  A separate Manufacturer tab reading stale stock must also fail at transaction submission.
- Reject the 60 kg request: all undispatched quantity becomes available again. Expire an order:
  undispatched reservation releases without a timer transaction; it is excluded from contract reads.
  Expiry prevents further dispatch, but goods already dispatched can still be physically received.
- Partially dispatch an order: physical warehouse stock decreases by dispatched quantity, and only
  the undispatched remainder remains reserved. Partial receipt credits only confirmed quantities.
- Wrong wallet, wrong registered location, mismatched unit, excessive quantity, unapproved order,
  revoked/unauthorized participant, blank/invalid vehicle, future actual time, ETA before departure,
  departure before approval and repeat receipt must fail. Old direct receipt/pickup actions cannot
  credit a new custody order.
- Substitute shipment ID, ingredient/product kind, chain, Orders address or origin in a QR; add duplicate
  or unknown parameters: validation fails. A QR is a locator, not proof that goods physically arrived.
- Product cancellation/rejection restores both global and departure-location stock. After receipt,
  onward road dispatch is limited to the balance at the selected Distributor location.
- A Distributor sees necessary participant/order/shipment data, not confidential buyer/seller notes.
  Unrelated companies cannot obtain other companies' shipment detail through the Orders API.

## Records and routes

`IngredientDelivery` stores original batch ID, order/shipment references, canonical integer quantity
and unit, route IDs, road vehicle, participant-reported dispatch/receipt times, ETA, block recording
times, transaction sender, received quantities and leg/state. `RoadShipmentReceived` provides receipt
history. Warehouse receipt adds custody; Distributor dispatch removes custody; Manufacturer receipt
credits existing IngredientRegistry production inventory. Product transport uses CustodyTransfer's
location ledger and `RoadTransportRecorded`, preserving original production location separately.

- `/supplier/transfers`, `/supplier/shipments`
- `/manufacturer/transfers`, `/manufacturer/shipments`
- `/distributor/shipments`, `/distributor/inventory`, `/distributor/transfers`
- `/receive/shipment`: authenticated QR receipt landing page
- Old Distributor `/orders`, `/ingredient-deliveries` and `/incoming-shipments` URLs redirect to
  `/distributor/shipments` and preserve query parameters.
- `POST /api/orders/logistics/prepare`: warehouse publication, stock/order/product road dispatch and
  exact-label receipt. Returns an unsigned transaction after current SIWE authorization and pending
  chain simulation. MetaMask still requires explicit approval for every write.
- `GET /api/orders`: actual positions, reservations, warehouses, participant-scoped shipments,
  product stock per location and company names. No fixtures or private keys are supplied.

## Current limits

Ingredient shortage/damage, carrier rejection/return and warehouse-to-warehouse relocation do not yet
have a dedicated reconciliation UI. Do not confirm missing/damaged goods as usable; record only actual
ingredient receipts. Product's existing reconciliation workflow remains separate; the new quick
receipt screen confirms the full expected product quantity. Legacy unlocated product balances are
not silently assigned to a warehouse. No payment, automatic signing, GPS validation or independent
physical-delivery attestation is introduced. Registered/public warehouse names and blockchain routing
metadata are visible; sensitive credential documents remain off-chain.

## Automated validation

From repository root:

```powershell
npm run typecheck
npm run build
npm run test --workspace @tracechain/web -- --maxWorkers=4
npm run test --workspace @tracechain/shared
```

From `apps/api`: `npx vitest run --maxWorkers=4`.
From `packages/contracts`: `npx hardhat test` (isolated test network, not your running deployment).
From `packages/ssi`: `npx vitest run`.

Contract regressions cover warehouse receipt, immediate reservation, overselling, release, partial
receipts, actor/location/time checks, single Supplier debit, direct-receipt bypass prevention and
product location stock restoration. API tests cover current authorization, cross-company visibility,
input/QR checks, reservation preparation and RPC vs state errors. Web tests cover warehouse/order
selection, availability bounds, explicit signing consent and invalid-label blocking.
