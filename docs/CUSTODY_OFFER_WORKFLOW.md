# Custody offer workflow: Supplier → Distributor

This page records how a custody offer works since 2026-11-27, and where each rule lives in the
code. Use it as the checklist when the Manufacturer → Retailer leg gets the same treatment.

## The rules

1. **The custody offer ends when the pickup is arranged.** Its stages are:
   - "Offer sent";
   - "Accepted · pickup arranged".

   The physical handoff, the label and the warehouse receipt are part of the **shipment**.
   They happen on the Shipments page, not on the custody offer page.

2. **Accepting includes the whole pickup arrangement.** To accept, the Distributor enters
   the pickup time, the pickup vehicle registration and the expected warehouse arrival
   (after the pickup). The `accept` action takes `pickupAt`, `vehicle` and `expectedAt`,
   stores them in the encrypted offer, and moves the offer straight to `SCHEDULED`. There is
   no separate "accept, then schedule" step. Until the handoff, the Distributor can change
   the arrangement with `schedule` ("Update pickup arrangement"), for example after a late
   pickup.
   - **The sender only confirms.** On the Shipments page, the Supplier sees the arranged
     vehicle and arrival, ticks the box and clicks "Confirm handoff with MetaMask". The
     server records the handoff time at that moment (`prepare` sets `occurredAt`).
   - If the arranged arrival has already passed, the handoff is blocked
     (`ARRIVAL_TIME_PASSED`) until the Distributor updates the arrangement.
   - The sender never enters the vehicle or arrival. Offers arranged before this change
     have neither stored: they show "Not arranged yet", and the handoff stays blocked
     (`PICKUP_DETAILS_REQUIRED`) until the Distributor adds both with "Update pickup
     arrangement".
3. **Company evidence is linked from the offer.** The custody offer page shows the
   company-evidence status. A link opens that request in Evidence Exchange; the old
   in-page modal is gone:
   - `information-requests/sent?context=custody&referenceId=<offerId>` for the Distributor;
   - `information-requests?context=custody&referenceId=<offerId>` for the sender.
4. **Pending evidence blocks the decision.** While requested evidence is not yet verified,
   accept and reject are both disabled. The API also refuses accept, schedule and handoff.
   A declined or failed request can never verify, so reject becomes available again.
5. **An expired, unverified request no longer blocks.** The page says "The company identity
   request has expired". The Distributor can then request again, or accept or reject
   without the evidence.
6. **Loading feedback.** Every action button shows a spinner while its own action runs:
   `Btn loading`. The spinner fades in after 150 ms, so actions that finish instantly don't
   flash it.

## Status → page mapping

| Offer status                                                            | Custody offer page                                                        | Shipments page                                                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REQUESTED`                                                             | Distributor: evidence gate, pickup time, Accept with pickup time / Reject | —                                                                                                                                                |
| `ACCEPTED` (legacy, accepted before this change)                        | Distributor: "Confirm pickup time" (`schedule` action)                    | —                                                                                                                                                |
| `SCHEDULED`                                                             | "Custody offer complete" + **Open shipment**                              | A "Waiting for pickup" row in the shipment list (own status card and filter) → `CustodyPickupPanel` (sender: label + handoff; Distributor: wait) |
| `SCHEDULED` + `shipmentId` (handoff signed, not yet confirmed on-chain) | same                                                                      | Panel says "Handoff submitted… do not submit again"                                                                                              |
| `DISPATCHED` / `RECEIVED`                                               | "Custody offer complete" + **Open shipment**                              | Normal shipment detail; the Distributor scans the label and confirms receipt                                                                     |
| `REJECTED` / `EXPIRED`                                                  | Closed, no actions                                                        | —                                                                                                                                                |

The Distributor sees pickups and receipt under **Warehouse arrivals** (`arrivals`); senders see
them under **Shipments**.

The "Open shipment" link goes to `shipments?offerId=` before the handoff and to
`shipments?shipmentId=` after it. Product offers (`kind 2`) use `product-shipments` instead
(`custodyShipmentPath`).

## Where the code is

| Concern                                                                         | File                                                                                                                                                                |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accept requires `pickupAt` → `SCHEDULED`; `schedule` kept for legacy `ACCEPTED` | `apps/api/src/modules/orders/custody-offers.ts` (`act`)                                                                                                             |
| Evidence gate; an expired, unverified request passes                            | `apps/api/src/modules/orders/orders.service.ts` (`proofCheck` in `offers()`)                                                                                        |
| Offer detail, evidence gate UI (`custodyProofGate`), accept form, Open shipment | `apps/web/src/features/orders/CustodyOffersWorkspace.tsx`                                                                                                           |
| Label + handoff (moved from the offer page)                                     | `apps/web/src/features/orders/CustodyPickupPanel.tsx`                                                                                                               |
| `?offerId=`, pickup rows in `ShipmentList` (`pickup` group), panel host         | `apps/web/src/features/orders/ShipmentsWorkspace.tsx`, `WorkspaceScreen.tsx` passes `initialOfferId`                                                                |
| "Request again" after expiry; expired wording; per-button spinners              | `apps/web/src/features/orders/DeliveryIdentityPanel.tsx`                                                                                                            |
| Shared spinner                                                                  | `apps/web/src/features/workspaces/shared/ui/Button.tsx` (`loading`), `workspace.css` (`.workspace-button__spinner`)                                                 |
| Spinners on other evidence screens                                              | `InformationRequestsWorkspace.tsx`, `EvidenceRequestModal.tsx`, `manufacturer/evidence/IngredientEvidencePage.tsx`, `supplier/evidence/SelectiveDisclosurePage.tsx` |
| Tests                                                                           | `custody-offers.test.ts` (API), `CustodyOffersWorkspace.test.tsx`, `CustodyPickupPanel.test.tsx`, `DeliveryIdentityPanel.test.tsx`                                  |

No contract change was needed. `CompanyProofRegistry.request` already lets the same verifier
re-request once a request has expired. No redeployment or migration is needed. Existing
`ACCEPTED` offers can still be completed with "Confirm pickup time".

## Applying this to Manufacturer → Retailer

Manufacturer → Distributor custody offers (`kind 2`) already use the same
`CustodyOffersWorkspace`. They get all of the above, routed to `product-shipments`. That
route has not been tested by hand.

The Manufacturer → Retailer delivery is order-based (`ProductDeliveryPanel`, `OrdersPage`),
not a custody offer. To apply the same rules there:

1. **Decision gate.** Reuse `custodyProofGate(status, expiresAt)` (export it to a shared file
   if a second caller appears). Use it to disable approve/accept while evidence is pending,
   and to allow them again after expiry. Mirror the server-side gate where that leg checks
   the proof (search for `COMPANY_PROOF_REQUIRED` and `proofPending`).
2. **Evidence link.** Replace the `DeliveryIdentityPanel requestOnly` modal in
   `ProductDeliveryPanel.tsx` (and `IngredientDeliveryPanel.tsx`) with a link to
   `information-requests/sent?context=delivery&referenceId=<orderId>`, the context that
   Evidence Exchange already handles.
3. **Acceptance with the pickup time.** If that leg has an accept step followed by a separate
   pickup step, combine them as in `custody-offers.ts`. Keep the old action for records that
   are already accepted.
4. **End the request at pickup.** Move handoff and receipt UI to the Shipments page and leave
   an "Open shipment" link behind.
5. **Spinners.** Add `loading={busy === '<action>'}` to each action `Btn`, with a per-action
   busy key (see `run(key, action)` in `CustodyOffersWorkspace`) so only the clicked button
   spins.
