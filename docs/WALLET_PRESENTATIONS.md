# Wallet-signed encrypted presentations

Implemented 2026-11-23. This replaces DIDComm for new Ingredient Evidence and Company Identity exchanges. MetaMask + SIWE login is unchanged. This is a TraceChain-specific holder proof, not an SD-JWT KB-JWT or an OpenID4VP implementation.

## Storage and discovery

| Content | Shared reference | Storage |
| --- | --- | --- |
| Ingredient information request | EvidenceRegistry requestCid, challengeHash, claimsHash and participants | Encrypted IPFS request/context |
| Ingredient presentation | EvidenceRegistry presentationCid, presentationHash and expiry | Encrypted IPFS exact presentation |
| Selected certification attachment | Issuer-signed, disclosed document CID and SHA-256 | Existing encrypted IPFS attachment |
| Company identity request, including order and delivery contexts | CompanyProofRegistry Requested event and get(requestId) | Encrypted IPFS request/context snapshot |
| Company identity response | CompanyProofRegistry responseCid, responseHash and status | Encrypted IPFS exact presentation |
| Generic company wallet authorization | CompanyProofRegistry bindings(wallet), source VC hash and content hash | Original-issuer-signed wallet attestation on encrypted IPFS |

The API checks the authenticated wallet against chain participants **before** decrypting request/response contents. Attachment access additionally requires a current, cryptographically verified presentation containing that exact file descriptor. Missing local attachment indexes are recovered from its signed CID; unselected files are denied. Response bytes and source credentials are checked against registered hashes. Company snapshots bind chain, registry, request ID, participants, challenge and expiry.

This remains server-managed encryption: the authorized API can decrypt. Pinata stores AES-256-GCM envelopes. Public chain metadata (participants, request IDs, CIDs, hashes, timing/status) remains visible. Never send decryption keys in URLs or to Pinata. No SQL/NoSQL database was introduced.

## Holder proof

`packages/shared/src/wallet-presentation.ts` defines `TRACECHAIN_EIP712_VP_V1`:

```text
{ format, presentation: exactSelectedContent, proof: { context, signature } }
```

The EIP-712 domain is `TraceChain Holder Presentation`, version `1`, configured chain ID and the trusted EvidenceRegistry (ingredient) or CompanyProofRegistry (company) address. Signed fields are proof version, keccak256 of the exact presentation bytes, request ID, holder, intended verifier, purpose hash, fresh challenge hash, batch ID, issue time and expiry. Unknown unsigned envelope/proof fields are rejected. Signing material expires within five minutes and cannot outlive the request or credential. Current verification requires a fresh, unexpired proof; a stored historical success is not ongoing authorization.

The issuer signature and SD-JWT disclosure hashes are verified independently of the recovered Ethereum signer. Verification checks the signed wallet binding, original registered credential hash, disclosed values, requested/required claims, exact context, current credential lifecycle and company role/permission. The request/response lifecycle rejects a different response after publication; retries of the same response do not create business actions. Changing the chain, contract, request, recipient, purpose, challenge, batch, content or signer invalidates the proof.

