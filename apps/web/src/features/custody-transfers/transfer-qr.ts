import { encodeTransferQrPayload } from '@tracechain/shared';
import { getAddress, isHexString } from 'ethers';
import qrcode from 'qrcode-generator';

import { chainConfig } from '../../config/chain';
import type { TransferQrConfiguration } from './custody-transfer.types';

export interface TransferQrModel {
  modules: boolean[][];
  payload: string;
}

export function loadTransferQrConfiguration(): TransferQrConfiguration {
  const contractAddress = import.meta.env.VITE_CUSTODY_TRANSFER_ADDRESS;
  if (!contractAddress) {
    throw new Error('CUSTODY_TRANSFER_ADDRESS is not configured for the frontend.');
  }

  return {
    chainId: chainConfig.chainId,
    contractAddress: getAddress(contractAddress),
  };
}

export function createTransferQrPayload(
  transferId: string,
  configuration?: TransferQrConfiguration,
) {
  if (!isHexString(transferId, 32)) {
    throw new Error('A successful on-chain bytes32 transfer ID is required.');
  }

  const resolvedConfiguration = configuration ?? loadTransferQrConfiguration();
  return encodeTransferQrPayload({
    chainId: resolvedConfiguration.chainId,
    custodyTransferAddress: resolvedConfiguration.contractAddress,
    transferId: transferId as `0x${string}`,
    version: 1,
  });
}

export function createTransferQrModel(
  transferId: string,
  configuration?: TransferQrConfiguration,
): TransferQrModel {
  const payload = createTransferQrPayload(transferId, configuration);
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
