import { getAddress } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  decodeTransferQrPayload,
  encodeTransferQrPayload,
  TransferQrError,
  TransferQrErrorCode,
  type TransferQrErrorCodeValue,
  type TransferQrPayload,
} from '../src/qr/transfer-qr.js';

const contractAddress = '0x5fbdb2315678afecb367f032d93f642f64180aa3';
const checksummedContractAddress = getAddress(contractAddress);
const transferId = `0x${'ab'.repeat(32)}` as const;

const localPayload: TransferQrPayload = {
  version: 1,
  chainId: 31_337,
  custodyTransferAddress: contractAddress,
  transferId,
};

function expectError(value: string, code: TransferQrErrorCodeValue): void {
  try {
    decodeTransferQrPayload(value);
    throw new Error('Expected decodeTransferQrPayload to reject the payload.');
  } catch (error) {
    expect(error).toBeInstanceOf(TransferQrError);
    expect((error as TransferQrError).code).toBe(code);
  }
}

describe('transfer custody QR payloads', () => {
  it('encodes a canonical Hardhat local-chain payload', () => {
    expect(encodeTransferQrPayload(localPayload)).toBe(
      `tracechain://transfer/v1?chainId=31337&contract=${checksummedContractAddress}&transferId=${transferId}`,
    );
  });

  it('encodes and decodes a Sepolia payload', () => {
    const encoded = encodeTransferQrPayload({ ...localPayload, chainId: 11_155_111 });

    expect(decodeTransferQrPayload(encoded)).toEqual({
      ...localPayload,
      chainId: 11_155_111,
      custodyTransferAddress: checksummedContractAddress,
    });
  });

  it('normalizes address checksum and transfer ID case', () => {
    const encoded = encodeTransferQrPayload({
      ...localPayload,
      transferId: transferId.toUpperCase().replace('0X', '0x') as `0x${string}`,
    });

    expect(encoded).toContain(`contract=${checksummedContractAddress}`);
    expect(encoded).toContain(`transferId=${transferId}`);
  });

  it('round trips without changing the canonical payload', () => {
    const encoded = encodeTransferQrPayload(localPayload);

    expect(encodeTransferQrPayload(decodeTransferQrPayload(encoded))).toBe(encoded);
  });

  it.each([
    [
      'incorrect protocol',
      `https://transfer/v1?chainId=31337&contract=${contractAddress}&transferId=${transferId}`,
    ],
    [
      'incorrect protocol case',
      `Tracechain://transfer/v1?chainId=31337&contract=${contractAddress}&transferId=${transferId}`,
    ],
    [
      'incorrect resource',
      `tracechain://product/v1?chainId=31337&contract=${contractAddress}&transferId=${transferId}`,
    ],
    [
      'incorrect resource case',
      `tracechain://Transfer/v1?chainId=31337&contract=${contractAddress}&transferId=${transferId}`,
    ],
    [
      'username',
      `tracechain://user@transfer/v1?chainId=31337&contract=${contractAddress}&transferId=${transferId}`,
    ],
    [
      'password',
      `tracechain://user:secret@transfer/v1?chainId=31337&contract=${contractAddress}&transferId=${transferId}`,
    ],
    [
      'port',
      `tracechain://transfer:1234/v1?chainId=31337&contract=${contractAddress}&transferId=${transferId}`,
    ],
    [
      'fragment',
      `tracechain://transfer/v1?chainId=31337&contract=${contractAddress}&transferId=${transferId}#receipt`,
    ],
  ])('rejects %s', (_name, value) => {
    expectError(value, TransferQrErrorCode.MALFORMED_QR_PAYLOAD);
  });

  it('rejects unsupported versions', () => {
    expectError(
      `tracechain://transfer/v2?chainId=31337&contract=${contractAddress}&transferId=${transferId}`,
      TransferQrErrorCode.UNSUPPORTED_QR_VERSION,
    );
  });

  it('rejects a missing query parameter', () => {
    expectError(
      `tracechain://transfer/v1?chainId=31337&contract=${contractAddress}`,
      TransferQrErrorCode.MISSING_PARAMETER,
    );
  });

  it('rejects a duplicate query parameter', () => {
    expectError(
      `tracechain://transfer/v1?chainId=31337&chainId=11155111&contract=${contractAddress}&transferId=${transferId}`,
      TransferQrErrorCode.DUPLICATE_PARAMETER,
    );
  });

  it.each(['credential', 'privateKey', 'company', 'quantity', 'receipt'])(
    'rejects the unexpected %s parameter',
    (parameter) => {
      expectError(
        `tracechain://transfer/v1?chainId=31337&contract=${contractAddress}&transferId=${transferId}&${parameter}=secret`,
        TransferQrErrorCode.UNKNOWN_PARAMETER,
      );
    },
  );

  it.each(['0', '-1', '1.5', '9007199254740992'])('rejects invalid chain ID %s', (chainId) => {
    expectError(
      `tracechain://transfer/v1?chainId=${chainId}&contract=${contractAddress}&transferId=${transferId}`,
      TransferQrErrorCode.INVALID_CHAIN_ID,
    );
  });

  it('rejects an invalid Ethereum address', () => {
    expectError(
      `tracechain://transfer/v1?chainId=31337&contract=0x1234&transferId=${transferId}`,
      TransferQrErrorCode.INVALID_CONTRACT_ADDRESS,
    );
  });

  it.each([`0x${'ab'.repeat(31)}`, `0x${'ab'.repeat(33)}`, `0x${'zz'.repeat(32)}`])(
    'rejects invalid transfer ID %s',
    (invalidTransferId) => {
      expectError(
        `tracechain://transfer/v1?chainId=31337&contract=${contractAddress}&transferId=${invalidTransferId}`,
        TransferQrErrorCode.INVALID_TRANSFER_ID,
      );
    },
  );

  it('rejects an oversized payload before parsing it', () => {
    expectError(
      `tracechain://transfer/v1?${'x'.repeat(513)}`,
      TransferQrErrorCode.PAYLOAD_TOO_LONG,
    );
  });
});
