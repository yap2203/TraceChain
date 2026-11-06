# @tracechain/shared

This package contains small TypeScript definitions that are safe to share across TraceChain applications and packages.

## Current exports

`CompanyRole` defines the five supported company roles:

- `SYSTEM_ADMIN`
- `SUPPLIER`
- `MANUFACTURER`
- `DISTRIBUTOR`
- `RETAILER`

The custody-transfer QR module exports:

- `TransferQrPayload`
- `encodeTransferQrPayload(payload)`
- `decodeTransferQrPayload(value)`
- `TransferQrError` and `TransferQrErrorCode`

The version 1 canonical locator is:

```text
tracechain://transfer/v1?chainId={chainId}&contract={custodyTransferAddress}&transferId={transferId}
```

The query order is always `chainId`, `contract`, then `transferId`. Encoding normalizes the
contract to its EIP-55 checksum and the bytes32 transfer ID to lowercase hexadecimal. Decoding
rejects unsupported locations or versions, missing, duplicate, or unknown parameters, invalid
values, fragments, credentials, and oversized payloads.

This QR value is only an untrusted locator. It contains no quantity, product, credential, JWT,
company, private document, encryption key, wallet secret, or receipt information. A successful
decode does not prove that a transfer exists or authorize receipt confirmation.

## Commands

From the repository root:

```bash
npm run build --workspace @tracechain/shared
npm run typecheck --workspace @tracechain/shared
npm run test:qr
```

Keep this package free of frontend presentation code, API persistence, SSI provider configuration, and contract-specific implementation details. Add a shared abstraction only when more than one package has a current need for the same contract.
