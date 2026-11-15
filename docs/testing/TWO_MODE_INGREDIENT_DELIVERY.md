# Supplier-selected ingredient delivery

This flow supersedes warehouse-only selection for **new** Manufacturer ingredient requests.
Existing warehouse orders and direct delivery records remain supported.

## Setup

Use the updated complete contract suite. `IngredientDelivery.fulfilmentPolicy()` must return `2`.
The delivery child is deployed by SupplyChainOrders; it is not independently deployed or switched.
Use a fresh Ignition deployment ID for changed bytecode, update the root environment's complete
contract address set together, and restart API/web. Reuse the documented local/Sepolia deployment
procedure in the root README for your selected network. This implementation does not deploy,
reset the chain, register wallets or alter environment values automatically.

Have separately authorized Manufacturer, Supplier and Distributor wallets. Register the
Manufacturer's receiving location. For custody delivery, the Distributor must also have a registered
warehouse with physically received stock belonging to the original Supplier and exact batch.
Balances and labels come from real records. Login, issuance and evidence consent remain separate.

## Common first steps

1. Supplier registers an ingredient. Manufacturer opens **Products → Supplier ingredients**.
2. Manufacturer opens the ingredient, chooses **Request quantity**, enters the quantity in its
   registered unit, deadline and receiving location, then submits through MetaMask.
3. The Manufacturer does not select a Distributor or warehouse. The request does not move stock,
   reserve custody stock, process payment or grant evidence access.
4. Supplier opens **My orders**, reviews the buyer/quantity and approves or rejects. Company
   evidence may still be requested separately through **Information requests**.
5. Rejection closes the request. Approval shows the two fulfilment options. Choose within the
   existing 48-hour assignment window, capped by order expiry.

## Mode 1 — Request direct Distributor delivery

1. On the approved order, Supplier selects an authorized Distributor and **Request Distributor**.
   The ingredients remain at the Supplier; this uses no warehouse custody position.
2. Distributor opens **Shipments → Ingredients** and reviews **Direct delivery — collect from
   Supplier**. It can accept or decline and separately request Supplier company evidence.
3. Declining returns the request to Supplier selection without restarting the original deadline.
   Supplier may choose another Distributor or sufficient custody stock while selection remains open.
4. After acceptance, Distributor scans the Supplier's ingredient-order QR using camera/image upload
   and explicitly confirms physical pickup. The contract debits Supplier availability once. An
   insufficient Supplier balance prevents pickup; approval/assignment alone does not reserve it.
5. Manufacturer opens the order, scans its label on physical arrival, selects/confirms its receiving
   location and quantity, then confirms receipt. Only those receipts credit usable production stock.
6. Supplier/Manufacturer tracking follows Supplier → Distributor → Manufacturer. The existing
   direct flow uses the order-bound QR and pickup/receipt records, rather than pretending it creates
   warehouse intake stock or a warehouse RoadShipment. Optional Supplier proof must remain current
   where required by the existing handoff flow.

## Mode 2 — Deliver from existing Distributor custody

1. Supplier has already dispatched stock to Distributor custody. Distributor separately accepts
   custody and scans/confirms physical receipt. A pending or merely accepted intake is insufficient.
2. On the approved Manufacturer order, Supplier chooses **Custody stock for this order**. Only
   its own exact batch, with enough received, unreserved stock for the **full** requested quantity,
   appears as eligible. This stage does not split one order across warehouses or mix fulfilment modes.
3. Supplier explicitly selects **Confirm delivery from custody** and signs. The contract rechecks
   owner, source, participant authorization, deadline, buyer location and live available quantity,
   then reserves that quantity atomically and creates the Supplier-arranged dispatch job.
4. Distributor opens **Shipments → Ingredients → Supplier-arranged ingredient deliveries**, records
   vehicle, warehouse departure, ETA and the bound route, then dispatches. This is not another
   custody-intake offer: the Distributor already accepted and physically holds that stock.
5. Manufacturer scans the shipment QR on arrival and confirms physical receipt. Warehouse stock
   decreases at dispatch; usable Manufacturer stock increases at receipt. Supplier availability is
   not deducted again because it was debited when the stock originally left Supplier custody.

Supplier selection locks the mode. It cannot change to custody after assigning an active direct
carrier, assign a direct carrier after custody reservation, or reserve the same order twice.
Explicit old custody-position orders retain their existing reservation-at-placement semantics.
New normal requests reserve custody only when Supplier chooses mode 2.

## Checks to perform

- With no custody stock, confirm direct delivery remains usable and the custody confirmation is
  disabled. Verify a rejected direct delivery returns to Supplier selection.
- Put 20 units in received Distributor custody and request 10. After Supplier approval, choose
  custody: available becomes 10 and reserved becomes 10. Supplier origin availability is unchanged.
- Request 21 against those 20 units. That warehouse must not be selectable. If another order
  reserves stock after the page loads, submitting the stale selection must fail on-chain.
- Repeat with another Supplier's stock, another ingredient batch, another company's receiving
  location, an unauthorized wallet, an expired order and a second submission: all must fail.
- After direct carrier assignment, attempt custody selection: reject it. Decline the direct request
  first; selection may reopen only before the original deadline.
- Attempt Manufacturer receipt before direct pickup or before a custody dispatch: reject it.
  Confirm normal receipt and partial receipts credit only their recorded amounts, exactly once.
- Try a foreign company's QR/account and verify no management action or private notes are exposed.
- Ingredient evidence remains optional for product creation from legitimately received stock.

Automated API, frontend and isolated contract tests cover these state transitions and the existing
direct accept/decline, scanned pickup, receipt and warehouse accounting paths. Real MetaMask/camera
testing still requires your updated deployment and the appropriate participant accounts.
