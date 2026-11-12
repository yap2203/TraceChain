# Browse & requests

Manufacturer receipt confirmation is now available after Supplier approval, before production.
See [receipt and multi-ingredient production](testing/MANUFACTURER_REQUESTS.md#receipt-and-multi-ingredient-production)
for deployment requirements and the test flow. Approval alone still does not move stock; the
explicit Manufacturer receipt action debits Supplier stock and credits its selected receiving location.

## Current scope

The Manufacturer, Distributor and Retailer catalogue is a request-only B2B discovery experience.
It discovers registered on-chain ingredients and products, then enriches them with a strict safe
business-metadata allowlist and verified stakeholder-directory names. It does not provide a cart,
checkout, payment, automatic fulfilment or stock reservation.

The responsive catalogue provides search, item-type/category/origin/credential filters, active and
available filtering, sorting, result counts and clear empty/error/loading states. Cards use readable
company names, optional presentation images, lifecycle badges, the exact registered unit and an
optional indicative price. Technical IDs and wallet addresses stay in collapsed details.

Opening a card shows the available safe batch facts and keeps two actions separate:

1. **Request quantity** records request-only interest through the existing validated unsigned
   transaction and MetaMask flow. It does not reserve or move inventory.
2. **Request evidence or information** uses the existing claim-selection, Supplier consent and
   verification flow. Confidential evidence is not disclosed merely because an item is listed.

Manufacturer My requests uses a compact desktop table and mobile cards. The Supplier **Order
requests** page uses one responsive row-card list with calculated review/evidence/approved/closed
summaries, workflow filters, search, sorting and a structured review dialog. Both show verified
company names, quantity/unit, dates, status and the next expected action. Approving or rejecting a
request records the Supplier decision only; it does not process payment or initiate fulfilment.

## Presentation images and logos

Suppliers may add one optional catalogue image to a batch, and an authenticated verified company
may add its own optional logo. Accepted types are PNG, JPEG and WebP, with a 2 MB maximum. The API
validates the declared MIME type, filename extension, binary signature and dimensions before the
existing content abstraction encrypts and stores the versioned presentation record off-chain.

Uploads are authenticated and ownership-checked against authoritative batch/company records.
Catalogue responses expose only authenticated media routes, never a CID, encryption key, raw
base64 value or ciphertext. Media reads recheck authorization and authoritative ownership and use
safe response headers. Images and logos are presentation metadata: they do not change credential
claims, blockchain authorization, quantities or historical traceability, and they do not prove the
physical quality or origin of an ingredient.

## Supplier management

Ingredient batches remain the Supplier's owned management surface. A Supplier can edit the listing
name, category, description and indicative price, archive/restore a listing, and upload/replace its
presentation image. Signed Ingredient Credential claims, the registered quantity/unit and historical
records remain unchanged. Order requests and Information requests continue to separate quantity
decisions, company proof exchange and ingredient evidence consent. Wallets, request IDs, batch IDs
and transaction identifiers remain inside collapsed Technical details.

## Deferred work

The current page intentionally excludes purchase orders, payment, reservation, proposal, dispatch,
receipt and recall controls. Existing physical-flow contracts, API modules and records are retained
for their dedicated workflows; they are not silently triggered by catalogue browsing or requests.

## Manual checks

1. Sign in as a Supplier, open an owned Ingredient batch, and upload a valid image. Confirm an
   unsupported, corrupt or over-2-MB file is rejected.
2. Open My company credential and upload the authenticated company's logo.
3. Sign in as a Manufacturer and open Browse & requests. Check search, every filter, sorting, empty
   results, long names, image/logo fallbacks and the one/two/three/four-column breakpoints.
4. Open an item and verify Supplier-provided/indicative warnings and collapsed technical details.
5. Submit a quantity request and an evidence request separately. Confirm neither action exposes a
   cart, takes payment, reserves stock or bypasses Supplier consent.
6. Review Supplier Order requests at 320, 375, 768, 1024, 1440 and 1920 px. Check summary counts,
   status filters, sorting, the responsive review dialog, API/RPC failure states and MetaMask
   rejection behavior.
