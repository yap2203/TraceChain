# Company and Ingredient presentation policy, version 2

**Current UI scope (2026-11-19):** Processing and quality-evidence inputs are removed
from new ingredient creation and request forms. The Quality template is no longer
offered for new requests. The versioned fields and verification described below
remain supported for existing signed credentials, saved registrations and historical
requests. Resume preserves original data in a read-only additional-details summary.

This policy applies to new requests in the normal workspaces. SIWE login, holder
presentation signing, backend-managed DIDComm, encrypted Pinata storage and existing
on-chain authorization remain separate. No SQL/NoSQL service, dependency, contract
change or redeployment is required.

## Versions and signed sources

| Artifact                             | New version                                       | Legacy support                                                                   |
| ------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Company Role VC                      | `urn:tracechain:schema:company-role:v2`           | v1 remains verifiable; missing country is not invented                           |
| Derived Company identity attestation | `urn:tracechain:company-identity-proof:sd-jwt:v2` | v1 attestations/full Company VPs retain their existing supported verification    |
| Structured Ingredient JWT VC         | `urn:tracechain:schema:ingredient:v2`             | v1 and its previously issued optional extensions remain readable                 |
| Ingredient SD-JWT                    | `urn:tracechain:credential:ingredient:sd-jwt:v2`  | v1 remains verifiable under its format                                           |
| Ingredient request                   | `policy.policyVersion = 2`                        | Existing encrypted workflows without a policy retain their recorded legacy rules |

The Company Role VC and its derived selective attestation are **different formats**.
The API first retrieves and cryptographically verifies the exact source Company VC,
checks its registered hash and uses its original authority key to sign the derived
attestation. The holder then signs a fresh key-bound presentation. A profile value
alone cannot become a Company presentation claim.

Company registration collects an optional registration country, distinct from the
phone dialing country and business address. Admin reviews/selects the ISO country
before normal new issuance; the API requires it for a new issuance workflow. Country
is signed into the VC and participates in its credential hash. Existing persisted
v1 issuance retries and bootstrap/test helpers remain compatible. Changing the
country on a persisted issuance is a conflict, not an in-place credential edit.

## Company disclosure

**Always included:** company name, approved role, company wallet, subject DID,
issuer, source credential reference/hash and validity, holder-key binding, audience,
request ID, purpose, challenge, presentation creation and expiry.

**Selectable:** registration number and ISO registration country together; internal
company ID independently. Selection of either registration field selects both;
verification rejects partial disclosure. The UI provides one request requirement
for that group. Application reference is absent from normal request defaults and
material projections; old explicitly requested workflows can retain it.

An older VC without country cannot satisfy a required registration group. Preview
shows the missing signed field and the need for an authorized replacement; it does
not copy the current country from application/profile data. The holder may decline.
There is no general replacement/reissuance UI added by this stage. Existing signed
credentials, application IDs, batch links and historical presentations are preserved.

## Ingredient disclosure and field mapping

**Always included:** ingredient name, TraceChain batch ID, Supplier batch reference
when available, Supplier wallet/subject DID, issuer, credential reference, holder
binding and validity metadata. Legacy formats retain their original binding fields;
missing claims are not fabricated.

Existing structured fields are reused where their meaning matches the requested
policy names:

| Policy meaning                | Stored/signed field or disclosure                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Origin region / city          | `originDetails.region/city` → `originRegion/originCity`                                                                |
| Source facility reference     | `originDetails.facility` → `exactSourceFacility`                                                                       |
| Private source address        | `originDetails.privateAddress` → `privateOriginAddress`                                                                |
| Processing country            | Optional ISO `originDetails.processingCountry` → `processingCountry`                                                   |
| Processing facility reference | `originDetails.processingLocation` → `processingLocation`                                                              |
| Date and its meaning          | `productionDate` plus `productionDateMeaning` (`production` or `processing`), shared together by the normal consent UI |
| Allergen status/details       | `allergenDeclaration: {kind, details?}`                                                                                |
| Ingredient expiry             | `expiryDate`, distinct from credential `exp`/`expirationDate`                                                          |
| Certification                 | `certification_<stable entry ID without hyphens>`                                                                      |
| Selected certification file   | `certificationDocuments_<stable file ID without hyphens>`                                                              |
| Laboratory report/results     | `qualityTest_<stable entry ID without hyphens>`                                                                        |
| Selected laboratory file      | `qualityDocuments_<stable file ID without hyphens>`                                                                    |
| Internal remarks              | `internalQualityRemarks`                                                                                               |

Supplementary source/processing fields are optional; no street address is required.
The allergen selector has no preselected declaration. Contains/May contain requires
associated details; Supplier declares none and Unknown remain distinct statements.

A certification disclosure includes its name, stated issuing organization, certificate
number, scope/reference and stated validity as one complete entry. Files are separate
disclosures. A laboratory entry includes laboratory name, report number, test date,
sample reference, exact tested Supplier batch reference and result text. Each selected
file requires its exact parent context. These are Supplier-provided claims and reports,
not an independent verification with an outside certifier or laboratory.

