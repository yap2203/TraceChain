# Manufacturer products, information requests and orders

The Manufacturer no longer has a separate Browse page. This stage reuses authenticated order,
production-flow and company-identity APIs. The explicit approved-request receipt action adds a
SupplyChainOrders contract capability and requires deployment of the updated full suite. Login and
credential formats are unchanged. All displayed records come from those services, not fixtures.

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
   As Manufacturer, open the matching Received information request (or Respond to company evidence request in
   the order detail when an identity challenge exists), preview and respond. Confirm this proof remains bound to the quantity request,
   separately from the ingredient-information proof in steps 3–5.
8. As Retailer, submit a quantity request for a Manufacturer product through the existing Retailer
   flow. As Manufacturer, open My orders → Received. Review details and select Approve or Reject.
   Confirm that a second explicit confirmation is required before the on-chain decision. Alternatively,
   request company evidence and manage its status under Information requests → Sent.
9. Test empty lists, an unmatched search, service failure and small-screen layouts. A missing request,
   identity status or metadata must not be replaced with a sample or successful verification.

Quantity requests, approvals and evidence acceptance do **not** reserve goods, dispatch shipments or
credit production stock. The explicit Manufacturer receipt action described below credits only stock
physically confirmed at a registered receiving/production location. Legacy dispatch controls remain
outside this stage.

## Receipt and multi-ingredient production

1. Deploy the updated full suite to the desired test network using a fresh Ignition deployment ID;
   preserve the previous journal and keys. Update the public contract addresses in root `.env`, restart
   the API, and register the test companies and ingredient records against the new suite. Existing
   deployments cannot be upgraded in place because their ledger references are configured once.
2. Manufacturer requests 5,000 g of Cocoa and 3,000 ml of Milk. Supplier approves each request.
   Confirm usable Manufacturer stock remains zero before receipt; approval is a decision only.
3. Manufacturer opens each **My orders → Sent to Suppliers → View request**. Select or register
   an owned receiving location, enter the quantity physically received and its actual date/time,
   tick the receipt declaration and confirm with MetaMask. Partial receipts are allowed; amounts
   cannot exceed the outstanding approved quantity. Supplier available stock decreases and
   Manufacturer received stock increases atomically. A repeat receipt ID cannot credit stock twice.
4. Ingredient evidence is optional. For the main test, do **not** request or accept ingredient
   evidence for either batch. If additional claims are needed, use Information requests separately;
   receipt and production never automatically mark a presentation verified or accepted.
5. Open **Products → Create product batch**, select the same production location and select both
   ingredient checkboxes. For Cocoa select kg and enter 1.25; for Milk select litre and enter 0.5.
   The preview should show **3,750 g** and **2,500 ml** remaining. Choose a separate output unit
   such as each for the finished product; output units do not convert or sum recipe inputs.
6. Complete the product's actual name, reference, category, quantity and valid dates. Confirm the
   transaction in MetaMask. The result screen reloads actual remaining balances from the ledger.
   Reopening production should show the same remaining balances, with both ingredient links on
   the product detail. Repeat another production run to confirm deductions accumulate correctly.
7. Try an amount above received stock, an incompatible unit, a fractional quantity smaller than
   one registered unit, duplicate ingredient links, an unrelated company and a repeated receipt.
   Each must fail without partial stock changes. For a batch stored as whole kg, 100 g cannot be
   consumed without a future fractional-ledger change; exact conversions never round silently.

To deploy locally from `packages/contracts`, with your existing Hardhat node running:

```sh
npx hardhat ignition deploy ignition/modules/TraceChain.ts --network localhost --deployment-id tracechain-optional-evidence-local
```

Use the fresh deployment's addresses, not older addresses. This command is provided for manual
testing and has not been run against the user's live chain by this implementation.
The deployment must include both `SupplyChainOrders.approvedReceiptPolicy() = 1` and
`ProductRegistry.receivedProductionPolicy() = 1`. An earlier receipt-only deployment still has the
old mandatory evidence gate and needs the new full suite. The API reports this explicitly instead of
preparing a transaction that would fail. Legacy integrations with no received-stock ledger retain
their previous evidence checks; they are not a substitute for receipt-backed production.

Company presentations retain their existing format-specific sharing and holder-signature behavior;
this UI change introduces no new selective-disclosure format or automatic credential release.

## Supplier remaining-stock check

1. As Supplier, register a batch with 100 g and open Ingredient batches.
2. As Manufacturer, request 20 g. Refresh Supplier Ingredient batches or open that request in
   My orders: current on-chain stock remains 100 g, awaiting approval is 20 g, and remaining after
   open requests is 80 g.
3. Supplier approves: demand moves to Approved, awaiting receipt (20 g); remaining stays 80 g.
4. Manufacturer confirms physical receipt of 5 g. Refresh Supplier: current stock is 95 g,
   approved awaiting receipt is 15 g and remaining after requests is still 80 g.
5. Confirm the remaining 15 g: current stock is 80 g, outstanding demand is zero and remaining is
   80 g. Product creation consumes Manufacturer received stock, not Supplier stock a second time.
6. Create another request, then reject it: its demand disappears after refresh. Expired requests
   are excluded too. If total open demand exceeds stock, remaining displays zero and a separate
   shortfall warning. Requests never guarantee or reserve availability.

Older multi-batch requests without an exact batch binding display an unavailable projection;
single-batch legacy items can be resolved safely. Other companies cannot retrieve Supplier demand
summaries. These checks require no new contract deployment beyond the receipt support above.

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
