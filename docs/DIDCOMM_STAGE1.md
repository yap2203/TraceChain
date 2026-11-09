# Backend-managed DIDComm messaging

TraceChain uses `@veramo/did-comm` 7.0.2 with authenticated encryption
(`ECDH-1PU+A256KW` and `A256GCM`). The wire representation is
`application/didcomm-encrypted+json`; transport is the same-site authenticated HTTPS API and an
ignored atomic JSON relay, not a DIDComm mediator. This is a tested Veramo DIDComm v2 profile, not
a claim of complete DIDComm Messaging 2.1 interoperability. OpenID4VP remains deferred.

## User and trust model

Evidence screens invoke secure delivery as part of normal request, response and identity-proof
actions. There is no Secure Messages page, messaging-wallet connection, manual decrypt action or
messaging recovery-kit workflow.

The API hosts logically separate `did:key` agents for each participating company. SIWE and current
on-chain authorization identify the actor; trusted stakeholder records determine the recipient.
The API packages with authcrypt, immediately asks the intended recipient agent to unpack, validates
the authenticated sender/recipient/type/thread metadata, then persists only the encrypted envelope
and delivery metadata. Delivery, credential verification and business acceptance remain separate
states.

Both company agents currently run inside the same TraceChain API. Therefore this is **backend-managed
DIDComm messaging with authenticated company access**. It protects envelopes in transport and relay
storage, but it does not provide end-to-end confidentiality from the TraceChain operator. HTTPS is
still required, and a compromised API or participant browser/device remains outside this prototype's
protection.

## Messaging key storage and operations

Backend agent private keys are AES-256-GCM encrypted in
`.tracechain/didcomm/backend-agents.json`. The protection secret comes from the server-only
`IPFS_ENCRYPTION_KEY` configuration and is not stored in that file, exposed through `VITE_*`, sent to
the browser, logged, uploaded to IPFS or written on chain. Use a distinct dedicated secret in a
production key manager before deployment; reusing the prototype content-encryption secret is an FYP
deployment limitation.

The atomic JSON store persists across API restarts. If an identity record exists but its protected
key is missing, damaged or cannot be decrypted, the API fails closed and does not silently replace
the identity. Back up the encrypted agent file and its protection secret separately. Restoration
requires both. Rotation and historical-key retention require a controlled operational migration;
automatic rotation is not implemented.

## Holder presentation keys are separate

Moving DIDComm encryption to the API does not move Ingredient SD-JWT or Company Role presentation
signing keys. Those holder keys remain in the participant browser and are restored from the renamed
encrypted **presentation signing-key backup** when a holder proof is required. Existing Stage 1
recovery files remain readable because their cryptographic format is unchanged. DIDComm decryption
never substitutes for issuer signature, holder binding, challenge, audience, expiry, request,
credential status, batch/Supplier relationship or required-claim verification.

## Legacy records

The inspected local relay contained two browser-controlled messaging identities and six envelopes.
They remain untouched in `.tracechain/didcomm/state.json`. The API never possessed the old private
keys, so it cannot honestly decrypt or re-encrypt those records automatically. They are explicitly
classified as requiring user-assisted migration with the original key. New backend-agent traffic is
separate; inaccessible legacy records are neither deleted nor reported as migrated.

## Privacy boundaries

Routing metadata (company DIDs, message type, request/thread references and timestamps) remains
visible to TraceChain. Sensitive presentations continue to use the existing encrypted content/IPFS
storage and authorized business APIs. A CID is not authorization. Message plaintext and private keys
must not appear in logs, URLs, analytics, calldata or blockchain events.
