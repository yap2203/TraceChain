# Backend environment startup and issuer recovery

Updated 2026-11-23. This supersedes the runtime Admin-keystore unlock flow. It is an off-chain change; existing contracts, MetaMask/SIWE and presentation signatures are unchanged.

Subsequently, after losing the bundle password, the user explicitly requested a fresh test identity.
The active ignored environment now selects `.tracechain/sepolia-fresh-20261123-*` with new keys;
the prior environment is preserved in `.tracechain/recovery/recreate-20261123-*` and the old data
directories/bundles remain intact. That is a new issuer, not recovery of the lost one. The inspection
and recovery limitations below describe the preserved original profile. Do not restore its secrets
over the fresh profile or mix credentials from the two issuers; select the matching complete profile.

## Normal startup

Configure these **original** backend secrets:

```dotenv
IPFS_ENCRYPTION_KEY=replace-with-the-original-64-hexadecimal-characters
VERAMO_KMS_SECRET_KEY=replace-with-the-original-64-hexadecimal-characters
```

Both are exactly 32 bytes encoded as 64 hexadecimal characters, without a `0x` prefix. Set them in a protected process environment/secret manager. Local operators can use ignored `apps/api/.env.runtime`; the ignored root `.env` remains supported. Loading priority is process environment, API `.env.runtime`, then root `.env`. These secrets have no `VITE_` prefix and must never be exposed to the browser. Preserve restrictive filesystem permissions/Windows ACLs and a separate secure backup. Example files contain placeholders only.

Keep `TRACECHAIN_DATA_DIR` pointed at the correct deployment's existing data, with:

- `veramo/private-keys.json`: existing Veramo SecretBox-encrypted private keys.
- `veramo/public-data.json`: matching DID, authority alias and public-key metadata.
- `veramo/public-data.credentials.encrypted.json`, if present: existing encrypted cache, opened with its original KMS secret.
- Existing historical DIDComm key files, encrypted documents, journals and other data. The original IPFS key also decrypts backend DIDComm keys where used.

Keep the configured `TRACECHAIN_AUTHORITY_DID_ALIAS`, SSI RPC and IPFS provider configuration. Run `npm run build` then `npm run dev:api`, or `npm run start --workspace @tracechain/api` for the compiled API. Startup validates secrets, decrypts/checks saved key material against public metadata, requires the existing authority DID and opens the encrypted cache before listening. Missing/mismatched issuer material is an `ISSUER_RECOVERY_REQUIRED` error; it never triggers creation of a replacement authority. Missing/invalid secrets produce a safe `BACKEND_CONFIGURATION_INVALID` message without logging their values.

There is no runtime unlock, upload, export or lock page. All `/api/admin/keystore` endpoints are removed. SIWE sessions remain process-local, so users sign in again after restart; they do not wait for an operator unlock. Current on-chain authorization and private-record ownership checks still apply.

## One-time offline restore from an existing Admin bundle

Stop the API before recovery. Keep the latest encrypted `tracechain-admin-keystore*.json` and its password separately. The old format contains the IPFS key, KMS secret and encrypted private-key store, **not matching public DID metadata**. Recover the matching `public-data.json` from the original data directory or a trusted backup. Never guess an authority alias or reconstruct an issuer by creating a new DID.

The inspection performed for this change found:

- Active `.tracechain/sepolia/veramo/public-data.json` and `private-keys.json` absent.
- Required environment secrets not valid in the active configuration.
- An encrypted bundle at `C:\Users\User\Downloads\tracechain-admin-keystore.json`, modified 2026-11-21.
- Possible public metadata backups in `.tracechain/sepolia.backup/veramo` and `.tracechain/veramo`.

These are **candidates**, not verified matching recovery sources. The encrypted bundle could not be compared without its password. File timestamps alone do not establish which issuer material is current. Nothing in the active installation was restored or rotated by this implementation.

From the repository root, perform a **read-only** comparison, substituting the matching metadata path:

```powershell
npm run keys:restore -- --bundle="C:\Users\User\Downloads\tracechain-admin-keystore.json" --metadata=".tracechain/sepolia.backup/veramo/public-data.json"
```

