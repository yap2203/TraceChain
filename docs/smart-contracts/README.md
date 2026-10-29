# Smart Contracts

`packages/contracts` now contains a Hardhat 3 starter using Solidity 0.8.34, ethers, Mocha, Hardhat Ignition, and Foundry-compatible Solidity tests. The included `Counter.sol` contract, its tests, deployment module, and OP transaction script are toolchain examples. They do not implement TraceChain custody, credential status, or supply-chain rules.

## Current package

```text
packages/contracts/
  contracts/Counter.sol       Starter contract
  contracts/Counter.t.sol     Solidity unit tests
  test/Counter.ts             TypeScript integration tests
  ignition/modules/Counter.ts Starter deployment module
  scripts/send-op-tx.ts       Simulated OP-network example
  hardhat.config.ts           Solidity 0.8.34 and network configuration
```

Run commands from `packages/contracts`:

```bash
npx hardhat compile
npx hardhat test
npx hardhat test solidity
npx hardhat test mocha
```

The local simulated networks require no wallet key. Sepolia configuration reads `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY` through Hardhat configuration variables. Store secrets with the Hardhat keystore or an ignored local environment mechanism; never commit them.

## Planned TraceChain contract scope

- Register references to stakeholder and credential status without storing full credentials.
- Record product-batch and ingredient-batch references.
- Record custody-transfer intent and confirmation events.
- Enforce the intended receiver and valid state transitions.
- Record quantities and support reconciliation without claiming legal ownership.
- Expose auditable hashes, references, statuses, and timestamps.

The exact contract architecture, authorization model, event schema, upgrade policy, and deployment process remain unconfirmed. Replace the Counter example only after those decisions are approved.
