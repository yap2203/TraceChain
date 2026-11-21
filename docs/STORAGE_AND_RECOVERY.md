# Storage and recovery

Updated 2026-11-21. Normal API runtime uses a portable encrypted administrator keystore and starts
locked after every restart. The former raw backend-key endpoint remains removed.

## Current storage boundaries

| Data                                                                                     | Storage and protection                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles, permissions, applications, credential status/expiry                               | Deployed registries: IDs, hashes, encrypted content references and status. New application references point to a complete encrypted manifest rather than a server-local path.                                                       |
| Company application profile, contacts, representative, documents and optional logo       | Canonical versioned manifest plus independently encrypted attachments in the configured IPFS store. The applicant signs the full content digests and final manifest CID/hash. Local application JSON is only a legacy/cache source. |
| Batches, ingredient links, quantities/units, orders, physical custody and receipt events | Blockchain. Contract state and events remain visible to chain readers.                                                                                                                                                              |
| Company and Ingredient VCs; private evidence and metadata                                | AES-256-GCM envelopes pinned to IPFS. The encryption key comes from the unlocked administrator keystore. The API still authorizes every content operation.                                                                          |
| Veramo issuer/DID metadata                                                               | `.tracechain/veramo/public-data.json` contains DID/public-key metadata only.                                                                                                                                                        |
| Veramo VC/VP/claim/message cache                                                         | `.tracechain/veramo/public-data.credentials.encrypted.json`, authenticated encryption using a domain-separated key derived from the unlocked bundle's Veramo KMS secret.                                                            |
| Issuer private keys                                                                      | The unlocked Admin bundle supplies an in-memory Veramo JSON private-key store. The legacy `.tracechain/veramo/private-keys.json` is read only by migration/legacy operator commands and can be archived after verification.         |
| Workflow journals and DIDComm delivery                                                   | Existing local JSON repositories, with sensitive payloads encrypted. They remain necessary off-chain state; there is no SQL business database.                                                                                      |
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

## Local dependencies intentionally retained after Phase 1

This phase removes normal runtime dependency on local **secret key sources**, not all local state.
The active `TRACECHAIN_DATA_DIR` still contains or may create:

- `applications/company-metadata.json` and `applications/documents.encrypted.json`: legacy/cache
  application records and legacy encrypted attachments.
- `issuance/company-role.json`: Company Role issuance/activation journal.
- `issuance/ingredient-batches.json`: ingredient registration, media and related workflow journal.
- `issuance/production-flow.json`: product production, presentation metadata and workflow journal.
- `issuance/custody-receipts.json`: receipt evidence/reconciliation journal when that flow is used.
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

This stage does not change contracts or rewrite historical chain data. Vehicle numbers already stored
on-chain remain visible; moving them off-chain requires a separate contract/data migration. Catalogue
media remains encrypted under the existing authenticated media flow; public unencrypted media/video
publishing is not newly implemented by this change. New registration documents resolve through the
signed encrypted manifest; the local index remains a legacy source. Only the confirmed applicant or
current authorized Admin can list/download them. Old filename-only registrations require applicant
reattachment; the original on-chain application hash is preserved.
