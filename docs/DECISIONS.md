# Project Decisions

## Repository and implementation

- Use one GitHub repository as an npm monorepo.
- Work directly on `main`; do not create additional branches unless requested later.
- Use npm workspaces with the folder structure `apps/*` and `packages/*`.
- Use TypeScript for React, Express, Veramo integration, shared code, and contract tooling.
- Use Solidity for smart contracts.
- Use React Router for frontend route composition.
- Organize frontend implementation by feature with shared UI and layout components.
- Use Ethers.js for Ethereum wallet, contract, and address utilities.
- Use the SIWE package for ERC-4361 message construction and verification.
- Use Vitest and Supertest for API authentication tests.
- Keep Hardhat in `packages/contracts`.
- Use one ignored repository-root `.env` and one tracked root `.env.example`; Vite exposes `VITE_API_BASE_URL` plus explicitly selected public `CHAIN_*` values, while the API loads the same file through a repository-relative absolute path. All other variables remain server-only.
- Use Hardhat 3 with Solidity 0.8.34, ethers, Mocha, Ignition, and Foundry-compatible Solidity tests for the current contract workspace.
- Treat the included Counter contract, tests, deployment module, and scripts as toolchain starter code rather than TraceChain business contracts.

## Blockchain-first data architecture

- Build TraceChain without a centralized SQL business database.
- Describe the architecture as **blockchain-first with no centralized SQL business database**, rather than claiming that every value is stored on-chain or that the system has no off-chain storage.
- Use Ethereum Sepolia as the authoritative development ledger for stakeholder roles, credential statuses, batch relationships, custody transfers, and receipt confirmations.
- Use Solidity contracts to enforce role permissions and valid supply-chain state transitions.
- Store only hashes, content identifiers, status values, references, quantities, relationships, and traceability events on-chain.
- Never store complete credentials, private keys, recovery phrases, plaintext supporting evidence, or other sensitive identity data on-chain.
- Avoid MySQL, PostgreSQL, SQLite, SQL Server, TypeORM SQL storage, and other centralized SQL databases for authoritative TraceChain business records.
- Allow optional Veramo metadata to use a non-SQL local format or reconstructable configuration after its exact storage design is confirmed.

## Technology responsibilities

| Technology         | Confirmed responsibility                                                              |
| ------------------ | ------------------------------------------------------------------------------------- |
| Hardhat            | Compile, test, debug, and deploy Solidity contracts during development                |
| Ethereum/Sepolia   | Maintain authoritative role, status, and traceability records                         |
| Solidity contracts | Enforce permissions and business rules                                                |
| Ethers.js          | Connect the frontend and API to Ethereum                                              |
| Veramo             | Create, issue, present, and cryptographically verify DIDs and credentials             |
| MetaMask           | Protect wallet keys and sign SIWE messages and blockchain transactions                |
| IPFS               | Store encrypted credentials, evidence, photographs, and reports                       |
| React              | Provide the user interface                                                            |
| Express API        | Coordinate authentication, Veramo verification, IPFS references, and blockchain reads |

## Blockchain gateway and transaction signing

- Store configurable operational permissions by stakeholder role in `StakeholderRegistry`; require System Admin MetaMask transactions for every permission grant or removal, while keeping System Admin authority and structural custody-route constraints non-removable.

- Keep blockchain RPC URLs, deployed contract addresses, ABIs, and authoritative reads in the Express API rather than duplicating contract configuration in the frontend.
- Expose narrowly scoped API operations that validate inputs and prepare unsigned contract transactions.
- Return only the target chain ID, contract destination, calldata, and value required for a prepared transaction.
- Require MetaMask to sign and broadcast each user-authorized write so the stakeholder wallet remains Solidity's `msg.sender`.
- Never send wallet private keys to the API and never use a backend wallet to impersonate stakeholder transactions.
- Require an authorized SIWE session and matching role for protected reads and privileged transaction preparation.

Hardhat is development tooling. It is not the production blockchain and does not replace persistent storage.

## Identity and role authorization

