import { BadgeCheck } from 'lucide-react';
import { T, MONO, Card, Badge, Table, TR, TD, SectionTitle } from '../shared/ui';

export function ManufacturerCredential() {
  return (
    <div>
      <SectionTitle
        title="My Credential"
        sub="Your company role credential issued by the Product Traceability Authority"
      />

      <div
        style={{
          background: `linear-gradient(135deg, ${T.navyDark} 0%, #0A2240 100%)`,
          borderRadius: 16,
          padding: '28px',
          marginBottom: 20,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -20,
            right: -20,
            width: 140,
            height: 140,
            borderRadius: '50%',
            background: 'rgba(22,140,140,0.15)',
          }}
        />
        <div style={{ position: 'relative' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 24,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  background: T.teal,
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                }}
              >
                <BadgeCheck size={22} color="#fff" />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.45)',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    marginBottom: 2,
                  }}
                >
                  TraceChain · SSI Credential
                </div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>
                  Manufacturer Role Credential
                </div>
              </div>
            </div>
            <div
              style={{
                background: T.teal,
                borderRadius: 20,
                padding: '4px 12px',
                fontSize: 11,
                fontWeight: 700,
                color: '#fff',
              }}
            >
              Active
            </div>
          </div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#fff', marginBottom: 4 }}>
            CocoaCraft Manufacturing Sdn. Bhd.
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: 'rgba(255,255,255,0.5)',
              marginBottom: 20,
            }}
          >
            did:ethr:0x7B82…44A1
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { label: 'Credential ID', value: 'CRED-MAN-2026-001' },
              { label: 'Issuer', value: 'Product Traceability Authority' },
              { label: 'Issue Date', value: '15 May 2026' },
              { label: 'Expiry Date', value: '15 May 2027' },
            ].map((r) => (
              <div key={r.label}>
                <div
                  style={{
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.4)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    marginBottom: 3,
                  }}
                >
                  {r.label}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#fff',
                    fontFamily: r.label === 'Credential ID' ? MONO : undefined,
                  }}
                >
                  {r.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
            Verification Status
          </div>
          <div style={{ display: 'grid', gap: 0 }}>
            {[
              { label: 'Credential Status', badge: 'active', variant: 'active' as const },
              { label: 'Issuer Signature', badge: 'valid', variant: 'valid' as const },
              { label: 'On-chain Status', badge: 'verified', variant: 'verified' as const },
              { label: 'Not Expired', badge: 'valid', variant: 'valid' as const },
            ].map((r) => (
              <div
                key={r.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '9px 0',
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <span style={{ fontSize: 12, color: T.text2 }}>{r.label}</span>
                <Badge label={r.badge} variant={r.variant} />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
            Blockchain Record
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {[
              { label: 'Registry Contract', value: '0xTCA…0001' },
              { label: 'Issuance Tx', value: '0x9b2e4f…a17c' },
              { label: 'Block Number', value: '7,418,204' },
              { label: 'Network', value: 'Sepolia' },
            ].map((r) => (
              <div key={r.label}>
                <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>{r.label}</div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: T.teal }}>{r.value}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card padding="0">
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.navy }}>Credential Claims</div>
        </div>
        <Table headers={['Claim', 'Value', 'Visibility']}>
          {[
            { claim: 'Company Name', value: 'CocoaCraft Manufacturing Sdn. Bhd.' },
            { claim: 'Registration No.', value: '202600987654' },
            { claim: 'Company DID', value: 'did:ethr:0x7B82…44A1' },
            { claim: 'Assigned Role', value: 'Manufacturer' },
            { claim: 'Issuer DID', value: 'did:ethr:0xPTA…a1b2' },
            { claim: 'Issue Date', value: '2026-05-15' },
            { claim: 'Expiry Date', value: '2027-05-15' },
          ].map((r) => (
            <TR key={r.claim}>
              <TD bold>{r.claim}</TD>
              <TD mono muted>
                {r.value}
              </TD>
              <TD>
                <Badge label="Public" variant="accepted" />
              </TD>
            </TR>
          ))}
        </Table>
      </Card>
    </div>
  );
}
