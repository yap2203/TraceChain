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
- Access nonce and session storage through repository interfaces.
- Use development-only, in-memory nonce and session repository implementations for the current demonstration.
- Keep authentication state short-lived.
- Recheck on-chain role and revocation state before sensitive operations.
- Document that in-memory state disappears after an API restart and cannot support multiple API instances without shared transient storage or a different token design.
- Temporarily allow stakeholder sample pages and simulated UI interactions without account validation only on local Vite development hosts. Production credential checks and backend authorization remain fail-closed.

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

- Exact DID method, such as `did:ethr`, `did:key`, or another method
- Exact Veramo plugins, credential schemas, proof formats, and credential-status mechanism
- Whether each company has one wallet or multiple authorized operator wallets
- Which party encrypts credentials and controls decryption keys
- How recovery keys are protected independently from user devices
- Which IPFS nodes or pinning services provide redundancy
- Which evidence remains on IPFS and which evidence is disclosed only when requested
- How the System Admin independently re-verifies a company during wallet recovery
- Exact non-SQL format for optional Veramo metadata
- Immediate session-revocation design if signed stateless tokens replace server-side sessions
- Smart-contract upgrade policy and final authorization-library choice
- Hosting and deployment platform
- Exact QR-code payload format
- Whether references to “Veramo 2” mean the historical Veramo 2.0 release, DIDComm v2, or W3C VC Data Model 2.0