The terminal prompts for the existing bundle password with input hidden. Do not put passwords or keys in arguments, screenshots, logs or chat. The command verifies the encrypted bundle, decrypts each saved private key, checks its public metadata and authority DID, then reports counts of added/changed encrypted entries compared with the configured data directory. Changed ciphertext is not proof of newer key material. No files are written in comparison mode.

If metadata is incomplete or mismatched, stop and find its correct latest backup. The tool will not invent missing key aliases/DIDs. It also refuses a bundle that would remove saved keys, or one whose secrets conflict with already configured valid secrets. Resolve such conflicts using the trusted original backup, not newly generated secrets.

After the comparison succeeds and you have verified the source is the latest trusted backup, repeat with `--restore`:

```powershell
npm run keys:restore -- --bundle="C:\Users\User\Downloads\tracechain-admin-keystore.json" --metadata=".tracechain/sepolia.backup/veramo/public-data.json" --restore
```

Restore does the following:

1. Backs up existing target key/metadata files and API `.env.runtime` to a unique `TRACECHAIN_DATA_DIR/recovery/<timestamp>-<id>` directory.
2. Preserves an exact encrypted bundle copy there and leaves the source bundle unchanged.
3. Writes the encrypted private-key store and matching DID/key metadata atomically per file. Readable VC/VP caches are not copied into the public metadata file.
4. Writes the original two secrets to ignored `apps/api/.env.runtime`, preserving unrelated entries. Nothing prints the secrets. Process-environment values still take precedence; ensure those deployment values match.

If interrupted between files, keep the API stopped and use the preserved backup/repeat the validated restore; per-file atomic writes are not a multi-file transaction. Protect the recovery directory as carefully as the original secret files, especially the `.env.runtime` backup. Unix file modes are applied where supported; Windows operators must enforce their usual account/ACL restrictions. Never commit any recovery file.

Start the API, authenticate with the same company wallet and open a known encrypted application/credential. Verify an older VC. Issue only a synthetic credential in local/test configuration and confirm its issuer DID is unchanged. Restart and repeat without visiting any Admin unlock page. Do not rotate keys or redeploy contracts for this migration.

## Ongoing operator backups

The existing offline `npm run keystore:migrate -- --output=C:\secure\tracechain-admin-keystore.json` command remains as a compatibility backup utility. It now validates the saved issuer before exporting; the destination must be new. Keep a **matching public metadata backup** with every export. The old bundle does not contain public metadata. Normal runtime persists newly created supplier/issuer keys to the encrypted private-key file, so also back up that file and metadata after issuer changes. Protect environment secrets separately; never replace them just because a file is unavailable.

Hardhat's deployment keystore is independent and unchanged. Holder Ed25519 recovery kits are also separate and remain supported for legacy credentials; wallet-bound EIP-712 proofs still use MetaMask. Historical encrypted bundles, DIDComm state, IPFS pins, data directories and on-chain records were not deleted.

## Local verification

`apps/api/src/config/backend-runtime.test.ts` tests startup configuration errors, missing/corrupt/mismatched issuer material, original issuer signing after restart, older VC verification, offline bundle comparison/restore with preserved backups, encrypted document access and cross-company denial, removed HTTP endpoints, and starting/restarting the actual compiled API process without an Admin action.

Build before the subprocess tests:

```powershell
npm run build
npm exec --workspace @tracechain/api -- vitest run src/config/backend-runtime.test.ts
```

Tests use synthetic keys, temporary directories, a local DID resolver, stubbed Pinata transport and authorization gateways. The actual API-process startup test uses the configured environment and saved synthetic issuer files, with no unlock calls. No live Pinata upload, chain transaction or real issuer credential issuance is part of validation. Real-installation retrieval/issuance remains an operator acceptance check until its original keys and metadata have been recovered.

Executed for this change: all 466 API tests (including eight startup/recovery cases), all 410 frontend
tests and all 29 SSI tests passed. The full frontend suite passed with two workers after a concurrent
run hit one test timeout. Root production build and API/web/SSI type checks passed. Existing web
bundle-size/third-party directive warnings remain. The compiled API was also run with the current real
configuration and correctly exited before listening with a safe IPFS_ENCRYPTION_KEY configuration
error. No real issuer material, active environment value, original encrypted bundle or chain record was
modified; actual bundle comparison/restore still requires the operator's hidden password prompt.
