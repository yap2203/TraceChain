import { useState } from 'react';
import { T, MONO, Btn, Card, Badge, Table, TR, TD } from '../../shared/ui';
import { BATCHES } from '../fixtures';

export function IngredientBatchDetail({
  batchId,
  onBack,
}: {
  batchId: string;
  onBack: () => void;
}) {
  const batch = BATCHES.find((b) => b.id === batchId);
  const [showTech, setShowTech] = useState(false);

  if (!batch) return <div style={{ padding: 24, color: T.text2 }}>Batch not found.</div>;

  const SHARING_HISTORY = [
    {
      to: 'CocoaCraft Manufacturing Sdn. Bhd.',
      reqId: 'REQ-2026-031',
      claims: '5 claims',
      date: '2026-08-03',
      status: 'shared' as const,
    },
    {
      to: 'CocoaCraft Manufacturing Sdn. Bhd.',
      reqId: 'REQ-2026-029',
      claims: '3 claims',
      date: '2026-07-20',
      status: 'shared' as const,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back to Batches
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          {batch.name} · {batch.id}
        </h2>
        <Badge label={batch.status} variant={batch.status} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Ingredient Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              {[
                { label: 'Ingredient Name', value: batch.name },
                { label: 'Batch Number', value: batch.id },
                { label: 'Origin', value: batch.origin },
                { label: 'Quantity', value: batch.qty },
                { label: 'Production Date', value: batch.produced },
                { label: 'Expiry Date', value: batch.expires },
                { label: 'Allergen Info', value: batch.allergen },
                { label: 'Certifications', value: batch.cert },
              ].map((r) => (
                <div
                  key={r.label}
                  style={{ padding: '10px 0', borderBottom: `1px solid ${T.border}` }}
                >
                  <div style={{ fontSize: 11, color: T.text2, marginBottom: 3 }}>{r.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: T.navy }}>{r.value}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Sharing History
            </div>
            <div style={{ fontSize: 12, color: T.text2, marginBottom: 12 }}>
              Confidential claims are hidden by default and require explicit approval before
              sharing.
            </div>
            {SHARING_HISTORY.length === 0 ? (
              <div style={{ fontSize: 13, color: T.text3, textAlign: 'center', padding: '20px 0' }}>
                No sharing history.
              </div>
            ) : (
              <Table headers={['Shared With', 'Request ID', 'Claims', 'Date', 'Status']}>
                {SHARING_HISTORY.map((h) => (
                  <TR key={h.reqId}>
                    <TD muted>{h.to.split(' Sdn')[0]}</TD>
                    <TD mono muted>
                      {h.reqId}
                    </TD>
                    <TD>{h.claims}</TD>
                    <TD muted>{h.date}</TD>
                    <TD>
                      <Badge label={h.status} variant={h.status} />
                    </TD>
                  </TR>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Ingredient Credential
            </div>
            <div
              style={{
                background: `linear-gradient(135deg, ${T.navyDark} 0%, #0A2240 100%)`,
                borderRadius: 10,
                padding: 16,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.4)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginBottom: 6,
                }}
              >
                Issued Credential
              </div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', marginBottom: 4 }}>
                {batch.name}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.teal }}>IC-{batch.id}</div>
            </div>
            <div style={{ display: 'grid', gap: 0 }}>
              {[
                { label: 'Credential ID', value: `IC-${batch.id}` },
                { label: 'Issuer', value: 'ABC Ingredients Sdn. Bhd.' },
                { label: 'Issue Date', value: batch.produced },
                { label: 'Expiry', value: batch.expires },
                { label: 'Status', value: 'Active' },
              ].map((r) => (
                <div
                  key={r.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 0',
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  <span style={{ fontSize: 11, color: T.text3 }}>{r.label}</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: r.label === 'Status' ? T.green : T.text,
                      fontFamily: r.label === 'Credential ID' ? MONO : undefined,
                    }}
                  >
                    {r.value}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 12 }}>
              Disclosure Settings
            </div>
            <div style={{ fontSize: 12, color: T.text2, marginBottom: 12 }}>
              Confidential claims are never shared without explicit approval.
            </div>
            {[
              { claim: 'Ingredient name', level: 'Public' },
              { claim: 'Batch number', level: 'Public' },
              { claim: 'Origin', level: 'Public' },
              { claim: 'Certifications', level: 'Restricted' },
              { claim: 'Quantity', level: 'Restricted' },
              { claim: 'Quality tests', level: 'Confidential' },
            ].map((row) => (
              <div
                key={row.claim}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '7px 0',
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <span style={{ fontSize: 12, color: T.text }}>{row.claim}</span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 5,
                    background:
                      row.level === 'Public'
                        ? T.greenBg
                        : row.level === 'Restricted'
                          ? T.amberBg
                          : T.redBg,
                    color:
                      row.level === 'Public'
                        ? T.green
                        : row.level === 'Restricted'
                          ? T.amber
                          : T.red,
                  }}
                >
                  {row.level}
                </span>
              </div>
            ))}
          </Card>

          <div style={{ display: 'grid', gap: 8 }}>
            <Btn full>View Credential Details</Btn>
            <Btn variant="secondary" full>
              View Related Requests
            </Btn>
            <Btn variant="outline" full onClick={() => setShowTech((o) => !o)}>
              {showTech ? 'Hide' : 'View'} Technical Details
            </Btn>
          </div>

          {showTech && (
            <Card>
              <div style={{ fontWeight: 700, fontSize: 13, color: T.navy, marginBottom: 10 }}>
                Technical Details
              </div>
              {[
                { label: 'Issuer DID', value: 'did:ethr:0x8A31…92F0' },
                { label: 'Credential ID', value: `IC-${batch.id}` },
                { label: 'Blockchain Tx', value: '0x3f8a2c…b04d' },
                { label: 'Block Number', value: '7,412,099' },
                { label: 'Network', value: 'Sepolia' },
              ].map((r) => (
                <div
                  key={r.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '7px 0',
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  <span style={{ fontSize: 11, color: T.text3 }}>{r.label}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: T.teal }}>{r.value}</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
