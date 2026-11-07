# Stage 1 holder identity compatibility assessment

> Scope update: OpenID4VP is deferred. The selected Stage 1 implementation is the narrowly scoped browser-held DIDComm proof of concept documented in `docs/DIDCOMM_STAGE1.md`.

Assessment date: 2026-11-07

This document records compatibility research only. It does not approve a new architecture or make a mobile application mandatory. MetaMask + SIWE remains TraceChain's website login.

## Current TraceChain credential

The Company Role Credential is a W3C VC 1.1-shaped credential secured as a Veramo `JwtProof2020` JWT. Its subject is fixed to `did:ethr:sepolia:<SIWE wallet>` and it includes the same EVM wallet in `credentialSubject.walletAddress`.

This proves that the authority signed claims about the registered company wallet. It does **not** bind the credential to a separate holder-controlled presentation key:

- there is no `cnf`/holder public-key claim;
- the subject DID has no separately registered presentation key;
- the API currently owns the Veramo keys used by existing evidence presentations;
- a MetaMask transaction or SIWE signature must not be relabelled as an OpenID4VP holder proof.

The signed credential must never be modified. A wallet may import it as a bearer-style W3C JWT VC, but a Stage 1 presentation must separately prove control of a holder DID and bind that DID to the authenticated company wallet. A later key-bound credential requires explicit replacement issuance with a new credential identifier and preserved history.

## Candidate results

### Masca 1.4.0 — browser candidate, not selected

Masca is an existing MetaMask Snap listed in the official Snaps directory. It derives Snap-specific keys and stores identity data on the user's device. It is not an Android application TraceChain would maintain.

The stable 1.4.0 release added an `opendi4vp://` handler (spelling from its release note). The repository also publishes newer OIDC packages as beta. The available primary documentation does not establish final OpenID4VP 1.0 DCQL request/response behavior, required holder binding for TraceChain's JWT VC, or DIDComm Messaging 2.1 interoperability. Therefore the Snap is not currently safe to select for this scope without an executable interoperability test.

References:

- https://snaps.metamask.io/snap/npm/blockchain-lab-um/masca/
- https://github.com/blockchain-lab-um/masca/releases

### walt.id Wallet SDK 1.2.1 — compatible mobile SDK, not a browser wallet

The current repository release inspected was 1.2.1 (2026-11-03). Official SDK documentation states OpenID4VP 1.0 with DCQL, W3C VC support, P-256 `did:jwk` signing identities, encrypted on-device persistence, platform-protected keys, explicit preview/consent/submit sessions, and backup/restore support.

This is a headless SDK, not an already usable TraceChain wallet. Adopting it means building and maintaining a separate Android/iOS application: screens, branding, consent, PIN/biometric policy, QR/deep-link handling, application signing, releases, support, backup UX, and recovery guidance. Android exposes OpenID4VP through its Digital Credentials API. The documented iOS third-party Digital Credentials integration currently exposes ISO 18013-7 rather than OpenID4VP.

No Android-dependent work is authorized by this assessment.

References:

- https://github.com/walt-id/waltid-identity/releases/tag/1.2.1
- https://docs.walt.id/community-stack/mobile-wallet/getting-started
- https://docs.walt.id/community-stack/mobile-wallet/architecture
- https://docs.walt.id/community-stack/mobile-wallet/digital-credentials-api

### walt.id Wallet API v2 — rejected for holder-controlled mode

The official documentation describes Wallet API v2 as custodial. Its server/API controls wallet state and keys, so it cannot satisfy TraceChain's requirement that presentation keys remain under the holder's control. It may not be substituted for the mobile SDK.

Reference: https://docs.walt.id/community-stack/wallet/capabilities

## Protocol and messaging result

OpenID4VP 1.0 final uses DCQL and supports `vp_token`, nonce/state correlation, direct-post responses, and format-specific holder binding. TraceChain must not use older `presentation_definition` examples while claiming final-version DCQL compatibility.

Reference: https://openid.net/specs/openid-4-verifiable-presentations-1_0.html

DIDComm Messaging 2.1 is the selected protocol target. Veramo 7.0.2 publishes a DIDComm v2 plugin, but labels the API beta; no verified browser-wallet combination found in this assessment establishes holder-controlled DIDComm 2.1 keys plus interoperability with the OpenID4VP wallet. Masca does not document the required DIDComm capability. Consequently, no DIDComm success path should be implemented or displayed until two independently controlled participant agents pass pack/unpack, wrong-recipient, tamper, expiry, replay, and thread-correlation tests.

References:

- https://identity.foundation/didcomm-messaging/spec/v2.1/
- https://www.npmjs.com/package/@veramo/did-comm

## Platform-neutral work that can proceed

1. Keep SIWE login and on-chain authorization unchanged.
2. Define short-lived OpenID4VP 1.0 request state, DCQL query, correlation, replay prevention, and fail-closed verification behind wallet-adapter interfaces.
3. Add an authenticated, consent-based endpoint that retrieves the current signed VC for wallet import without claiming OpenID4VCI.
4. Model a separate, challenge-proven association between the SIWE wallet, holder DID, purpose, TraceChain origin, chain, registry, and expiry.
5. Keep messaging identity/key agreement separate from the presentation DID.
6. Do not expose a working UI action until a real holder wallet passes interoperability tests.

## Recovery implications

Backing up encrypted credentials alone does not recover signing or DIDComm decryption keys. A selected holder wallet must provide an explicit signing-identity backup/restore mechanism. Rotation requires a fresh wallet-authenticated binding proof and invalidation of the previous association. Existing signed credentials remain immutable; replacement credentials require new identifiers and normal authority approval.
