# Ingredient delivery: Supplier → Distributor → Manufacturer

This is the **legacy per-order carrier assignment** flow. New normal orders use
[warehouse-first custody and Shipments](WAREHOUSE_CUSTODY_FLOW.md), with reservation at placement.
The 48-hour assignment deadline below does not apply to new warehouse custody orders.

This flow transports registered ingredients. It does not add payments, transfer ingredient ownership
to a Distributor for production, or change finished-product delivery to Retailers.

## Deploy before testing

The running contracts are not upgraded automatically. Deploy the updated complete suite with a fresh
deployment ID, preserve old journals, and copy the fresh registry addresses into the root `.env`.
`SupplyChainOrders` creates its own `IngredientDelivery` child contract; the API resolves its address
from `SupplyChainOrders.ingredientDelivery()`. There is no additional address/environment variable
to maintain. The existing Ignition module and constructor arguments are unchanged.

From `packages/contracts`, with your local node already running:

```sh
npx hardhat ignition deploy ignition/modules/TraceChain.ts --network localhost --deployment-id tracechain-ingredient-delivery-local
```

Restart API and web after updating configuration. Use `VITE_PUBLIC_APP_URL=http://localhost:5173`
for desktop testing. A printed localhost QR cannot be opened by another phone: phone testing requires
a reachable HTTPS application URL and a MetaMask network/RPC reachable by that phone. QR origin,
chain and Orders address must match the configured deployment exactly.
For phone access, also align `FRONTEND_URL` and the SIWE domain/URI with the reachable application
origin; do not disable the existing CORS or SIWE origin checks.

Register authorized Supplier, Manufacturer and Distributor companies against this deployment. Normal
MetaMask + SIWE login remains unchanged. Distributor delivery actions require RECEIVE_TRANSFER;
Supplier assignment requires REGISTER_INGREDIENT. The normal presentation signing key in Profile is
needed only if a Supplier explicitly presents a company proof, not for QR scanning or login.

## Manual test flow

1. **Supplier:** register an ingredient batch with 100 g. Ingredient evidence remains optional for
   production once the Manufacturer has physically received stock.
2. **Manufacturer:** Products → Supplier ingredients → open that ingredient → request 20 g. Choose a
   request expiry more than 48 hours in the future to test the full assignment window.
3. **Supplier:** Order requests → Review request → Approve → Confirm approval in MetaMask. The detail
   dialog now shows an Ingredient Delivery QR and a print/attach instruction. Print the label or
   download its PNG, then attach it to the matching package. The label contains only an order locator.
4. **Supplier:** choose an active Distributor and select Request Distributor. The deadline is exactly
   48 hours after on-chain approval, capped by the original request expiry. Requests/approval alone
   do not reduce actual stock. Remaining after open requests shows 80 g.
5. **Distributor:** Ingredient deliveries → open the request. Review Supplier, Manufacturer,
   ingredient and quantity; optionally select Request Supplier Company Role VP. The Distributor may
   request proof before accepting the job. This uses a separate challenge-bound encrypted thread.
6. **Supplier:** open the same order and its Supplier company evidence section. Preview the actual
   requested claims, choose optional fields and explicitly approve/sign the presentation. The
   authority-derived selective proof references the existing VC; it does not modify that signed VC.
   Legacy full-credential presentation is labelled full disclosure. The Distributor separately
   verifies the proof and confirms the verification attestation in MetaMask. A requested proof must
   be current and attested before pickup; a proof alone does not record acceptance or pickup.
7. **Distributor:** Accept delivery, then physically collect the goods. Scan the attached label with
   the camera, upload its image, or paste its exact QR link and select Check label. Enter actual pickup
   time and confirm the physical pickup declaration, then confirm in MetaMask. Supplier available
   stock becomes 80 g; the Manufacturer still has zero received stock. Tracking shows In transit.
8. **Manufacturer:** My orders → open the request. Scan the same attached label, select/register an
   owned receiving/production location, enter the actual received quantity/time and confirm the
   physical receipt declaration in MetaMask. Receiving 5 g credits exactly 5 g. The remaining 15 g is
   still in transit; receiving it later closes delivery. Supplier stock stays 80 g, avoiding a second
   deduction. Only confirmed received quantities are usable under Create product batch.
