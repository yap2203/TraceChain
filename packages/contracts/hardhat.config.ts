import hardhatToolboxMochaEthersPlugin from '@nomicfoundation/hardhat-toolbox-mocha-ethers';
import { configVariable, defineConfig } from 'hardhat/config';

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        // Windows Application Control can block downloaded native solc executables.
        preferWasm: process.platform === 'win32',
        compilers: [
          { version: '0.8.34', settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true } },
        ],
        overrides: {
          'contracts/traceability/SupplyChainOrders.sol': {
            version: '0.8.34',
            settings: { optimizer: { enabled: true, runs: 1 }, viaIR: true },
          },
        },
      },
      production: {
        preferWasm: process.platform === 'win32',
        compilers: [
          { version: '0.8.34', settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true } },
        ],
        overrides: {
          'contracts/traceability/SupplyChainOrders.sol': {
            version: '0.8.34',
            settings: { optimizer: { enabled: true, runs: 1 }, viaIR: true },
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: 'edr-simulated',
      chainType: 'l1',
    },
    hardhatOp: {
      type: 'edr-simulated',
      chainType: 'op',
    },
    localhost: {
      type: 'http',
      chainType: 'l1',
      url: 'http://127.0.0.1:8545',
    },
    sepolia: {
      type: 'http',
      chainType: 'l1',
      url: configVariable('SEPOLIA_RPC_URL'),
      accounts: [configVariable('SEPOLIA_PRIVATE_KEY')],
    },
  },
});
