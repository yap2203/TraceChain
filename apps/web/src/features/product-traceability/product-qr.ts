import { encodeProductQrPayload } from '@tracechain/shared';
import { getAddress, isHexString } from 'ethers';
import qrcode from 'qrcode-generator';

import { chainConfig } from '../../config/chain';

export interface ProductQrConfiguration {
  chainId: number;
  productRegistryAddress: string;
  publicAppUrl: string;
}

export interface ProductQrModel {
  modules: boolean[][];
  payload: string;
}

export function loadProductQrConfiguration(): ProductQrConfiguration {
  const productRegistryAddress = import.meta.env.VITE_PRODUCT_REGISTRY_ADDRESS;
  const publicAppUrl = import.meta.env.VITE_PUBLIC_APP_URL;
  if (!productRegistryAddress)
    throw new Error('PRODUCT_REGISTRY_ADDRESS is not configured for product QR generation.');
  if (!publicAppUrl)
    throw new Error('VITE_PUBLIC_APP_URL is not configured for product QR generation.');
  return {
    chainId: chainConfig.chainId,
    productRegistryAddress: getAddress(productRegistryAddress),
    publicAppUrl,
  };
}

export function createProductQrPayload(
  batchId: string,
  configuration: ProductQrConfiguration = loadProductQrConfiguration(),
) {
  if (!isHexString(batchId, 32))
    throw new Error('A real on-chain bytes32 product batch ID is required.');
  return encodeProductQrPayload({
    batchId: batchId as `0x${string}`,
    chainId: configuration.chainId,
    productRegistryAddress: configuration.productRegistryAddress,
    publicAppUrl: configuration.publicAppUrl,
    version: 1,
  });
}

export function createProductQrModel(
  batchId: string,
  configuration: ProductQrConfiguration = loadProductQrConfiguration(),
): ProductQrModel {
  const payload = createProductQrPayload(batchId, configuration);
  const code = qrcode(0, 'M');
  code.addData(payload, 'Byte');
  code.make();
  return {
    modules: Array.from({ length: code.getModuleCount() }, (_, row) =>
      Array.from({ length: code.getModuleCount() }, (_, column) => code.isDark(row, column)),
    ),
    payload,
  };
}

export function productQrPngFilename(batchReference: string) {
  const safeReference = batchReference
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `tracechain-product-${safeReference || 'registered-product'}.png`;
}