- MetaMask proves control of a wallet address; it does not issue credentials or determine a stakeholder role.
- Use Company Role Credentials together with an on-chain stakeholder registry for role-based access control.
- Require Veramo to verify the credential signature, trusted issuer, holder or subject binding, expiry, suspension, and revocation before the application trusts role claims.
- Check the verified credential hash and current status against Ethereum before authorizing sensitive operations.
- Require smart contracts to check `msg.sender` and its assigned on-chain role before changing authoritative state.
- Treat frontend route restrictions as usability controls only. Every sensitive API request and contract transaction must be independently authorized.
- Never derive authority from a URL, frontend fixture, wallet address alone, or browser storage.

The target authorization sequence is:

```text
MetaMask proves wallet ownership
            ↓
Holder presents Company Role Credential
            ↓
Veramo verifies issuer, signature, subject, expiry, and status
            ↓
Application checks credential hash and status on-chain
            ↓
Smart contract checks msg.sender and assigned role
```

## SSI foundation

- Use `did:ethr` on Ethereum Sepolia (chain ID `11155111`).
- Use JWT as the initial Verifiable Credential and Verifiable Presentation proof format.
- Use `@veramo/data-store-json` for non-SQL local SSI metadata and issuer credential storage.
- Store Veramo private key material in a separate JSON tree encrypted at rest with `PrivateKeyStoreJson` and `SecretBox`.
- Treat `@veramo/data-store-json` as a beta package acceptable for this FYP prototype, not automatically as an industry production recommendation.
- Use a server-managed Product Traceability Authority issuer DID.
- Keep stakeholder wallet keys, including the bootstrap Admin wallet key, controlled by MetaMask.
- Keep the bootstrap Admin Company Role Credential off-chain.
- Require future on-chain credential-hash and status verification before enabling role-based access control.
- Defer IPFS integration to a later phase.

## Target smart-contract boundaries

- `StakeholderRegistry` manages company approval, wallet-to-role mappings, role assignment and removal, credential references, and replacement of lost or compromised company wallets.
- `CredentialRegistry` manages credential hashes, IPFS CIDs, expiry, suspension, and revocation status.
- `IngredientRegistry` manages supplier ingredient batches and evidence references.
- `ProductRegistry` manages product batches and product-to-ingredient relationships.
- `CustodyTransfer` manages intended receivers, quantities, transfer state, and receipt confirmation.
- Other contracts must query the stakeholder registry or use a proven access-control library before permitting role-restricted operations.
- Smart-contract records represent custody and traceability; they do not claim to determine legal ownership.

The intended contract layout is:

```text
packages/contracts/contracts/
  access/StakeholderRegistry.sol
  credentials/CredentialRegistry.sol
  traceability/IngredientRegistry.sol
  traceability/ProductRegistry.sol
  traceability/CustodyTransfer.sol
  interfaces/IStakeholderRegistry.sol
```

## Custody-transfer QR locator

- Use the versioned canonical URI `tracechain://transfer/v1?chainId={chainId}&contract={custodyTransferAddress}&transferId={transferId}` for custody-transfer QR payloads.
- Keep the payload limited to the configured chain ID, CustodyTransfer deployment address, and existing bytes32 transfer ID. It is a locator, not trusted transfer data or an authorization token.
- Never put quantities, product data, credentials, JWTs, company data, private documents, encryption keys, wallet secrets, or receipt data in the QR payload.
- Treat every decoded field as untrusted until the authenticated API resolves `getTransfer(transferId)` against the configured CustodyTransfer contract.
- Require the API to verify the configured chain and contract, transfer existence, `AwaitingReceipt` status, and that the authenticated SIWE wallet is the on-chain recipient.
- Require receipt confirmation through a separate MetaMask-signed transaction. Scanning alone must never change custody.

## Credential and evidence storage

- Encrypt complete credentials, supporting documents, photographs, and reports before uploading them to IPFS.
- Treat an IPFS CID as a content-addressed integrity reference, not a password or access-control mechanism.
- Use authenticated encryption such as AES-256-GCM for sensitive IPFS content.
- Never upload plaintext credentials, private keys, or recovery phrases to IPFS.
- Never store an encryption key beside the encrypted content it unlocks.
- Minimize public metadata and use non-descriptive filenames.
- Pin important content through at least two independent nodes or services and periodically test retrieval.
- Treat published IPFS content as potentially permanent, even after unpinning.
- Use on-chain revocation or suspension status to invalidate credentials because deleting every IPFS copy cannot be guaranteed.
- Keep wallet private keys and recovery phrases under the user's MetaMask control only.

