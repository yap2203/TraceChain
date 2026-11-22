# Storage and recovery

Updated 2026-11-22. Normal API runtime uses a portable encrypted administrator keystore and starts
locked after every restart. Confirmed Phase 2 business content is discovered from blockchain
references/events and decrypted from immutable IPFS objects; the former raw backend-key endpoint
remains removed.

## Current storage boundaries

| Data                                                                                     | Storage and protection                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles, permissions, applications, credential status/expiry                               | Deployed registries: IDs, hashes, encrypted content references and status. New application references point to a complete encrypted manifest rather than a server-local path.                                                       |
| Company application profile, contacts, representative, documents and optional logo       | Canonical versioned manifest plus independently encrypted attachments in the configured IPFS store. The applicant signs the full content digests and final manifest CID/hash. Local application JSON is only a legacy/cache source. |
| Batches, ingredient links, quantities/units, orders, physical custody and receipt events | Blockchain. Contract state/events are lifecycle authority and carry the immutable private-content CID/hash references required to rebuild confirmed views.                                                                          |
| Company/Ingredient VCs; product and ingredient metadata; evidence; receipt private data  | AES-256-GCM envelopes pinned to IPFS. Another API follows the on-chain CID, decrypts with the unlocked administrator keystore and validates hashes plus record/participant binding before use.                                      |
| Company/ingredient/product images and certification/registration documents               | Encrypted IPFS objects retain bytes, MIME type, safe original filename, size, hash and parent relationship. On-chain media/manifest references make confirmed files discoverable without copying local JSON.                        |
| Veramo issuer/DID metadata                                                               | `.tracechain/veramo/public-data.json` contains DID/public-key metadata only.                                                                                                                                                        |
| Veramo VC/VP/claim/message cache                                                         | `.tracechain/veramo/public-data.credentials.encrypted.json`, authenticated encryption using a domain-separated key derived from the unlocked bundle's Veramo KMS secret.                                                            |
| Issuer private keys                                                                      | The unlocked Admin bundle supplies an in-memory Veramo JSON private-key store. The legacy `.tracechain/veramo/private-keys.json` is read only by migration/legacy operator commands and can be archived after verification.         |
| Workflow journals                                                                        | Existing local JSON remains cache, unfinished transaction/retry state and legacy compatibility. It is not authoritative for a confirmed Phase 2 record.                                                                             |
| DIDComm delivery                                                                         | Existing local JSON state remains host-local and is outside Phase 2.                                                                                                                                                                |
| Company-agent messaging keys                                                             | Backend encrypted key store; backend DIDComm encryption/decryption stays server-managed.                                                                                                                                            |
| SIWE sessions/nonces                                                                     | Backend memory and an HttpOnly session-ID cookie. API restart requires signing in again.                                                                                                                                            |
| Holder presentation-signing key                                                          | Browser memory while active; separate per-company scrypt/AES-256-GCM `tracechain-presentation-keystore.json` for portable recovery. The password is not stored. Existing encrypted recovery kits remain import-compatible.          |

### Legacy Veramo migration

On SSI agent initialization, `credentials`, derived `claims`, `presentations` and `messages` are
moved out of the public JSON tree into the encrypted data cache. The encrypted file is written
and read back successfully before those collections are removed from public metadata. Conflicts
or unreadable encrypted files stop migration without discarding the legacy copy. DID/public-key
metadata and the separate issuer-key store are preserved. Do not change the KMS key to bypass an error.

Explicit historical holder exports are separate files; this migration does not silently delete them.
Restart an API still running older code so it cannot write through an old in-memory store.

## Administrator keystore and existing-installation migration

`tracechain-admin-keystore.json` is a version-1, password-encrypted portable bundle containing the
existing IPFS encryption key, Veramo KMS secret and Veramo issuer private-key store. It uses scrypt
(N=16384, r=8, p=1), AES-256-GCM, a fresh salt/IV per export and authenticated
format/version/purpose metadata. The visible file contains no raw keys, password or password
verifier. Keep the file and password in separate protected locations.

