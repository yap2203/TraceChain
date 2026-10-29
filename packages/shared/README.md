# @tracechain/shared

This package contains small TypeScript definitions that are safe to share across TraceChain applications and packages.

## Current export

`CompanyRole` defines the five supported company roles:

- `SYSTEM_ADMIN`
- `SUPPLIER`
- `MANUFACTURER`
- `DISTRIBUTOR`
- `RETAILER`

## Commands

From the repository root:

```bash
npm run build --workspace @tracechain/shared
npm run typecheck --workspace @tracechain/shared
```

Keep this package free of frontend presentation code, API persistence, SSI provider configuration, and contract-specific implementation details. Add a shared abstraction only when more than one package has a current need for the same contract.
