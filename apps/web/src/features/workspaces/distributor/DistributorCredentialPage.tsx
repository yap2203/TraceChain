import { T, MONO, Card, Badge, SectionTitle } from '../shared/ui';
import { CredentialCard } from '../shared/CredentialCard';

export function DistributorCredential() {
  return (
    <div>
      <SectionTitle
        title="My Credential"
        sub="Your company role credential issued by the Product Traceability Authority"
      />
      <CredentialCard
        role="Distributor"
        org="Swift Distribution Sdn. Bhd."
        did="did:ethr:0x5C91…19D4"
        credId="CRED-DIS-2026-001"
        issue="1 June 2026"
        expiry="1 June 2027"
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
            Verification Status
          </div>
          {[
            { l: 'Credential Status', b: 'active', v: 'active' as const },
            { l: 'Issuer Signature', b: 'valid', v: 'valid' as const },
            { l: 'On-chain Status', b: 'verified', v: 'verified' as const },
            { l: 'Not Expired', b: 'valid', v: 'valid' as const },
          ].map((r) => (
            <div
              key={r.l}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '9px 0',
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <span style={{ fontSize: 12, color: T.text2 }}>{r.l}</span>
              <Badge label={r.b} variant={r.v} />
            </div>
          ))}
        </Card>
        <Card>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
            Blockchain Record
          </div>
          {[
            { l: 'Registry Contract', v: '0xTCA…0001' },
            { l: 'Issuance Tx', v: '0xc4f1e8…b39a' },
            { l: 'Block Number', v: '7,431,088' },
            { l: 'Network', v: 'Sepolia' },
          ].map((r) => (
            <div key={r.l} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>{r.l}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: T.teal }}>{r.v}</div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
