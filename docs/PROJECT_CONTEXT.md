# TraceChain Project Context

## Project

- **Name:** TraceChain
- **Formal title:** Blockchain-Based Supply Chain Traceability System: Self-Sovereign Identity Credential Verification
- **Repository:** Private TypeScript npm monorepo with React, Express, shared, SSI, and Solidity workspaces

## Stakeholder roles

- System Admin, also acting as the Product Traceability Authority
- Supplier
- Manufacturer
- Distributor
- Retailer

## Confirmed target architecture

- React and Vite web application
- Node.js and Express application server
- MetaMask wallet authentication and transaction signing
- Ethereum Sepolia test network
- ERC-4361 Sign-In with Ethereum
- Veramo agent services and stakeholder-specific repositories
- Company Role Credentials for credential-based RBAC
- Ingredient Credentials and selective disclosure
- Solidity smart contracts and a blockchain gateway
- QR-code generation and scanning

## Current implementation

- Responsive React UI with public login and registration pages
- Integrated admin, supplier, manufacturer, distributor, and retailer workspace screens
- Development sample data, simulated interactions, responsive dialogs, accessible loading states, and table pagination
- SIWE nonce issuance, signature verification, HttpOnly-cookie sessions, restoration, and logout
- State-safe MetaMask extension reuse and Mobile QR connection with bounded attempts and listener cleanup
- In-memory nonce and session repository interfaces and development implementations
- Shared `CompanyRole` enum
- Versioned custody-transfer QR locator encoding and strict untrusted-payload decoding
- Authenticated, credential-authorized custody-transfer resolution with intended-recipient checks
- Canonical custody-transfer QR rendering, PNG download, camera/image/manual scanning, and API-verified transfer summaries
- Server-side Veramo agent with did:ethr Sepolia, JWT VC/VP, encrypted JSON key storage, Company Role Credential issuance/verification, Admin bootstrap, and development holder export
- Authenticated Company Role Credential JSON presentation with safe session summaries and fail-closed workspace guards
- Hardhat 3 smart-contract starter with a Counter example

The detailed stakeholder screens do not have persisted business services. The local Vite development server intentionally allows account-free UI review on loopback hosts. The API can locally verify Company Role Credentials and return a safe role summary, but production builds remain fail-closed until on-chain status checking makes authorization ready.

## Identity and security rules

- MetaMask proves control of a wallet; it does not issue Company Role Credentials or Ingredient Credentials.
- Veramo manages the current DID, credential, and presentation foundation.
- Company Role Credentials determine stakeholder roles only after cryptographic verification.
- Suppliers issue Ingredient Credentials and control disclosed claims.
- Invalid, expired, suspended, or revoked credentials must never grant access.
- Routes, wallet addresses, fixture data, and browser storage are not trusted role evidence.
- Complete credentials, supporting identity documents, and sensitive identity data remain off-chain.
- Private keys, seed phrases, API secrets, and real credentials must never enter the repository.
- Blockchain records may contain hashes, statuses, references, and traceability events.

## Supply-chain rules

- System Admin reviews company applications and approved companies receive Company Role Credentials.
- Suppliers register ingredient batches and issue Ingredient Credentials.
- Manufacturers request and verify ingredient evidence, create product batches, and link verified ingredients.
- Manufacturers transfer products to Distributors.
- Distributors receive products, reconcile quantities, and transfer available products to Retailers.
- Retailers confirm receipt, inspect authorized history, request evidence, and export authorized reports.
- QR codes contain a reference to a product or pending transfer.
- Scanning a QR code alone must never change custody.
- Only the intended authenticated receiver may confirm receipt.
- Receipt confirmation requires a MetaMask transaction signature.
- The system records custody and does not claim to determine legal ownership.
- Product photographs do not automatically prove delivery.

## Current limitations

- No on-chain credential-status verification or role authorization service; local credential verification alone never unlocks a workspace
- No durable database or persisted stakeholder workflow APIs
- No TraceChain-specific smart contracts or deployment
- No finalized production SSI storage/key-custody design, hosting platform, or production topology
- No MetaMask-signed receipt confirmation flow; QR scanning remains read-only
- Sample UI records and transaction states are not persisted or cryptographically verified

## Important system qualities

- Security
- Privacy
- Reliability
- Usability and accessibility
- Responsive compatibility
- Performance
- Maintainability and explicit package boundaries