The API does not load this file automatically. It starts **Locked**. Health, SIWE and the authorized
System Admin keystore page stay available; protected content/signing work returns `KEYSTORE_LOCKED`.
After the current on-chain System Admin uploads the file and enters the password, decrypted material
exists only in that API process. Manual lock or restart discards it. Export after any issuer-key
creation/change so the portable bundle contains the newest in-memory Veramo private store. Initial
creation and export require matching password and confirmation fields. Issuer-store changes set
**Backup required**; the API rejects manual lock until a fresh export succeeds. A process restart
cannot be prevented, so do not restart while this warning is present.

For an existing installation, leave the original keys in place and run from the repository root:

```powershell
npm run keystore:migrate -- --output=C:\secure\tracechain-admin-keystore.json
```

The destination must not already exist. The interactive command hides the new password, imports
`IPFS_ENCRYPTION_KEY`, `VERAMO_KMS_SECRET_KEY` and the active data directory's
`veramo/private-keys.json`, decrypt-verifies the resulting bundle, then writes it with restrictive
permissions where supported. It does not delete or modify the source keys/files.

Verification checklist before archiving anything:

1. Back up the three original key sources separately and do not rotate them.
2. Restart the API, sign in as the current on-chain System Admin and open **Administrator keystore**.
3. Upload the migrated JSON, enter its password, and confirm the status changes to **Unlocked**.
4. Retrieve/decrypt a known existing IPFS-backed company credential or application document.
5. In a safe development workflow, confirm the restored authority DID can still sign and verify a
   credential. Do not reissue or replace production credentials merely for this check.
6. Download a fresh encrypted export, restart the API, and prove that fresh export unlocks and can
   repeat the content/signing checks.
7. Only then archive/remove the legacy environment entries and archive
   `.tracechain/veramo/private-keys.json`. Keep the portable file and password separately.

The former `POST /api/ssi/storage-key-backup` endpoint remains removed. A keystore is not a full data
backup: preserve encrypted IPFS pins, public Veramo metadata, workflow journals and deployment
references. Separate API machines can read the same encrypted records only with the same portable
bundle, chain/contract configuration, gateway/pins and pinning access. Pinning tokens remain protected
deployment configuration and are not included in this Phase 1 bundle.

## Cross-device confirmed-record recovery

A fresh API instance does not copy another instance's `.tracechain` business files. It needs the
same chain ID and complete contract deployment, a working RPC/IPFS gateway, and the same imported
Phase 1 administrator keystore. After unlock, authenticated reads:

1. query confirmed event ranges or current contract references;
2. follow the exact CID/hash recorded for that version;
3. download and AES-GCM decrypt the immutable object;
4. validate the saved hash, record ID, participant and deployment binding available in that record;
5. combine the private fields with current authoritative on-chain status.

The shared event reader keeps incremental in-memory indexes by chain, contract and event filter. It
fetches bounded block ranges, advances only through confirmed public-network blocks, rebuilds when a
checkpoint hash changes or a Hardhat head moves backwards, and reconstructs from chain after process
restart. Its cache can be deleted without deleting confirmed business data. Hardhat chain 31337 uses
zero confirmations so an idle local chain does not hide the latest mined event.

Current cross-device reads cover Company Role credentials, ingredient credentials and certification
documents, product/ingredient private presentation metadata, evidence requests/responses, custody
receipt/rejection/discrepancy content, order/location/shipment/correction details, company branding
and ingredient/product catalogue media. A broken required object fails that affected view explicitly;
it is never converted to an empty successful list. Independent records are still readable through
their own detail/media endpoints.

Typical failures remain distinct: `KEYSTORE_LOCKED`, unavailable/wrong-key encrypted content,
integrity or binding mismatch, RPC/IPFS unavailable, not found and `LEGACY_RECORD_NOT_MIGRATED`.
No decrypted payload, key, token or raw RPC body is written to logs.

