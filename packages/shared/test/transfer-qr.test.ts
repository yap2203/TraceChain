import { getAddress } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  decodeTransferQrPayload,
  encodeTransferQrPayload,
  TransferQrError,
  TransferQrErrorCode,
  type TransferQrErrorCodeValue,
} from '../src/qr/transfer-qr.js';

const publicAppUrl = 'https://tracechain.example';
const localAppUrl = 'http://localhost:5173';
const contract = getAddress('0x5fbdb2315678afecb367f032d93f642f64180aa3');
const transferId = `0x${'ab'.repeat(32)}` as const;
const canonical = `${publicAppUrl}/receive/transfer?v=1&chainId=11155111&contract=${contract}&transferId=${transferId}`;

function error(value: string, code: TransferQrErrorCodeValue, app = publicAppUrl) {
  expect(() => decodeTransferQrPayload(value, { publicAppUrl: app })).toThrowError(
    expect.objectContaining<Partial<TransferQrError>>({ code }),
  );
}

describe('HTTPS custody-transfer QR payloads', () => {
  it('generates a canonical phone-camera-compatible HTTPS URL', () => {
    expect(
      encodeTransferQrPayload({
        version: 1,
        chainId: 11_155_111,
        custodyTransferAddress: contract.toLowerCase(),
        transferId,
        publicAppUrl,
      }),
    ).toBe(canonical);
    expect(decodeTransferQrPayload(canonical, { publicAppUrl })).toEqual({
      version: 1,
      chainId: 11_155_111,
      custodyTransferAddress: contract,
      transferId,
    });
  });

  it('allows localhost HTTP for development', () => {
    const value = encodeTransferQrPayload({
      version: 1,
      chainId: 31_337,
      custodyTransferAddress: contract,
      transferId,
      publicAppUrl: localAppUrl,
    });
    expect(value.startsWith('http://localhost:5173/receive/transfer?')).toBe(true);
    expect(decodeTransferQrPayload(value, { publicAppUrl: localAppUrl }).chainId).toBe(31_337);
  });

  it.each([
    'http://tracechain.example',
    'ftp://tracechain.example',
    'https://user@tracechain.example',
    'https://tracechain.example/path',
  ])('rejects an unsafe public application URL: %s', (value) => {
    expect(() =>
      encodeTransferQrPayload({
        version: 1,
        chainId: 1,
        custodyTransferAddress: contract,
        transferId,
        publicAppUrl: value,
      }),
    ).toThrowError(expect.objectContaining({ code: TransferQrErrorCode.INVALID_PUBLIC_APP_URL }));
  });

  it('requires the configured origin including its port', () => {
    error(canonical, TransferQrErrorCode.PUBLIC_APP_ORIGIN_MISMATCH, 'https://other.example');
    error(
      canonical,
      TransferQrErrorCode.PUBLIC_APP_ORIGIN_MISMATCH,
      'https://tracechain.example:444',
    );
  });

  it.each([
    [canonical.replace('/receive/transfer', '/receipt'), TransferQrErrorCode.MALFORMED_QR_PAYLOAD],
    [canonical.replace('?v=1', '?'), TransferQrErrorCode.MISSING_PARAMETER],
    [`${canonical}&chainId=1`, TransferQrErrorCode.DUPLICATE_PARAMETER],
    [`${canonical}&rpcUrl=https://rpc.example`, TransferQrErrorCode.UNKNOWN_PARAMETER],
    [`${canonical}#receipt`, TransferQrErrorCode.MALFORMED_QR_PAYLOAD],
    [
      canonical.replace('?v=1&chainId=11155111', '?chainId=11155111&v=1'),
      TransferQrErrorCode.NON_CANONICAL_PARAMETER_ORDER,
    ],
    [canonical.replace('chainId=11155111', 'chainId=0'), TransferQrErrorCode.INVALID_CHAIN_ID],
    [canonical.replace(contract, '0x1234'), TransferQrErrorCode.INVALID_CONTRACT_ADDRESS],
    [
      canonical.replace(transferId, `0x${'ab'.repeat(31)}`),
      TransferQrErrorCode.INVALID_TRANSFER_ID,
    ],
  ])('rejects malformed or non-canonical transfer links', (value, code) => error(value, code));

  it('accepts the legacy custom URI only when explicitly enabled for manual paste', () => {
    const legacy = `tracechain://transfer/v1?chainId=31337&contract=${contract}&transferId=${transferId}`;
    error(legacy, TransferQrErrorCode.MALFORMED_QR_PAYLOAD);
    expect(decodeTransferQrPayload(legacy, { allowLegacy: true, publicAppUrl }).chainId).toBe(
      31_337,
    );
  });
});