This uses ethers `signTypedData`/`verifyTypedData` and the EIP-712 domain model. EIP-712 itself does not supply replay protection; the bound request/challenge and contract lifecycle supply it here. References: [EIP-712](https://eips.ethereum.org/EIPS/eip-712), [ethers Signer](https://docs.ethers.org/v6/api/providers/#Signer-signTypedData).

## Credential compatibility

| Credential | New sharing behavior | Migration |
| --- | --- | --- |
| Ingredient SD-JWT v3 | Issuer-signed `cnf.wallet` and `cnf.proof=tracechain:eip712:holder:v1`; MetaMask holder proof | All newly issued ingredient credentials use v3 |
| Ingredient SD-JWT v1/v2 | Original Ed25519 holder proof and key binding remain required | Issuer must issue/register a wallet-bound replacement; wrapping the old token in a wallet proof is rejected |
| Existing full Ingredient JWT VC | MetaMask signs an envelope containing the original full VC; signed supplierWallet supplies binding | No selective disclosure is claimed; full disclosure requires explicit approval |
| Company Role VC | Verified original issuer creates a generic selective v3 wallet attestation referencing the original VC ID/hash/validity and signed company wallet | One-time issuer authorization and holder publication; original signed VC is not modified |
| Historical company/ingredient VPs | Original verification path is retained | Original keys/files may still be needed for old key-bound credentials |

The company attestation is published on the first approved company sharing (MetaMask transaction). First setup requires the original issuer key to be available in the existing environment-backed issuer store. Later sharing uses the published attestation and needs no holder recovery kit. An API without that issuer key fails explicitly if no attestation was published. No new issuer identity is invented. Missing signed registration-country/binding claims may require authorized credential replacement; application metadata cannot silently supply them.

Legacy Ed25519 setup/recovery remains under a separate collapsed **Legacy Ed25519 presentation keys** section. It is not a prerequisite for wallet-bound credentials. A holder can use the same MetaMask account on another device. TraceChain does not request its seed phrase or MetaMask password.

## UI flow

1. Manufacturer/Retailer creates an ingredient information request through the existing screen and confirms its request-reference transaction.
2. Supplier opens **Information requests → Received requests**, previews actual values, selects optional claims/files and explicitly approves sharing. MetaMask signs the presentation, then confirms a separate response-reference transaction.
3. Requester opens received evidence, views only disclosed values/files, verifies the proof, then separately accepts/rejects the business evidence. Verification does not move stock or approve an order.
4. Supplier can request the requesting company's identity from ingredient or order screens. Distributor can request Supplier/Manufacturer identity for custody/delivery. Existing order/delivery challenge recording is followed by a separate shared-request publication transaction. If the second prompt is rejected, retry the same request to publish its missing reference.
5. Presenter previews the company claims and approves MetaMask signing. First use can also require the one-time attestation-publication transaction. A separate transaction records the encrypted response CID.
6. Verifier checks the response and confirms the review reference. Order/delivery business attestation remains a separate existing action; shared proof review never approves an order or accepts custody automatically.

New company proof material is unavailable until its shared request reference is confirmed. An unconfirmed local request must be published by its requester. Information-request cards can open shared company proofs without requiring an original backend's local custody-offer journal.

## Deployment compatibility

- Existing EvidenceRegistry deployments with requestCid, presentationCid, challenge/claims/presentation hashes and the current getter ABI can use new Ingredient wallet proofs **without redeploying that registry**.
- Company proofs require the new **CompanyProofRegistry**. It is a companion to the existing StakeholderRegistry; no modification of the original VC or existing contract is required just to add shared proof discovery.
- Existing order/delivery business operations still require the deployed suite ABI used by this checkout. The companion does not upgrade immutable older Orders/Delivery contracts. Deploying this repository's full module gives a consistently wired current suite. Existing historical records are not copied into a new suite.
- `ignition/modules/TraceChain.ts` includes the companion. `configure:sepolia` validates its stakeholder wiring and writes COMPANY_PROOF_REGISTRY_ADDRESS when present. For an older journal without the companion it leaves that setting empty; new company proofs then fail with an explicit configuration message.
- Standalone companion: use `ignition/modules/CompanyProofs.ts` with parameters `{ "CompanyProofs": { "stakeholderRegistry": "<existing trusted address>" } }`. For local validation, from packages/contracts:

```powershell
npx hardhat ignition deploy ignition/modules/CompanyProofs.ts --network localhost --parameters <parameters-file> --deployment-id company-proofs-local
```

Set root COMPANY_PROOF_REGISTRY_ADDRESS to that companion's address and restart the API. Keep the same chain and existing suite addresses. The standalone deployment is not automatically imported by configure:sepolia; configure its validated companion address separately. Public deployment requires separate authorization and was not performed.

## Historical data and remaining local state

New migrated flows do not call DIDComm send/relay. Those POST routes and the frontend evidence-DIDComm adapter were removed. DIDComm directory/mailbox and binding routes remain for historical recovery and legacy Ed25519 holder binding. Existing DIDComm service files, envelopes, backend keys and participant recovery kits were preserved.

Old messages still depend on the original DIDComm state and company-agent decryption keys. Historical requests with usable on-chain encrypted references remain recoverable; purely local or unpublished legacy company-proof records still need their original backend until their requester publishes a shared reference. Never delete the historical files as part of this upgrade.

Local files still hold unfinished transaction/retry journals, legacy records and lookup caches; issuer keys use the existing encrypted files and backend environment KMS secret; SIWE sessions remain in memory. Pending/unconfirmed custody offers and unrelated workflows may still require their original local journal. The migrated confirmed proof references, credentials and selected attachment reads do not require those JSON lookups. The holder-signature change does not make the API or frontend safe against malicious code or a compromised participant device.

## Verification and manual checks

Automated exchange tests use real Veramo issuer signatures, EIP-712 wallet signatures and AES-GCM with separate data directories. Shared chain gateways and the Pinata HTTP transport are test doubles; companion lifecycle is separately tested on real local EVM contracts. HTTP tests stop A, start empty B, then restart A for ingredient and Manufacturer/Retailer order plus Supplier/Manufacturer delivery company proofs. They do not constitute a live Sepolia/Pinata or full-browser MetaMask end-to-end test.

Run from repository root after building shared and SSI:

```powershell
npm run build
npm run test:ssi
npm exec --workspace @tracechain/api -- vitest run src/modules/production-flow src/modules/ingredient-batches src/modules/orders src/modules/didcomm
npm exec --workspace @tracechain/web -- vitest run src/features/production-flow src/features/orders src/features/workspaces/supplier/evidence src/features/workspaces/manufacturer/evidence src/features/workspaces/retailer/evidence src/features/workspaces/shared/StakeholderCredentialPage.test.tsx
npm run test:contracts
npm run typecheck
```

For live local acceptance, keep one local chain running and two separately configured API data directories pointing to the same suite and encrypted IPFS key. Configure each API with the original backend secrets and matching issuer files, and authenticate each browser separately with SIWE. Publish company wallet attestations on A before testing a verifier-only B. Create a request on A, stop it, open and answer on B, restart A and verify. Repeat through order and custody/delivery identity screens; business acceptance remains separate. Check a selected attachment opens on B while an unselected file ID is denied. Use a fresh browser with the same MetaMask account and no holder kit. Finally reject wallet prompts, change account/network, expire requests, suspend a presenter and retry a confirmed response. No action should silently fall back to backend signing or DIDComm delivery.

Automated negative coverage includes wrong signer/context/domain/recipient, changed disclosures, missing legacy key proof, expiry, replay, suspension/revocation, unauthorized request/file access, attachment hash/context checks, unselected claims and wallet rejection. Live full-app two-process/Pinata and physical MetaMask acceptance remains an operator acceptance check.

## Delivery inventory and executed checks

- Shared proof contract/types: `packages/shared/src/wallet-presentation.ts`, shared exports, `CompanyProofRegistry.sol`, `CompanyProofs.ts`, the full TraceChain module, companion tests and Sepolia configuration script.
- SSI: ingredient v3 issuance/verification and company wallet attestation issuance/verification in `packages/ssi/src/credentials/ingredient-sd-jwt.ts` and `company-identity-sd-jwt.ts`; SSI exports and cryptographic tests.
- API: production-flow service/gateway/repository/controller/router, new company-proof gateway, Orders identity/inbox handling, ingredient issuance, encrypted-content retrieval and app wiring. Removed DIDComm send/relay routes while preserving historical services.
- Web: new wallet/company signing helpers, cross-device setup panel, company presentation action, Ingredient selective-disclosure screen, Orders/Delivery identity screens, shared Information Requests, credential profile and ingredient creation text. Removed the obsolete evidence-DIDComm transport adapter and unused frontend send/relay methods. Updated affected screen tests and added wallet-signing/approval tests.
- Configuration/documentation: `.env.example`, README, DECISIONS, PROGRESS and this guide. The active `.env`, historical state and key files were untouched.

Executed successfully for this change:

| Check | Result |
| --- | --- |
| Scoped API suites: production-flow, ingredient-batches, orders, didcomm, auth, ssi | 293 tests |
| Scoped frontend suites: production-flow, orders, supplier/manufacturer/retailer evidence, identity card, wallet authentication and login presentation | 160 tests |
| Complete SSI suite | 29 tests |
| Complete contract suite on local EDR | 74 tests: 3 Solidity and 71 Mocha |
| Root `npm run build` | Passed shared, SSI, API and web |
| Root `npm run typecheck` | Passed all five workspaces |

The web build retains bundle-size and third-party `use strict` directive warnings. Tests use synthetic keys/data. No live Pinata upload, public transaction, full-app browser automation, commit or push was performed.
