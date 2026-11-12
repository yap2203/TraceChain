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
- `encodeTransferQrPayload(payloadWithPublicAppUrl)`
- `decodeTransferQrPayload(value, options)`
- `TransferQrError` and `TransferQrErrorCode`

The version 1 canonical locator is:

```text
{publicAppUrl}/receive/transfer?v=1&chainId={chainId}&contract={custodyTransferAddress}&transferId={transferId}
```

The query order is always `v`, `chainId`, `contract`, then `transferId`. Encoding normalizes the
contract to its EIP-55 checksum and the bytes32 transfer ID to lowercase hexadecimal. Decoding
requires the exact configured HTTPS origin and `/receive/transfer` path (localhost HTTP is allowed
for development) and rejects unsupported versions, missing, duplicate, unknown or reordered
parameters, invalid values, fragments, credentials, unexpected origins/ports, and oversized
payloads. The legacy custom URI requires the explicit manual-paste compatibility option.

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
