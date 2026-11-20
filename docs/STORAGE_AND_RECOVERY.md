# Storage and recovery

Updated 2026-11-16. Backend-key backup controls and their dedicated HTTP endpoint have been removed.

## Current storage boundaries

| Data                                                                                     | Storage and protection                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles, permissions, applications, credential status/expiry                               | Deployed registries: IDs, hashes, encrypted content references and status. New application references point to a complete encrypted manifest rather than a server-local path.                                                                                  |
| Company application profile, contacts, representative, documents and optional logo       | Canonical versioned manifest plus independently encrypted attachments in the configured IPFS store. The applicant signs the full content digests and final manifest CID/hash. Local application JSON is only a legacy/cache source.                            |
| Batches, ingredient links, quantities/units, orders, physical custody and receipt events | Blockchain. Contract state and events remain visible to chain readers.                                                                                                                                                                                         |
| Company and Ingredient VCs; private evidence and metadata                                | AES-256-GCM envelopes pinned to IPFS. `IPFS_ENCRYPTION_KEY` decrypts them. The API authorizes access; it can decrypt this server-managed content.                                                                                                              |
| Veramo issuer/DID metadata                                                               | `.tracechain/veramo/public-data.json` contains DID/public-key metadata only.                                                                                                                                                                                   |
| Veramo VC/VP/claim/message cache                                                         | `.tracechain/veramo/public-data.credentials.encrypted.json`, authenticated encryption using a domain-separated key derived from `VERAMO_KMS_SECRET_KEY`. This preserves Admin bootstrap/export lookups without readable VC copies in the public metadata tree. |
| Issuer private keys                                                                      | Separate existing `private-keys.json`, protected with Veramo SecretBox/KMS.                                                                                                                                                                                    |
| Workflow journals and DIDComm delivery                                                   | Existing local JSON repositories, with sensitive payloads encrypted. They remain necessary off-chain state; there is no SQL business database.                                                                                                                 |
| Company-agent messaging keys                                                             | Backend encrypted key store; backend DIDComm encryption/decryption stays server-managed.                                                                                                                                                                       |
| SIWE sessions/nonces                                                                     | Backend memory and an HttpOnly session-ID cookie. API restart requires signing in again.                                                                                                                                                                       |
| Holder presentation-signing key                                                          | Browser memory while active; password-encrypted holder recovery-kit download for persistence. This is separate from backend storage keys and MetaMask's Ethereum key.                                                                                          |

### Legacy Veramo migration

On SSI agent initialization, `credentials`, derived `claims`, `presentations` and `messages` are
moved out of the public JSON tree into the encrypted data cache. The encrypted file is written
and read back successfully before those collections are removed from public metadata. Conflicts
or unreadable encrypted files stop migration without discarding the legacy copy. DID/public-key
metadata and the separate issuer-key store are preserved. Do not change the KMS key to bypass an error.

Explicit historical holder exports are separate files; this migration does not silently delete them.
Restart an API still running older code so it cannot write through an old in-memory store.

## Server-operator backups

Backend IPFS/KMS key export and restore checks are not exposed in the Admin workspace or HTTP API.
The former POST /api/ssi/storage-key-backup endpoint is removed, including export and verification.
Existing passwords, keys, encrypted key files and already downloaded backups are unchanged.

The server-only key-backup.ts encryption/decryption helpers and credential-pin-check.ts validation
helper are retained for existing operator procedures and compatibility with encrypted backups.
They are not wired into application routes or services. No new operator CLI is introduced.
Existing operator backup procedures remain independent of the browser application.

A key backup is not a data backup. Preserve encrypted issuer-key files, encrypted SSI cache,
necessary workflow journals and deployment references separately. Preserve the existing IPFS/KMS
secrets securely outside the repository; never rotate them merely to resolve a login problem.

Different browsers can use one shared API deployment without sharing browser storage. Separate API
machines can read the same application only when they use the same chain ID, registry addresses,
IPFS gateway/pins and authorized `IPFS_ENCRYPTION_KEY`. Keep that key and all pinning credentials in
protected backend configuration; they are never placed in the manifest, frontend code or Ethereum.

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

A newly generated unrelated key cannot replace the bound key merely because the same wallet logged
in. A wrong kit password, wrong holder, changed recipient/challenge, or revoked credential must fail.
The backend-key backup file and holder-signing kit are intentionally not interchangeable.

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