9. Refresh either company's order, or wait for its 15-second tracking refresh. All participants see
   the same Supplier → Distributor → Manufacturer status, with actual pickup/receipt times. A phone
   camera opens `/receive/ingredient`; the intended company still signs in before private data or
   receipt controls appear. Opening a QR never automatically submits a transaction.

## Negative and deadline checks

- Change the QR order ID, registry, network or origin, append unknown/duplicate parameters, or scan
  another package: label validation must fail. QR-supplied addresses are never used as transaction
  targets. The API checks the locator again before preparing pickup or receipt.
- Sign in as another Distributor/company: the delivery is absent or access is denied. A caller
  cannot supply another wallet as an actor to the delivery contract.
- Try receipt before Distributor acceptance/pickup, repeat pickup, reuse a receipt ID, receive above
  the outstanding amount or select another company's location: no extra stock is credited.
- Change a presentation's recipient or use another holder key: verification fails. A second answer
  to the same challenge is rejected. A suspended/revoked company or stale credential cannot pass
  current authorization checks. Expired proofs can be requested again with a fresh challenge.
- Reject a wallet prompt while creating the proof request: Complete company evidence request
  resumes the same stored challenge instead of silently replacing it. A Distributor can decline or
  withdraw before pickup; the Supplier's original assignment deadline is never restarted.
- If no Distributor is requested by the assignment deadline, the effective status becomes Cancelled
  and assignment/pickup/receipt are blocked. No stock changes occur. Contracts do not execute
  transactions on a timer: the view computes cancellation immediately from the deadline. The
  optional `delivery-expire` preparation/action materializes a cancellation event and closed order
  when submitted. The UI needs no extra cancellation click. Offers made on time may be accepted
  after the 48-hour window, but must be picked up before the original request expires.

## Data, security and limits

Delivery stages, parties, timestamps, reserved quantities, proof challenge/hash attestation and receipt
totals are on-chain. Company proofs/credential records remain encrypted off-chain using the existing
storage; DIDComm encrypts/decrypts transport using backend-managed company-agent keys. The existing
participant-held presentation key still signs VPs. No new database, wallet, secret environment value
or required mobile application is introduced. Distributor transport access excludes private order
notes and Supplier decision reasons. Supplier and Manufacturer tracking never receives the other
company's decryption keys or raw credential automatically.

An on-chain proof attestation records the Distributor's decision; the contract does not itself execute
Veramo verification. The API performs signature, source credential hash, wallet/role, holder binding,
challenge/audience, expiry and current authorization checks before preparing that attestation.
The QR is a locator, not an authentication secret or proof of the physical contents. Camera scanning
cannot be enforced by Ethereum itself; the application requires the matching locator and each custody
actor must explicitly sign its own physical declaration.

One Distributor and one whole approved quantity are supported per delivery, with partial Manufacturer
receipts. Splitting a delivery across carriers, damaged/missing-goods reconciliation and return trips
are not part of this stage. Pickup allocates stock once; cancellation/withdrawal is blocked after
pickup, and a commercial request expiry does not discard stock already in transit. Expired/invalid
ingredient credentials still prevent usable receipt. Those cases need a separate exception workflow.
Legacy direct receipts and finished-product flows are preserved; new normal ingredient requests use
the delivery-required method, and approving an older pending ingredient request through the updated
UI starts the new delivery flow. Do not mix old UI builds with the new contract policy.

## Automated verification

```sh
npm run typecheck
npm run test:frontend
npm run test:orders --workspace @tracechain/api
npx vitest run src/modules/production-flow src/modules/didcomm # from apps/api
npm run test --workspace @tracechain/shared
npm run test:contracts
npm run build
```

Tests cover locator substitution, UI confirmation gates, current carrier access, stock debit/partial
receipt/replay, the 48-hour boundary, unchanged deadlines, actual authcrypt packing/unpacking,
and a real authority-signed Supplier VC with a browser-generated selective holder proof to the
Distributor. Both Orders and its child module must stay under the normal Ethereum contract-size
limit; only Orders uses the size-focused optimizer override. Live MetaMask and printed-label handling
still require the manual flow above.
