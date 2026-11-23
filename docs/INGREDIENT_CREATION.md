# Supplier ingredient creation and evidence

The normal entry point is **Supplier → My ingredients → Add ingredient**
(`/supplier/ingredients?view=batches-new`). Existing login, Company Role issuance,
orders, stock ownership and receipt requirements are unchanged.

## Creation flow

1. **Batch details:** ingredient name, Supplier batch reference, existing category,
   quantity/unit, production date and expiry. Production cannot be in the future;
   expiry must be in the future and follow production.
2. **Origin and certifications:** searchable ISO country, optional region, city,
   source facility/private address; explicit
   allergen declaration; zero or more certification entries.
3. **Listing and review:** optional indicative price, currency, compatible price
   basis and image; review signed information and every attachment before issuing.

Processing country/facility, date-type selection, laboratory evidence and internal
quality remarks are removed from new creation. New records use production dates.
Prepared legacy registrations remain resumable after retired fields are ignored.
Previously issued records and presentations remain readable and verifiable without
displaying those retired values. New request forms and API validation reject processing
and quality claims and the Quality template; historical request policies remain parseable.

Back/Continue preserve values. Errors appear beside fields and focus moves to the
first error. PDF/DOCX/PNG/JPEG extraction remains available; extracted values are
editable and require explicit review. Extraction alone does **not** persist an
attachment. Use **Attach uploaded supply document** on the relevant certification
to include a PDF/image. DOCX is extraction-only.

### Listing and review layout

- Optional listing price and photo appear once, apart from the signed batch summary. Currency and
  compatible price basis appear when a price is entered. PNG/JPEG/WebP photos remain limited to 2 MB.
- Three review groups show batch details, origin/allergens and supplier-provided certifications.
  Quantity shows the entered unit above its exact registered equivalent. Date-only values use explicit
  UTC formatting to preserve their calendar day. Blank optional source fields are omitted.
- Edit links return to earlier steps without discarding files. Certifications are collapsed rows with
  scope/document counts; expand to preview files. Upload limits remain beside their controls.
- Back is on the left and Continue/Register with MetaMask on the right. The narrow-screen form and
  summaries use one column. Keyboard users can activate the image picker, and step navigation moves
  focus to the new content; invalid fields retain the existing focus behavior.
- Progress distinguishes preparation, wallet confirmation, submitted confirmation and chain read-back.
  A confirmation timeout does not label an already-submitted transaction as failed. Resume retains
  the existing operation and rechecks chain state. Signed details remain locked once registration begins.

Frontend regression checks cover no optional data, image/price editing, multiple certifications and
attachments, document preview, date/quantity display, duplicate submission, rejection and safe resume.
Before release, manually review desktop and 320/375 px phone layouts, keyboard focus and long filenames;
use a real Supplier wallet to confirm both MetaMask transactions, cancellation and a confirmation delay.

Origin means source provenance. A separate processing location does not replace
the source. Registered stock/dispatch locations still belong to the shipment and
inventory workflows. Country-only origin is valid. Unknown optional values stay
unavailable; extraction cannot invent a certification issuer or scope.

## Quantities and prices

New structured registrations normalize quantities using decimal text and BigInt:

| Input | Registered representation                |
| ----- | ---------------------------------------- |
| kg    | whole g; `1.25 kg` becomes `1250 g`      |
| g     | whole g                                  |
| litre | whole mL; `1.25 litre` becomes `1250 mL` |
| mL    | whole mL                                 |
| each  | whole each                               |

Reject zero, negatives, unsupported units, more than three decimal places,
fractions below a canonical unit, and values exceeding 39 canonical digits.
Existing whole-number registrations without structured origin retain their
original unit and quantity, including legacy litre batches. No existing stock is
converted or rewritten. The contracts already accept these units; regression
coverage checks g, mL and legacy litre.

Price basis must match the registered dimension: kg/g, litre/mL or each. Price,
currency, price basis and image are listing metadata, separate from signed
credential claims. Updating a listing does not re-sign the credential.

## Credential structures and disclosure

