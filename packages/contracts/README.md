# @tracechain/contracts

This workspace provides the current Solidity development toolchain for TraceChain. It uses Hardhat 3, Solidity 0.8.34, ethers, Mocha, Hardhat Ignition, and Foundry-compatible Solidity tests.

The included `Counter` implementation is starter code generated to validate the toolchain. It is not a TraceChain supply-chain contract and has not been deployed as part of the system.

## Layout

```text
contracts/Counter.sol       Starter Solidity contract
contracts/Counter.t.sol     Solidity tests
test/Counter.ts             TypeScript tests with Mocha and ethers
ignition/modules/Counter.ts Starter Ignition module
scripts/send-op-tx.ts       Simulated OP-network transaction example
hardhat.config.ts           Compiler and network configuration
```

## Commands

Run from this package:

```bash
npx hardhat compile
npx hardhat test
npx hardhat test solidity
npx hardhat test mocha
```

The combined Hardhat suite currently passes three Solidity tests and two Mocha tests. A standalone `npx tsc --noEmit` currently flags the Counter test's `queryFilter()` event union; narrow the result to an `EventLog` before treating contract-package type checking as a required gate.

Deploy the Counter example to a local simulated network:

```bash
npx hardhat ignition deploy ignition/modules/Counter.ts
```

## Sepolia configuration

The `sepolia` network reads Hardhat configuration variables:

- `SEPOLIA_RPC_URL`
- `SEPOLIA_PRIVATE_KEY`

Prefer the Hardhat keystore for local secrets:

```bash
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

Then the starter module can be invoked with:

```bash
npx hardhat ignition deploy --network sepolia ignition/modules/Counter.ts
```

Do not deploy the Counter example as a TraceChain production contract. Never commit private keys, RPC credentials, keystore data, generated artifacts, caches, or deployment secrets.

## Next implementation step

TraceChain contracts still require confirmed data models and authorization rules for credential-status references, batches, custody-transfer intent and acceptance, quantities, and audit events. Complete credentials and sensitive identity data must remain off-chain.