Files reuse the validated AES-256-GCM upload service: PDF/PNG/JPEG, 10 MB/file,
3 files per entry, 20 files/20 MB combined across certifications and laboratory reports.
Document IDs, filename/media type, SHA-256, encrypted CID and entry association are
signed; file bytes stay encrypted off-chain. Removed/abandoned pins have the existing
orphan-cleanup limitation described in [ingredient creation](INGREDIENT_CREATION.md).

## Request templates and consent

All existing Manufacturer/Retailer ingredient request composers, catalogue requests,
Company order/delivery requests and ingredient-linked Company requests use the shared
policy components. Existing Information requests remains the management destination.

| Template            | Required evidence                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Basic traceability  | Raw-material country, Supplier-reported production/processing date, ingredient expiry                              |
| Food suitability    | Explicit allergen status and necessary associated details; Unknown fails unless the requester explicitly allows it |
| Certification check | At least one matching complete certification entry                                                                 |
| Quality check       | Laboratory results with context for the exact Supplier batch                                                       |
| Custom              | Supported fields individually marked Required or Optional                                                          |

Requesters can select certificate type/name, scope and covered reference without
seeing a Supplier's undisclosed entries. Documents must be requested separately.
The policy is encrypted with the request and committed into its on-chain claims hash.
New HTTP requests default to policy 2 and reject unsupported selectable claim names.

Consent shows actual requester, purpose, deadline, batch, actual claim values,
always-included context, required/optional selections and available information that
will remain undisclosed. Generic certification/laboratory requirements are satisfied
by selecting suitable entries, not by automatically disclosing every entry. Selecting
a document selects its parent context, never sibling files. The Supplier must preview
the current source credential before signing; a different source requires a new preview.

Selected PDFs/images can be previewed/downloaded and are shared **as whole files**.
Structured selective disclosure cannot redact text printed inside them. No raw source
VC or withheld document references are returned to the recipient as a shortcut.
Legacy full-credential sharing remains explicitly labelled and requires full-disclosure
consent; it cannot selectively hide its fields/documents.

## Verification and business acceptance

Ingredient policy-2 holder proofs bind the request ID, purpose, batch, intended verifier,
fresh challenge and explicit expiry in the key-binding JWT. Verification also checks
the issuer JWT against the exact registered source, disclosures, holder signature,
Supplier wallet/DID and current credential/participant authorization. Company proofs
bind the same request context in the authority-derived attestation and holder proof,
then compare all disclosed claims and source validity/reference with the verified VC.

Policy checks reject missing requirements, disallowed Unknown allergens, incomplete
allergen details, expired/not-yet-stated certificate validity, mismatched certificate
type/scope/reference and laboratory results for another batch. A company certificate
does not satisfy laboratory evidence. Unrequested selective fields/files are rejected.

The existing short holder-proof freshness window remains five minutes; new material
and submitted policy-2 presentation expiry are bounded accordingly and by request and
credential expiry. If it expires, obtain a fresh request/proof through the supported
workflow; historical verification does not grant ongoing permission.

View Evidence, Verify Evidence and business Accept/Reject remain separate. Fresh
verification precedes acceptance and private file reads; suspended/revoked/expired
credentials or companies fail current authorization. File reads additionally require
the intended recipient, exact disclosed file/entry association and matching bytes/hash/CID.
Historical successful results remain historical. Signature-only rendering of unverified
claims does not mark them verified or accepted. Verification failure logs omit claim
values and proof contents.

## Testing the normal flows

1. Register a company with a registration country. As Admin review the application,
   confirm its country and issue the Company Role VC. Login remains MetaMask + SIWE.
2. Request Company evidence from an order/delivery or linked ingredient information
   request. Mark the registration group Optional or Required and enter purpose/deadline.
3. As the holder, preview actual values and binding metadata. Company name/role/wallet/DID
   are locked. Toggle registration: both number and country must change together.
   Review and approve/sign, then verify as requester. This does not approve an order
   or grant ingredient access. Repeat with a v1 VC lacking country: decline or obtain
   an authorized replacement when the group is required.
4. As Supplier, create a structured ingredient with a clearly classified date, two
   certifications, separate files and optionally a laboratory report for its exact batch.
5. As Manufacturer or Retailer, choose Basic, Food, Certification or Quality, or make
   a Custom request. Require a certificate scope and request a document explicitly.
6. As Supplier, preview the source, select one suitable entry/file and approve/sign.
   Verify that the recipient sees only selected claims/files. Use View, Verify and Accept
   separately. Try Unknown allergens, wrong certificate scope, omitted required files,
   an expired proof and a different company attempting to download the file.

Automated coverage includes real authority/holder signatures, both Company presenter
roles, registration grouping, legacy missing country, independent certification and
laboratory disclosures, hidden values, proof/source binding, wrong request/purpose/
recipient/holder/challenge/batch, replay, expiry, current revoked authorization, file
association/access and actual UI selections passed to signing. Transport is local/mocked;
live Pinata uploads and real MetaMask confirmations are not performed by these checks.

Run from the repository root:

```powershell
npm run build
npm run typecheck
npm run test --workspace @tracechain/web -- --maxWorkers=4
npx vitest run apps/api/src packages/shared/src
npm run test:ssi --workspace @tracechain/ssi
```

Contract regression: from `packages/contracts`, run
`npx hardhat test test/TraceChain.ts`. No contract migration is required. Deploy the API,
SSI/shared packages and web client together; do not rewrite existing signed payloads.
