import { T, Card, Alert, VerifyRow } from '../../shared/ui';

export function IntegrityChecks() {
  return (
    <>
      {/* 9. Integrity check */}
      <Card>
        <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 14 }}>
          9. Integrity Check Result
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          <VerifyRow
            label="Ingredient credential hashes match blockchain records"
            result="Hash Matched"
            variant="matched"
          />
          <VerifyRow
            label="Custody transfer signatures valid at each stage"
            result="Valid Signature"
            variant="valid"
          />
          <VerifyRow
            label="No credential modifications detected"
            result="Hash Matched"
            variant="matched"
          />
          <VerifyRow
            label="All company credentials were active during transfers"
            result="Verified"
            variant="verified"
          />
          <VerifyRow
            label="Quantity reconciliation balanced"
            result="Verified"
            variant="verified"
          />
        </div>
        <div style={{ marginTop: 16 }}>
          <Alert
            type="success"
            message="All integrity checks passed. The product history for CHOCOLATE-2026-050 is complete, unmodified, and cryptographically verified."
          />
        </div>
      </Card>
    </>
  );
}