Legacy `urn:tracechain:schema:ingredient:v1` JWT VCs remain supported. Additive,
optional subject fields are `originDetails`, `allergen` and `certificationEntries`.
Original origin, certification strings and allergen text are preserved for legacy
credentials. Their missing structured values are not reconstructed.

New structured JWT issuance uses schema `urn:tracechain:schema:ingredient:v2`; new
SD-JWT issuance uses VCT `urn:tracechain:credential:ingredient:sd-jwt:v2` and the
existing issuer/holder proof mechanisms. Version 1 remains supported. See the
[version 2 disclosure policy](DISCLOSURE_POLICY.md) for request templates, processing
country, explicit date meaning and laboratory fields. Deploy the updated API, SSI
package and web client together. Existing signed credentials are not modified.

| Claim                                                                | Disclosure behavior                                                    |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Batch/credential IDs, Supplier wallet, name, category, quantity/unit | Signed context; included in new presentations                          |
| `countryOfOrigin`, `originCountryCode`, `originRegion`, `originCity` | Independently selectable source fields                                 |
| `exactSourceFacility`, `privateOriginAddress`, `processingLocation`  | Independently selectable; not automatically shared                     |
| `productionDate`, `expiryDate`, `allergenDeclaration`                | Independently selectable; allergen includes kind and necessary details |
| `certificationDetails`                                               | Original legacy certification text when available                      |
| `certification_<entry UUID without hyphens>`                         | Complete certification context, excluding files                        |
| `certificationDocuments_<document UUID without hyphens>`             | One selected file descriptor plus its parent certification ID          |

A certification contains a stable UUID, name, stated issuer, reference, optional
issue date, expiry or explicit no-expiry declaration, scope and covered reference
where applicable. Each new submitted certification requires at least one stored
supporting document. Multiple entries may have the same certification name.

Each signed file descriptor contains ID, filename, MIME type, byte size, SHA-256
and encrypted CID. Selecting a file also selects its complete certification
context. Verification rejects a file without that context. Generic required
`certifications` and `certificationDocuments` requests require at least one actual
entry/file respectively; they do not require sharing all entries/files.

The sharing preview displays selected claim values and permits preview/download of
the actual selected file. **The whole selected PDF/image is shared.** Structured
selective disclosure cannot redact information inside it. Other certification
entries, unselected files and private source fields are withheld.

Legacy JWT presentations remain explicitly **full disclosure**, with preview and
consent before preparing the existing presentation. They are not described as
holder-signed selective presentations. Older text certifications cannot satisfy
a request requiring newer structured certification context or documents.

A valid Supplier signature authenticates the Supplier's claim; it does not prove
that an outside certification authority issued the uploaded document. UI labels
use **Supplier-provided certification**. View, Verify and Accept remain separate.

## Files, storage and access

- Certification files: PDF (maximum 50 pages), PNG or JPEG; 10 MB per file,
  3 files per certification, 20 files / 20 MB total, maximum 20 certification entries.
- Browser checks extension/MIME/signature/size/count; API repeats checks, parses
  PDF pages and checks image dimensions. Corrupt, unsupported, excessive or
  unreadable content fails before issuance. Documents are never rendered as HTML.
- Uploads use existing AES-256-GCM encrypted storage and configured Pinata/IPFS
  provider. Original bytes and filename are inside encrypted content. Only signed
  references/hashes and contract-required batch fields are put on-chain.
- Attachment indexes use encrypted payloads in the existing file repository's
  `.attachments` companion file. No SQL or new application database is introduced.
- API-managed encryption keys remain server-managed: the API can decrypt content.
  This is not holder-exclusive storage. Existing storage backup responsibilities
  still apply to encryption keys, workflow journals and attachment indexes.
- Supplier downloads require current Supplier authorization, ownership and batch
  membership. Requester downloads require the intended requesting company,
  matching on-chain request, unexpired submitted/accepted presentation, fresh
  cryptographic verification and current Supplier authorization. The file must
  actually be disclosed, and CID/hash must match the stored record and bytes.
  Knowing a CID or UUID does not authorize decryption.