## Legacy compatibility and migration boundary

All old files are preserved. Records that already have a valid on-chain CID/hash (for example Company
Role/Ingredient credentials, evidence and receipts) need no repin or mutable migration marker: the
new reader verifies and reuses that immutable object idempotently. Running it repeatedly creates no
duplicate chain record or IPFS version.

Earlier company branding, catalogue media, location aliases and some order/shipment private journals
were created by contracts that did not expose their CID. A local latest-CID map would recreate the
cross-device defect, so these objects are not silently presented as migrated. After deploying the
updated complete suite, the owning participant must explicitly upload/replay the intended version and
approve the prepared reference transaction in MetaMask. Old chain history and local files stay intact.
There is no safe automatic backend-signed migration because the backend does not own stakeholder
wallets. Unfinished/retry-only state remains local and is never returned as blockchain-confirmed data.

Company applications retain their separate read-only assessment command:
`npm run applications:assess-legacy`. It reports legacy application references without changing them.

## Local dependencies intentionally retained after Phase 2

This phase removes normal runtime dependency on local **secret key sources**, not all local state.
The active `TRACECHAIN_DATA_DIR` still contains or may create:

- `applications/company-metadata.json` and `applications/documents.encrypted.json`: legacy/cache
  application records and legacy encrypted attachments.
- `issuance/company-role.json`: issuance/activation retry journal and compatibility cache; confirmed
  credential bytes are registry-CID recoverable.
- `issuance/ingredient-batches.json` plus `.attachments`: unfinished registration/upload state and
  compatibility cache; confirmed batch metadata and referenced certification files are recoverable.
- `issuance/production-flow.json`: unfinished transaction/retry state and compatibility cache;
  confirmed product/evidence content with chain CIDs is recoverable.
- `issuance/custody-receipts.json`: unfinished receipt preparation/retry state and compatibility cache;
  confirmed CID-backed receipt evidence is recoverable.
- `orders/*.json` or equivalent order/private-record journals: unfinished operations, idempotency and
  legacy records without contract references. Confirmed records with new event/state CIDs do not depend
  on these files for discovery.
- `didcomm/state.json`: DIDComm requests, responses and delivery state.
- `didcomm/backend-agents.json`: backend DIDComm agent identities and encrypted messaging keys. These
  are not yet moved into the portable Admin keystore.
- `veramo/public-data.json`: public DID/key metadata.
- `veramo/public-data.credentials.encrypted.json`: encrypted Veramo credential/presentation cache.
- `holder/*.json`: explicit development/operator credential exports, including the bootstrap Admin
  credential when generated.
- `keystore/initialized.json`: non-secret guard preventing accidental fresh-key generation.

Tests and development scripts may create additional temporary/export JSON files. Deployment journals,
contract artifacts and the Hardhat encrypted deployment keystore remain separate contract-tooling
state. Do not delete or move any of these as part of the Admin-keystore migration.

## Manual two-instance check on Windows

Use the same root `.env` deployment configuration on both processes, but separate data directories
and ports. Import the same administrator keystore into each API after signing in as the current
on-chain Admin.

```powershell
# Terminal A
$env:TRACECHAIN_DATA_DIR = '.tracechain/device-a'
$env:PORT = '4000'
npm run dev:api
```

```powershell
# Terminal B
$env:TRACECHAIN_DATA_DIR = '.tracechain/device-b'
$env:PORT = '4001'
npm run dev:api
```

Point one Vite session at API A to create and confirm a record. Then restart Vite with
`VITE_API_BASE_URL=http://localhost:4001`, or use a second checkout/browser configured for API B. Unlock B
with the same keystore, sign in with the same participant wallet and open the confirmed record. Verify
its metadata and authorized image/document load. Stop and restart B and repeat; confirmed views must
recover without copying A's business JSON. Never delete the keystore, workflow journals or IPFS pins
for this check. If the browser origin differs, add it to the configured frontend origin.

