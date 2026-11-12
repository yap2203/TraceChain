# Smart Contracts

`packages/contracts` contains the six-contract TraceChain suite using Solidity 0.8.34, Hardhat 3, ethers, Mocha, Hardhat Ignition, and Foundry-compatible Solidity tests. The contracts implement stakeholder authorization, credential lifecycle, ingredient evidence, ingredient/product traceability, inventory, and custody transfers.

## Current package

```text
packages/contracts/
  contracts/access/              Stakeholder registry and permissions
  contracts/credentials/         Credential registry and lifecycle
  contracts/traceability/        Evidence, ingredient, product, and custody contracts
  contracts/interfaces/          Cross-contract read interfaces
  test/TraceChain.ts              End-to-end contract integration tests
  ignition/modules/TraceChain.ts Complete deployment and wiring
  hardhat.config.ts               Solidity 0.8.34 and network configuration
```

Run commands from `packages/contracts`:

```bash
npx hardhat compile
npx hardhat test
npx hardhat test solidity
npx hardhat test mocha
```

The local simulated networks require no wallet key. Sepolia configuration reads `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY` through Hardhat configuration variables. Store secrets with the Hardhat keystore or an ignored local environment mechanism; never commit them.

## Current security behavior

- Company Role Credentials issued before an administrator transfer remain valid when their current status, expiry, subject, type, stakeholder lifecycle, and hash link remain valid. The former administrator is revoked and cannot issue new credentials.
- Evidence acceptance requires the exact credential registered for the requested ingredient batch, the expected Supplier, Ingredient type, valid lifecycle, unexpired presentation, and an unconsumed request challenge.
- Retailer evidence acceptance records request completion but never sets the Manufacturer-only evidence-acceptance flag. Receipt-backed product creation no longer requires that flag: Ingredient evidence is optional, while valid source/credential status and Manufacturer received stock remain mandatory. `ProductRegistry.receivedProductionPolicy() = 1` identifies this policy; an older deployed suite must be replaced to use it. Legacy integrations without a receipt ledger retain their previous evidence gate.
- Ingredient Credentials still require an authorized Supplier issuer.
- Complete credentials and private evidence remain off-chain; contracts store only identifiers, hashes, CIDs, statuses, timestamps, quantities, and relationships.

The CredentialRegistry administrator-transfer correction changes bytecode. Existing local deployments must be redeployed before testing this behavior; this task does not deploy to local networks or Sepolia. See [`packages/contracts/README.md`](../../packages/contracts/README.md) for the full deployment and verification guide.
