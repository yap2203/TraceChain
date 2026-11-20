import hardhatToolboxMochaEthersPlugin from '@nomicfoundation/hardhat-toolbox-mocha-ethers';
import { configVariable, defineConfig } from 'hardhat/config';
import { definePlugin } from 'hardhat/plugins';
import { config as loadEnvironment } from 'dotenv';
import { fileURLToPath } from 'node:url';

loadEnvironment({
  path: fileURLToPath(new URL('../../.env', import.meta.url)),
  override: false,
  quiet: true,
});

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin, definePlugin({
    id: 'tracechain-sepolia-transactions',
    hookHandlers: { network: () => import('./plugins/sepolia-transactions.js') },
  })],
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
      chainId: 11155111,
      url:
        process.env.CHAIN_ID === '11155111' && process.env.CHAIN_RPC_URL
          ? process.env.CHAIN_RPC_URL
          : configVariable('SEPOLIA_RPC_URL'),
      accounts: [configVariable('SEPOLIA_PRIVATE_KEY')],
    },
  },
});
