# DIDComm Stage 1 proof of concept

## Ingredient VP workflow integration

The application-specific `1.0` message contract now also defines
`ingredient-evidence-presentation`, `ingredient-evidence-declined`,
`ingredient-evidence-decision`, and `ingredient-evidence-follow-up`. These are TraceChain message
types, not the standardized Present Proof protocol.

The real Manufacturer EvidenceRegistry request is encrypted to the currently bound Supplier
messaging DID. After explicit Supplier consent, the existing full Ingredient Credential VP is
created by the server-managed Veramo issuer key, checked, recorded through MetaMask, and encrypted
in the browser for the verified Manufacturer DID. This is backend-managed VP signing, not
holder-exclusive signing or selective disclosure.

The VP proof signs TraceChain context containing the exact request ID, ingredient batch, verifier
wallet and purpose, while Veramo verifies the fresh challenge and configured domain. DIDComm
envelope metadata and signed presentation context are checked separately.

EvidenceRegistry is wired once to IngredientRegistry. Acceptance requires the requested batch to
exist, remain a valid traceability source, belong to the named Supplier, and reference the exact
Ingredient Credential submitted for acceptance. This bytecode change requires redeployment and new
configured addresses.

Presentation expiry limits the exchange and acceptance window. After acceptance and product use,
the existing historical traceability rule remains unchanged: consuming the final available
quantity does not by itself invalidate finished-product transferability.

Remaining limitations are holder-controlled VP signing, genuine selective disclosure, Retailer
evidence exchange, production-grade messaging-key rotation/recovery, committed browser E2E tests,
and a complete follow-up/notification UI.

## Scope and protocol

TraceChain uses `@veramo/did-comm` 7.0.2 for one narrow Manufacturer-to-Supplier ingredient-evidence request and encrypted acknowledgement. The library documents DIDComm v2 plaintext, signed, anoncrypt and authcrypt envelopes. This implementation uses authcrypt with `ECDH-1PU+A256KW` and `A256GCM`.

This project does **not** claim complete DIDComm Messaging 2.1 conformance. Veramo labels this API beta and the automated interoperability boundary currently covers two independent Veramo 7.0.2 agents. The wire format is `application/didcomm-encrypted+json`; the API is a same-site HTTPS ciphertext relay, not Bluetooth, offline transport or a DIDComm mediator.

References:

- https://www.npmjs.com/package/@veramo/did-comm
- https://identity.foundation/didcomm-messaging/spec/v2.1/

OpenID4VP is explicitly deferred. DIDComm does not replace VP/VC verification, provide selective disclosure, or make an acknowledgement a Verifiable Presentation.

## Key ownership and binding

Each participant creates a separate Ed25519 `did:key` messaging identity in the browser. Veramo derives/uses the compatible key-agreement representation for authcrypt. It is not the MetaMask transaction key.

The private key exists only in browser memory and in an optional password-encrypted recovery kit downloaded by the participant. It is never submitted to the API, logged, stored on-chain or placed in public IPFS. TraceChain does not persist plaintext messages in browser storage.

Binding requires an authorized SIWE session and a fresh five-minute API challenge. The client signs a DID-JWT containing the exact SIWE wallet, messaging DID issuer, TraceChain domain, chain ID, purpose, nonce and expiry. The API resolves `did:key`, verifies the signature, consumes the challenge, and persists only the public association. This prevents a caller from binding a pasted DID or substituting another company's recipient key.

Rotation repeats the challenge flow while authenticated. Rotation makes earlier envelopes undecryptable unless the old recovery kit is retained. The proof of concept has no social recovery, escrow or automatic multi-device synchronization.

## Message flow

1. Manufacturer and Supplier independently create/bind messaging identities and download recovery kits.
2. Manufacturer selects a verified Supplier from the authenticated directory, enters the business/ingredient references, requested claim names and reason, and explicitly approves sending.
3. The browser authcrypt-packs the message to the Supplier's verified DID.
4. The API checks current SIWE/on-chain authorization, sender binding, recipient binding, roles, timestamps, message ID and supported message type. It stores ciphertext plus routing metadata in `.tracechain/didcomm/state.json`.
5. Supplier restores its key if needed, retrieves its mailbox and decrypts locally. The client checks authenticated sender, recipient, message type, IDs, thread, business references and expiry against relay metadata.
6. Supplier reviews the plaintext and sends an authcrypt acknowledgement in the same thread. The API requires the original accessible request and exact sender/recipient reversal.

Message IDs are globally unique. Duplicate relay IDs are rejected durably. Expired messages, wrong recipients, tampered ciphertext, sender impersonation, unauthorized roles and mismatched acknowledgement threads fail closed.

## Storage and security boundary

The JSON repository preserves public identity bindings, ciphertext envelopes and routing metadata across API restarts without SQL. Routing metadata includes DIDs, message type, IDs, business/ingredient references and timestamps and is visible to TraceChain. Confidential body fields are inside the encrypted envelope.

Encryption cannot protect against malicious frontend code loaded into the participant's browser, browser compromise, stolen recovery kits/passwords, compromised participant devices, or an authorized recipient copying plaintext. HTTPS remains required to protect sessions and relay traffic. Recovery requires both the encrypted kit and its separate password; ciphertext backup alone is insufficient.

The `.tracechain` state is local operational state and must remain ignored by Git. No smart-contract change or blockchain transaction is added for messages.

## Dependency review

`npm audit --omit=dev` reports moderate transitive advisories in `glob`/`minimatch` through Veramo's unused `@veramo/kv-store`/TypeORM dependency path, plus a pre-existing MetaMask `uuid` advisory. TraceChain does not instantiate TypeORM or a SQL store for this feature. npm currently offers only a breaking DIDComm downgrade for the Veramo path and no fix for the MetaMask path, so no forced downgrade was applied. Reassess these advisories when Veramo or MetaMask publishes compatible updates.
