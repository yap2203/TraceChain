import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '../..', '');
  const publicEnvironment = mode === 'test' ? TEST_ENVIRONMENT : environment;
  return {
    define: {
      'import.meta.env.VITE_CHAIN_CURRENCY_SYMBOL': JSON.stringify(
        publicEnvironment.CHAIN_CURRENCY_SYMBOL,
      ),
      'import.meta.env.VITE_CHAIN_ID': JSON.stringify(publicEnvironment.CHAIN_ID),
      'import.meta.env.VITE_CHAIN_NAME': JSON.stringify(publicEnvironment.CHAIN_NAME),
      'import.meta.env.VITE_CHAIN_RPC_URL': JSON.stringify(publicEnvironment.CHAIN_RPC_URL),
      'import.meta.env.VITE_CUSTODY_TRANSFER_ADDRESS': JSON.stringify(
        publicEnvironment.CUSTODY_TRANSFER_ADDRESS,
      ),
      'import.meta.env.VITE_PRODUCT_REGISTRY_ADDRESS': JSON.stringify(
        publicEnvironment.PRODUCT_REGISTRY_ADDRESS,
      ),
      'import.meta.env.VITE_PUBLIC_APP_URL': JSON.stringify(publicEnvironment.VITE_PUBLIC_APP_URL),
    },
    envDir: '../..',
    plugins: [tailwindcss(), react()],
    server: {
      port: 5173,
      strictPort: true,
    },
    resolve: {
      alias: {
        buffer: 'buffer/',
      },
    },
  };
});

const TEST_ENVIRONMENT = {
  CHAIN_CURRENCY_SYMBOL: 'ETH',
  CHAIN_ID: '31337',
  CHAIN_NAME: 'TraceChain Local',
  CHAIN_RPC_URL: 'http://127.0.0.1:8545',
  CUSTODY_TRANSFER_ADDRESS: '0x4000000000000000000000000000000000000004',
  PRODUCT_REGISTRY_ADDRESS: '0x1000000000000000000000000000000000000001',
  VITE_PUBLIC_APP_URL: 'http://localhost:5173',
} as const;