## Company: retrieve the same VC in a fresh browser

1. Open a fresh browser/profile; connect the same company MetaMask wallet and sign SIWE.
2. Open **My company identity**. The API reads that wallet's current registry CID, downloads its
   encrypted envelope through `IPFS_GATEWAY_URL`, decrypts it and checks its hash/wallet binding.
3. Select **Verify My Credential** for the existing cryptographic and current on-chain checks.

This does not need a VC upload, vault password, old browser storage or holder-key kit. Losing a browser
does not reissue the credential. Gateway failure does not silently fall back to a local cached payload.
The normal deployed content store supports remote retrieval; legacy injected test stores may use
their explicit encrypted-payload adapter. The identity response exposes selected fields, not raw VC JSON.

## Holder: restore the key and sign a new VP

Retrieving a VC restores access to the credential; it does **not** restore the credential-bound
presentation-signing key. In **My company identity → presentation signing**, import the separate
holder-signing recovery kit with its own password. Confirm its DID matches the key bound to the
credential, then preview and explicitly approve a new challenge/recipient-bound presentation.

For a new presentation key, enter and confirm the backup password, download the encrypted keystore,
confirm that the file and password were stored separately, and only then bind the key to the company.
Closing or refreshing before binding loses only an unbound key; it cannot leave a credential bound to
an unbacked key.

A newly generated unrelated key cannot replace the bound key merely because the same wallet logged
in. A wrong kit password, wrong holder, changed recipient/challenge, or revoked credential must fail.
The System Admin keystore and company presentation-signing keystore are intentionally different
formats and are not interchangeable.

## Scope and verification

Live read-only testing on 2026-11-16 retrieved/decrypted **41** pinned credentials and matched
their issuance-journal hashes and wallets; **4** non-IPFS/unsupported references were skipped.
The local legacy Veramo store was migrated and its public metadata file was checked to contain
zero credential/claim/presentation/message collections. The earlier Admin export/verify UI has
since been removed; historical backup files remain intact. Current removal validation is recorded
in docs/PROGRESS.md.

- Storage tests retain encryption/retrieval, wrong-key, ciphertext-tampering and gateway checks.
- Regression tests check that the retired backend-key endpoint returns 404 and audit exports
  remain visible without backup controls.
- Real SIWE signatures from the same wallet in two fresh sessions retrieve and verify the same signed
  Company VC using simulated Pinata HTTP and real AES-GCM, without a local credential journal/cache.
- A separately restored holder kit signs an SD-JWT presentation; wrong holder, challenge, recipient,
  hidden-required-claim and tampering checks still reject it. Retrieving credential bytes alone is insufficient.
- Live retrieval results above are historical read-only checks, separate from automated tests.

The read-only `npm run applications:assess-legacy` command identifies legacy `local://` applications,
recoverable local sources and missing fields without decrypting or modifying them. Additional-evidence
records can use the existing applicant-signed resubmission method. Pending applications require an
Admin evidence request first. Approved, rejected and withdrawn records cannot be rewritten under the
current contract; changing that historical-reference policy requires a new contract design and
redeployment, not applicant impersonation.

Phase 2 changes contract bytecode and therefore requires a new complete, consistently wired deployment;
it does not rewrite historical chain data, deploy, reset a chain or change configured addresses by
itself. Catalogue media remains encrypted and authenticated; public unencrypted media/video publishing
is not introduced. New registration documents still resolve through the signed application manifest.
Only the confirmed applicant or current authorized Admin can list/download them. Old filename-only
registrations require applicant reattachment and old media/private journals without a chain CID require
an authorized replay; their original records and hashes remain preserved.

The repository's Sepolia command uses the separate `tracechain-sepolia-storage-v2` Ignition journal.
Its configuration step checks the new content-reference getters before updating `.env`; the older
`tracechain-sepolia` deployment journal remains untouched.
