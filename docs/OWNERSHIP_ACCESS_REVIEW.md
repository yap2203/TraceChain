# Company ownership and access review

Reviewed 15 November 2026. Company isolation uses the authenticated SIWE wallet and current
authorization, never a wallet supplied in a request body. Role membership alone does not make a
company the owner of another company's records. This is an application access review and regression
suite, not a formal security audit or a guarantee that every vulnerability has been eliminated.

## Resource rules

| Resource                          | Company access and management                                                                                                                                                                                                       | Intended exceptions                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingredient management             | Original Supplier manages its own batches, listings, images and recall actions. Lists check the actual batch Supplier before decrypting metadata.                                                                                   | Manufacturers discover public ingredient listings and request information; actual shared evidence has separate participant checks. Existing Admin lifecycle authority remains.                       |
| Manufacturer products             | Operational management lists and detail screens show the connected Manufacturer's products. Transfer preparation verifies the recorded Manufacturer.                                                                                | Distributors/Retailers retain products associated with their own transfers; Distributors can dispatch stock in their own custody. Public product catalogue discovery remains available to Retailers. |
| Orders                            | Buyer and seller see their orders. Only the seller proposes/decides/arranges dispatch; only the buyer binds requested evidence. API closure is participant-only. New receiving locations must belong to the buyer.                  | Assigned delivery/custody Distributors receive the operational order context, without buyer/seller private notes or decision reasons. Contracts retain permissionless expired-order cleanup.         |
| Custody inventory                 | Distributor inventory contains that Distributor's positions. Supplier visibility is limited to its own supplied ingredient batches.                                                                                                 | Manufacturer ordering uses minimal public availability; authorized Admin inspection remains.                                                                                                         |
| Shipments                         | Dispatch checks stock ownership/custody and the sender's location. Custody acceptance and receipt are bound to the exact recipient. Returns are bound to the original Supplier. Vehicle recording requires an involved Distributor. | Actual participants and permitted Admin functions retain their respective tracking/reconciliation access. A valid QR does not authorize an unrelated receiver.                                       |
| Ingredient evidence               | Inbox/detail/review access requires the actual requester or Supplier, the appropriate action role, and a workflow matching the live registry record before private reads.                                                           | Only explicitly shared presentation contents are available to the intended requester. Inbox context is whitelisted and excludes private challenges/arbitrary stored fields.                          |
| Company credentials/proofs        | My Company Identity resolves credentials from the session wallet. Proof material and verification use exact linked participants and current authorization.                                                                          | Existing authorized Admin issuance/lifecycle operations remain separate.                                                                                                                             |
| DIDComm                           | Existing mailbox filtering and thread/recipient checks bind business messages to the intended company participants.                                                                                                                 | Current backend-managed company agents encrypt/decrypt under the previously selected model. This work does not introduce participant-exclusive key custody.                                          |
| Traceability QR                   | Public product summaries remain public. Signing in as an unrelated company does not unlock technical identifiers or private ingredient references.                                                                                  | Product creator, custody participants and authorized Admin can inspect the technical projection.                                                                                                     |
| Locations/company directory/media | Private location labels are limited to owners and the existing related delivery context. Logo/image updates require the resource owner.                                                                                             | Registered warehouse discovery, company directory names/roles and catalogue images are intended business discovery information.                                                                      |

## Changes made

- Added API response scoping for operational ingredients, products, transfers and evidence; the
  response identifies the authenticated actor wallet. Manufacturer management pages independently
  fail closed when a product is not owned by that actor.
- Scoped Orders catalogue projections by workspace purpose: Suppliers' own ingredients,
  Manufacturers' own products plus ingredient discovery, Retailer product discovery, and
  Distributors' related custody/order/shipment items.
- Added resource checks before order/logistics transaction preparation and private writes, including
  product dispatch, ingredient dispatch, warehouse registration/decisions, receipt, return, vehicle
  changes, order evidence, proposal, closure and recall. Contract simulation remains required.
- Rechecked live evidence/workflow binding before private reads and limited inbox metadata to the
  fields needed for display.
- Restricted authenticated traceability technical details to actual product participants/Admin.

No contracts, deployment addresses, login flow, credentials or environment values were changed by
this review. No additional contract deployment is needed for these application checks. Existing
deployment upgrade requirements from earlier features still apply. Restart/rebuild API and web.

## Automated verification

The API suite includes `operational-ownership.test.ts`, cross-company Orders tests,
`production-flow.test.ts`, `ingredient-batch.test.ts`, `product-traceability.test.ts`, existing
SSI cross-wallet credential tests, DIDComm recipient/thread tests and custody participant tests.
They cover same-role resource substitution, denial before encryption/preparation, unrelated
shipment QR recipients, foreign receiving locations, owner/custodian success, stale evidence
bindings and safe public traceability. Frontend tests cover foreign product list entries and direct
detail references, alongside existing private custody detail and role-route tests.

Run from the repository root:

```powershell
npx.cmd vitest run --root apps/api --maxWorkers=4
npm.cmd run test --workspace @tracechain/web -- --maxWorkers=4
npm.cmd run typecheck
npm.cmd run build
```

## Manual two-company check

1. Use separate browser profiles for Manufacturer A and Manufacturer B on the same configured
   network. Create a product under A. B's owned-product list must exclude it; opening A's management
   detail reference under B must show unavailable/not found. A must retain management access.
2. Repeat with Supplier A/B ingredients: B must not update/archive A's batch, replace its image,
   recall it or dispatch its stock. Authorized Manufacturer discovery should still show the public
   listing so that business requests remain possible.
3. Put stock in Distributor A's custody. Distributor B must not see A's inventory detail or accept,
   dispatch or receive A's shipments. Scanning A's valid QR as B must not permit receipt.
4. Create an order and evidence request between the intended companies. A different company with
   the same role must not see private notes, presentation contents or proof material, nor approve,
   arrange, close or bind evidence to that order.
5. Verify that the real buyer/seller/custodian can still finish the normal workflow. Verify Admin
   lifecycle pages still require Admin. Log out or switch wallets and confirm the previous
   company's workspace is no longer accessible.

Do not share session cookies or tokens when checking requests in DevTools. Automated tests use
isolated fixtures; this review did not send real transactions or perform a multi-wallet browser run.

## Privacy limits

Solidity state and events on a public blockchain remain readable directly through RPC/explorers.
Application filtering cannot hide those records or quantities from chain observers. Sensitive
supporting documents/credentials must stay off-chain, encrypted and access-controlled. Catalogue
discovery and authorized inter-company sharing are intentional; ownership-only management does not
mean that a buyer cannot see any seller information. These checks do not protect against a stolen
session, compromised wallet/device, malicious frontend or compromised API host.
