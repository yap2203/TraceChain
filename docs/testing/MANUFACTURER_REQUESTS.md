# Manufacturer products, information requests and orders

The Manufacturer no longer has a separate Browse page. This stage reuses the existing authenticated
order, production-flow and company-identity APIs. It does not change login, credential formats,
contracts or deployment configuration. All displayed records come from those services, not fixtures.

## Where each action lives

| Page                                     | Purpose                                                                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Products → My products                   | Search owned product batches; view quantities/units, dates, status, linked ingredients, optional registered price and product traceability/QR details.                                 |
| Products → Supplier ingredients          | Search registered Supplier ingredients, inspect their available business details, and request information or a quantity.                                                               |
| Product detail → Linked ingredients      | Open the exact linked ingredient in the Supplier ingredient detail/request view. Unavailable records show an explanation rather than a substitute batch.                               |
| My orders → Sent to Suppliers            | Track ingredient quantity requests, deadlines, notes and Supplier decisions. Manage a Supplier's company-proof challenge through Information requests.                                 |
| My orders → Received from buyers         | Review finished-product quantity requests; approve/reject with explicit confirmation, or request buyer company evidence.                                                               |
| Information requests → Sent requests     | Open ingredient-evidence requests, inspect their requested claims, view received disclosures, verify, then separately accept/reject. Also manage company proofs requested from buyers. |
| Information requests → Received requests | Preview and explicitly approve/decline company evidence requested by Suppliers against ingredient-information or quantity requests.                                                    |

Canonical pages are `/manufacturer/product-batches`, `/manufacturer/orders` and
`/manufacturer/information-requests`. Older `/manufacturer/ingredient-evidence` and internal
`evidence` links redirect to Information requests. Supplier, Retailer and Distributor navigation
continues using their existing flows.

Product fields come from wallet-scoped registry operations, authenticated order/discovery metadata
and existing product traceability resolution. Missing names, price or Supplier metadata remain
unavailable; no example records are inserted. Information-request lists use the authenticated
EvidenceRegistry request list and current order/company-identity status services. Retrieval errors
appear explicitly; they are not reported as failed signatures or invented successful proof checks.

## Manual test

Use registered, currently authorized Manufacturer and Supplier accounts on the same configured chain.
For buyer-facing product decisions, also use an authorized Retailer and an existing registered product.

1. As Manufacturer, open Products. Confirm there is no Browse sidebar item. Search My products by
   its actual name/reference. Open a product and inspect its real quantity/unit, dates, QR and links.
2. Select Supplier ingredients. Search for an ingredient registered by the Supplier. Open it and
   check the Supplier, reference, available quantity, expiry and optional indicative unit price.
3. Select Request evidence or information. Enter a reason and future deadline, select necessary/optional
   claims, and explicitly send/sign the request. In Information requests → Sent, open that request
   and confirm its exact batch, reason and claim requirements.
4. As Supplier, open the received ingredient-information request and request company identity proof.
   As Manufacturer, open Information requests → Received. Open the linked request, preview the
   company proof and explicitly approve or decline. Use the existing holder signing settings when
   required. No proof should be signed merely by opening the page.
5. As Supplier, verify the company proof and separately decide whether to share ingredient evidence.
   As Manufacturer, view the disclosed values under the Sent request. View, Verify and Accept/Reject
   must remain separate; opening a response must not verify or accept it automatically.
6. Return to ingredient details and select Request quantity. Enter a positive whole-number
   quantity in the batch's existing unit, future deadline and optional private note. Submit/sign.
   Confirm My orders → Sent shows the exact company, item, quantity, deadline and decision.
7. As Supplier, open My orders, inspect the received Manufacturer request and request company evidence.
   As Manufacturer, open the matching Received information request (or Manage company evidence in
   the order detail), preview and respond. Confirm this proof remains bound to the quantity request,
   separately from the ingredient-information proof in steps 3–5.
8. As Retailer, submit a quantity request for a Manufacturer product through the existing Retailer
   flow. As Manufacturer, open My orders → Received. Review details and select Approve or Reject.
   Confirm that a second explicit confirmation is required before the on-chain decision. Alternatively,
   request company evidence and manage its status under Information requests → Sent.
9. Test empty lists, an unmatched search, service failure and small-screen layouts. A missing request,
   identity status or metadata must not be replaced with a sample or successful verification.

Quantity requests, approvals and evidence acceptance do **not** reserve goods, dispatch shipments or
credit production stock. Product creation retains the existing requirement for accepted physical stock
at a registered production location. Physical fulfilment controls remain outside this stage.

Company presentations retain their existing format-specific sharing and holder-signature behavior;
this UI change introduces no new selective-disclosure format or automatic credential release.

## Automated checks

Run from the repository root:

```sh
npm run test:frontend
npm run typecheck
npm run build --workspace @tracechain/web
```

Frontend regressions cover product metadata/search and linked ingredient routing, ingredient detail
actions, sent/received order tables, seller confirmation controls, both received company-proof contexts,
request-scoped evidence review, proof-status outages and legacy evidence navigation. Live MetaMask
transactions and multi-company disclosure review still require the manual flow above.
