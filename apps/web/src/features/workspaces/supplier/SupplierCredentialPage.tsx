import { BadgeCheck } from 'lucide-react';
import { T, MONO, Card, Badge, Table, TR, TD, SectionTitle } from '../shared/ui';

export function SupplierCredential() {
  return (
    <div>
      <SectionTitle
        title="Issued Credentials"
        sub="Your company role credential issued by the Product Traceability Authority"
      />

      {/* Credential card */}
      <div
        style={{
          background: T.navyDark,
          borderRadius: 16,
          padding: '28px 28px',
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
        <div
          style={{
            position: 'absolute',
            bottom: -30,
            right: 60,
            width: 100,
            height: 100,
            borderRadius: '50%',
            background: 'rgba(22,140,140,0.08)',
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
                  Supplier Role Credential
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
            ABC Ingredients Sdn. Bhd.
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: 'rgba(255,255,255,0.5)',
              marginBottom: 20,
            }}
          >
            did:ethr:0x8A31…92F0
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { label: 'Credential ID', value: 'CRED-SUP-2026-001' },
              { label: 'Issuer', value: 'Product Traceability Authority' },
              { label: 'Issue Date', value: '1 May 2026' },
              { label: 'Expiry Date', value: '1 May 2027' },
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

      {/* Credential details */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
            Verification Status
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <span style={{ fontSize: 12, color: T.text2 }}>Credential Status</span>
              <Badge label="active" variant="active" />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <span style={{ fontSize: 12, color: T.text2 }}>Issuer Signature</span>
              <Badge label="valid" variant="valid" />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <span style={{ fontSize: 12, color: T.text2 }}>On-chain Status</span>
              <Badge label="verified" variant="verified" />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 0',
              }}
            >
              <span style={{ fontSize: 12, color: T.text2 }}>Not Expired</span>
              <Badge label="valid" variant="valid" />
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
            Blockchain Record
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {[
              { label: 'Registry Contract', value: '0xTCA…0001' },
              { label: 'Issuance Tx', value: '0x3f8a2c…b04d' },
              { label: 'Block Number', value: '7,412,088' },
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

      {/* Claims table */}
      <Card padding="0">
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.navy }}>Credential Claims</div>
          <div style={{ fontSize: 12, color: T.text2, marginTop: 2 }}>
            Information encoded in your company role credential
          </div>
        </div>
        <Table headers={['Claim', 'Value', 'Visibility']}>
          {[
            { claim: 'Company Name', value: 'ABC Ingredients Sdn. Bhd.', vis: 'Public' },
            { claim: 'Registration No.', value: '202601234567', vis: 'Public' },
            { claim: 'Company DID', value: 'did:ethr:0x8A31…92F0', vis: 'Public' },
            { claim: 'Assigned Role', value: 'Supplier', vis: 'Public' },
            { claim: 'Issuer DID', value: 'did:ethr:0xPTA…a1b2', vis: 'Public' },
            { claim: 'Issue Date', value: '2026-05-01', vis: 'Public' },
            { claim: 'Expiry Date', value: '2027-05-01', vis: 'Public' },
          ].map((r) => (
            <TR key={r.claim}>
              <TD bold>{r.claim}</TD>
              <TD mono muted>
                {r.value}
              </TD>
              <TD>
                <Badge label={r.vis} variant="accepted" />
              </TD>
            </TR>
          ))}
        </Table>
      </Card>
    </div>
  );
}
