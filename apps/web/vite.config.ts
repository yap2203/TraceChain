import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '../..', '');
  return {
    define: {
      'import.meta.env.VITE_CHAIN_CURRENCY_SYMBOL': JSON.stringify(
        environment.CHAIN_CURRENCY_SYMBOL,
      ),
      'import.meta.env.VITE_CHAIN_ID': JSON.stringify(environment.CHAIN_ID),
      'import.meta.env.VITE_CHAIN_NAME': JSON.stringify(environment.CHAIN_NAME),
      'import.meta.env.VITE_CHAIN_RPC_URL': JSON.stringify(environment.CHAIN_RPC_URL),
      'import.meta.env.VITE_CUSTODY_TRANSFER_ADDRESS': JSON.stringify(
        environment.CUSTODY_TRANSFER_ADDRESS,
      ),
      'import.meta.env.VITE_PRODUCT_REGISTRY_ADDRESS': JSON.stringify(
        environment.PRODUCT_REGISTRY_ADDRESS,
      ),
      'import.meta.env.VITE_PUBLIC_APP_URL': JSON.stringify(environment.VITE_PUBLIC_APP_URL),
    },
    envDir: '../..',
    plugins: [react()],
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