The target storage flow is:

```text
Credential or evidence
        ↓
Encrypt on an authorized user's device
        ↓
Upload encrypted bytes to IPFS
        ↓
Receive CID
        ↓
Record CID, integrity hash, and status on Ethereum
```

## Authentication and transient state

- Use ERC-4361 Sign-In with Ethereum for wallet authentication.
- Reuse MetaMask's injected EIP-1193 provider for browser-extension connections, including existing authorized accounts, and use the official `@metamask/connect-evm` client for Mobile QR and extension fallback. Keep one connection attempt active, use bounded timeouts, retry one stale SDK transport once after disconnecting only that transport, and skip duplicate EIP-6963 announcement from SDK clients owned directly by TraceChain.
- Present Browser extension and Mobile QR tabs so the user explicitly selects the transport. Clear only MetaMask Connect's persisted transport-choice marker before a mobile connection so an earlier extension choice cannot override the QR tab, while preserving the existing SIWE proof flow.
- Access nonce and session storage through repository interfaces.
- Use development-only, in-memory nonce and session repository implementations for the current demonstration.
- Keep authentication state short-lived.
- Recheck on-chain role and revocation state before sensitive operations.
- Document that in-memory state disappears after an API restart and cannot support multiple API instances without shared transient storage or a different token design.
- Temporarily allow stakeholder sample pages and simulated UI interactions without account validation only on local Vite development hosts. Production credential checks and backend authorization remain fail-closed.
- Use the SIWE session wallet as the only wallet input for Company Role Credential verification; never trust a wallet address in the credential-presentation request body.
- Store only a safe local-verification summary in the development session, never the credential or encoded JWT.
- Keep `onChainStatusChecked` and `authorizationReady` false after local verification, so no production workspace is unlocked before registry checks exist.
- Use one shared `CompanyRole`-to-workspace mapping for future authorization decisions.
- Deliver the bootstrap Admin credential through an explicit development-only export under ignored `.tracechain/holder/` storage, with no silent overwrite of a different credential.

## Recovery requirements

- A credential hash or blockchain record cannot reconstruct a lost credential, wallet key, DID key, or encryption key.
- If a credential is lost while the registered wallet remains available, require a signed reissuance request, revoke the previous credential, issue a replacement, encrypt it, upload it to IPFS, and register the new reference and status.
- If a wallet is lost, require independent company re-verification before disabling the old wallet, assigning the role to a new wallet, revoking the old credential, and issuing a replacement.
- If a DID key is lost, rotate and revoke it when supported by the selected DID method; otherwise create a new DID and reissue the credential.
- Avoid making an organizational stakeholder dependent on one employee's device.
- Plan for multiple authorized operators, a company recovery contact, and stronger approval such as multisignature authorization for high-risk recovery operations.

## Confirmed limitations

- Public Ethereum state is visible and expensive.
- IPFS does not provide confidentiality or guaranteed retention by itself.
- Encryption cannot provide recovery when the only decryption key is lost with a device.
- In-memory or stateless authentication makes immediate token revocation and horizontal scaling harder.
- Direct blockchain queries can be slower than indexed database queries.
- Sepolia is suitable for development and demonstration, not an industry production deployment.
- Smart-contract defects and incorrect role assignments can have persistent consequences.

## Unconfirmed decisions

- Whether each company has one wallet or multiple authorized operator wallets
- Which party encrypts credentials and controls decryption keys
- How recovery keys are protected independently from user devices
- Which IPFS nodes or pinning services provide redundancy
- Which evidence remains on IPFS and which evidence is disclosed only when requested
- How the System Admin independently re-verifies a company during wallet recovery
- Production replacement or hardening strategy for the beta JSON SSI store
- Immediate session-revocation design if signed stateless tokens replace server-side sessions
- Smart-contract upgrade policy and final authorization-library choice
- Hosting and deployment platform
- Whether references to “Veramo 2” mean the historical Veramo 2.0 release, DIDComm v2, or W3C VC Data Model 2.0
