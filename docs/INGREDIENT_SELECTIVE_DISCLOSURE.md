# Holder-controlled Ingredient selective disclosure

Implementation date: 2026-11-07

TraceChain uses `@sd-jwt/core` 0.24.3 and the SD-JWT model standardized by RFC 9901 for newly issued Ingredient Credentials. OpenID4VP remains explicitly deferred. MetaMask + SIWE login and the existing DIDComm transport are unchanged.

## Issuance and key ownership

- The Supplier issuer DID signs the Ingredient SD-JWT with the existing Veramo-managed issuer key.
- The credential `cnf.jwk` binds it to the Supplier's registered browser `did:key` Ed25519 public key.
- The browser key is the participant-controlled key already authenticated to the SIWE wallet by the DIDComm binding proof. TraceChain deliberately authorizes this same key for DIDComm authenticated encryption and SD-JWT key-binding signatures; it is not a MetaMask transaction key.
- The private key stays in browser memory and in the password-encrypted recovery kit chosen by the participant. The API never receives it.
- Losing the recovery kit or its password makes the current credential unusable for holder-bound presentations. Key rotation therefore requires a replacement credential; automated replacement issuance is not yet implemented.

## Claims

Always disclosed: ingredient name, exact batch ID, Supplier wallet, and credential ID.

Selectively disclosable when present: country of origin, exact source facility, production date, expiry date, allergen declaration, certification details, quality-test summary, and internal quality remarks. Missing source data is omitted rather than invented.

The Manufacturer marks selected claims Required or Optional. The Supplier sees the request purpose, recipient, actual available values, required claims, and optional toggles before explicit consent. Required claims cannot be removed. The browser produces a presentation bound to the exact request challenge and Manufacturer wallet.

## Verification and transport

The API verifies the issuer signature, trusted credential type, holder signature against `cnf.jwk`, audience, nonce, key-binding age, required disclosures, batch and Supplier binding, credential expiry, deterministic original-credential hash, active on-chain credential record, and exact EvidenceRegistry request. A presentation from a different holder, request, recipient, batch, or Supplier fails closed.

The finished selective presentation is encrypted by the existing content store and delivered through the existing authenticated DIDComm flow. DIDComm protects message transport; it does not itself prove credential claims. Routing metadata can remain visible. TraceChain does not claim protection from compromised frontend code or participant devices.

Legacy JWT Ingredient Credentials remain readable and use the existing full-disclosure VP path. They are labelled full disclosure. New production issuance uses SD-JWT when a wallet-bound participant key exists and refuses to silently move that key to the server.

## Known limitations

- OpenID4VP and DCQL are not implemented.
- Automated credential replacement/key rotation is not yet implemented.
- Current optional source fields are limited by the existing ingredient-registration form; unavailable fields are omitted.
- Filesystem workflow storage remains an FYP prototype, not a production database.
