import { T, MONO, Card, VerifyRow } from '../../shared/ui';

export function ManufacturerVerification() {
  return (
    <>
      {/* 2. Manufacturer Verification */}
      <Card>
        <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 14 }}>
          2. Manufacturer Verification
        </div>
        <div
          style={{ background: T.surface2, borderRadius: 10, padding: '14px', marginBottom: 14 }}
        >
          <div style={{ fontWeight: 600, fontSize: 13, color: T.navy }}>
            CocoaCraft Manufacturing Sdn. Bhd.
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.teal, marginTop: 3 }}>
            did:ethr:0x7B82…44A1
          </div>
        </div>
        <VerifyRow label="Company identity" result="Company identity verified" variant="verified" />
        <VerifyRow
          label="Manufacturer role credential"
          result="Active — CRED-MAN-2026-001"
          variant="active"
        />
        <VerifyRow label="Digital signature" result="Valid Signature" variant="valid" />
      </Card>
    </>
  );
}
