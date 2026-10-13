# TraceChain Project Context

## Project

- **Name:** TraceChain
- **Formal title:** Blockchain-Based Supply Chain Traceability System: Self-Sovereign Identity Credential Verification

## Stakeholder roles

- System Admin, also acting as the Product Traceability Authority
- Supplier
- Manufacturer
- Distributor
- Retailer

## Confirmed architecture

- React and Vite web application
- MetaMask wallet authentication and transaction signing
- Node.js and Express application server
- Blockchain gateway
- Veramo Agent Services
- Ethereum Sepolia test network
- Solidity traceability smart contracts
- Stakeholder-specific local Veramo repositories
- QR-code generation and scanning
- Credential-based Role-Based Access Control

## Identity and security rules

- MetaMask proves control of the connected wallet; it does not issue Company Role Credentials or Ingredient Credentials.
- Veramo manages DIDs, credentials, and presentations.
- Company Role Credentials determine stakeholder roles.
- Suppliers issue Ingredient Credentials.
- Credentials must be cryptographically verified before their claims are trusted.
- Invalid, expired, suspended, or revoked credentials must not grant access.
- Complete credentials and sensitive identity data remain off-chain.
- Blockchain records may contain hashes, statuses, references, and traceability events.
- Suppliers control which ingredient claims are disclosed.
- Private keys must never be handled or stored by the application.

## Supply-chain rules

- Company applications are reviewed by the System Admin.
- Approved companies receive Company Role Credentials.
- Suppliers register ingredient batches and issue Ingredient Credentials.
- Manufacturers request and verify ingredient evidence.
- Manufacturers create product batches and link verified ingredients.
- Manufacturers transfer products to Distributors.
- Distributors receive products, record quantities, and transfer available products to Retailers.
- Retailers confirm receipt, view authorised product history, request additional evidence, and export authorised reports.
- QR codes contain a reference to a product or pending transfer.
- Scanning a QR code alone must not change custody.
- Only the intended authenticated receiver may confirm receipt.
- Receipt confirmation requires a MetaMask transaction signature.
- The system records custody and does not claim to determine legal ownership.
- Product photographs do not automatically prove delivery.

## Important system qualities

- Security
- Privacy
- Reliability
- Usability
- Performance
- Compatibility
- Maintainability