- Unshared source credential claims are available only to the owning Supplier.
  Catalogue responses whitelist public listing fields and country; they do not
  spread private origin or certification metadata into public results.

New authenticated routes (existing session cookies and role checks apply):

| Method | Route                                                                     | Purpose                                       |
| ------ | ------------------------------------------------------------------------- | --------------------------------------------- |
| GET    | `/api/ingredient-batches/workflows`                                       | Owner's unfinished registrations              |
| POST   | `/api/ingredient-batches/attachments`                                     | Validate/encrypt/store one certification file |
| GET    | `/api/ingredient-batches/:batchId/documents/:documentId`                  | Owner's signed attachment                     |
| GET    | `/api/production-flow/evidence-requests/:requestId/documents/:documentId` | Authorized disclosed attachment               |

The prepare route accepts 128 KB metadata; individual base64 attachment requests
accept 14 MB JSON while enforcing the 10 MB decoded-file limit. Retrieval responses
use `Cache-Control: no-store`. No new environment variables or packages are needed.

## Submission and recovery

File UUIDs and operation IDs survive retries in the current form. The API serializes
same-process retries and reuses persisted attachments and ingredient workflows.
Registration shows credential preparation, awaiting wallet, submitted and confirmed
stages using the existing credential-registration and batch-registration transactions.
Inputs are frozen once registration starts to prevent signing different data under
the same workflow. Wallet rejection retains the form and retries the saved workflow.

After confirmation, read back the batch and credential before reporting completion.
Confirmed stages are not resent when readback fails. Optional listing-image failure
is reported separately and does not invite duplicate batch creation. From the
entry chooser, **Resume a registration** reloads owner-only persisted unfinished
workflows and stored attachment bytes, including after an API/browser restart.

Limitations:

- A draft not yet prepared by the API is memory-only; leaving/reloading loses it.
  An unuploaded optional image cannot be recovered and can be added later.
- Files removed before submission or uploads whose responses were lost can leave
  encrypted orphan pins. Automatic unpinning/garbage collection is not implemented.
- Multi-process/distributed issuance locks are outside the existing file-backed
  deployment model. Same-process concurrency and persisted retries are covered.
- Signed claim editing/replacement is not added by this UI. Corrected claims need
  a separately authorized reissuance workflow; listing edits do not alter claims.
- A provider outage is shown as unavailable/upload failed, not document tampering.
- Tests use synthetic documents and local/mocked transports; live Pinata uploads
  and real MetaMask approvals must still be checked in the configured environment.

## Manual review flow

1. Sign in as Supplier, open Add ingredient and select manual entry.
2. Try blank fields/invalid quantities. Enter `1.25 kg`, a past production date and
   future expiry. Continue, go back and confirm values remain.
3. Select a country, choose Unknown or an explicit allergen declaration. Add two
   certifications with different issuers/references and supporting files. Preview
   and download them. Remove a middle entry/file and check remaining values.
4. Add a compatible price basis/image. Review `1.25 kg → 1250 g`, source vs
   processing information, certificate context and each stored file.
5. Register; reject one wallet prompt, retry and confirm the existing workflow
   resumes. Complete both transactions and reopen the batch's signed details.
6. As Manufacturer/Retailer, request country and one certification/document.
   As Supplier, preview and approve only that entry/file. The requester should see
   exactly those selected claims/files. Verify, then separately Accept if desired.
7. Check that another company cannot fetch the private document, and that an
   expired/tampered presentation or wrong file hash cannot authorize file access.
8. Repeat without certifications, using extraction, and with a legacy batch.
   Legacy text/full disclosure must remain visibly distinguished.

Automated checks cover exact conversion, legacy units, zero/one/multiple entries,
multiple files/retry/removal, corrupt/oversized/unsupported files, disclosure
context, hidden claims, wrong hash/CID, unauthorized reads, proof/source binding,
wallet rejection, transaction retry and confirmed readback. Responsive Chrome
review covers 375px, 768px and 1440px; synthetic screenshots are local ignored
artifacts under `.tracechain/ui-review/ingredient-*.png`.
