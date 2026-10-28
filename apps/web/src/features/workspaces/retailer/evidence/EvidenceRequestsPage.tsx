import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { T, MONO, Btn, Card, Badge, Table, TR, TD, Alert, SectionTitle } from '../../shared/ui';

export function RetailerEvidenceRequests() {
  const [selected, setSelected] = useState<string | null>(null);

  const REQUESTS = [
    {
      id: 'EVREQ-2026-011',
      to: 'CocoaCraft Manufacturing Sdn. Bhd.',
      product: 'CHOCOLATE-2026-050',
      subject: 'Request for full ingredient credential disclosure',
      claims: ['Full batch production details', 'All supplier identities', 'Allergen declaration'],
      status: 'pending' as const,
      sent: '2026-08-20',
      due: '2026-08-27',
    },
    {
      id: 'EVREQ-2026-008',
      to: 'ABC Ingredients Sdn. Bhd.',
      product: 'CHOCOLATE-2026-050',
      subject: 'Halal certification evidence for Cocoa Powder batch',
      claims: ['Halal certificate', 'Certification body', 'Certificate expiry'],
      status: 'shared' as const,
      sent: '2026-08-10',
      due: '2026-08-17',
    },
    {
      id: 'EVREQ-2026-005',
      to: 'GrainCo Processing Sdn. Bhd.',
      product: 'BISCUIT-2026-018',
      subject: 'Food safety certificate for Oat Biscuit batch',
      claims: ['Food safety certification', 'Inspection date', 'Inspector details'],
      status: 'rejected' as const,
      sent: '2026-07-28',
      due: '2026-08-04',
    },
  ];

  const sel = REQUESTS.find((r) => r.id === selected);

  return (
    <div>
      <SectionTitle
        title="Evidence Requests"
        sub="Evidence you have requested from manufacturers and suppliers"
        action={<Btn size="sm">New Evidence Request</Btn>}
      />
      <div
        style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: 20 }}
      >
        <Card padding="0">
          <Table headers={['Request ID', 'To', 'Product', 'Subject', 'Sent', 'Due', 'Status', '']}>
            {REQUESTS.map((r) => (
              <TR key={r.id} onClick={() => setSelected(r.id === selected ? null : r.id)}>
                <TD mono muted>
                  {r.id}
                </TD>
                <TD muted>{r.to.split(' Sdn')[0]}</TD>
                <TD mono muted>
                  {r.product}
                </TD>
                <TD>{r.subject}</TD>
                <TD muted>{r.sent}</TD>
                <TD muted>{r.due}</TD>
                <TD>
                  <Badge
                    label={r.status}
                    variant={
                      r.status === 'shared'
                        ? 'accepted'
                        : r.status === 'rejected'
                          ? 'rejected'
                          : 'pending'
                    }
                  />
                </TD>
                <TD>
                  <Btn variant="outline" size="xs">
                    View
                  </Btn>
                </TD>
              </TR>
            ))}
          </Table>
        </Card>

        {sel && (
          <Card>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 16,
              }}
            >
              <div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3, marginBottom: 4 }}>
                  {sel.id}
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: T.navy }}>{sel.subject}</div>
              </div>
              <button
                onClick={() => setSelected(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: T.text3,
                  fontSize: 18,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'grid', gap: 0, marginBottom: 16 }}>
              {[
                { label: 'Requested from', value: sel.to },
                { label: 'Product batch', value: sel.product },
                { label: 'Date sent', value: sel.sent },
                { label: 'Response due', value: sel.due },
              ].map((row) => (
                <div
                  key={row.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    padding: '7px 0',
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  <span style={{ color: T.text2 }}>{row.label}</span>
                  <span
                    style={{
                      fontWeight: 600,
                      color: T.navy,
                      fontFamily: row.label === 'Product batch' ? MONO : undefined,
                    }}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: T.text2,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                marginBottom: 8,
              }}
            >
              Claims Requested
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {sel.claims.map((c) => (
                <div
                  key={c}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 10px',
                    background: T.surface2,
                    borderRadius: 6,
                  }}
                >
                  <CheckCircle2 size={12} color={sel.status === 'shared' ? T.teal : T.text3} />
                  <span style={{ fontSize: 12, color: T.navy }}>{c}</span>
                </div>
              ))}
            </div>
            {sel.status === 'shared' && (
              <Alert
                type="success"
                message="Evidence has been shared. You can now view the verifiable presentation."
              />
            )}
            {sel.status === 'pending' && (
              <Alert
                type="warning"
                message={`Response due by ${sel.due}. The respondent has not yet replied.`}
              />
            )}
            {sel.status === 'rejected' && (
              <Alert
                type="error"
                message="The respondent declined to share the requested evidence."
              />
            )}
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              {sel.status === 'shared' && (
                <Btn full size="sm">
                  View Shared Evidence
                </Btn>
              )}
              {sel.status === 'pending' && (
                <Btn variant="outline" full size="sm">
                  Send Reminder
                </Btn>
              )}
              {sel.status === 'rejected' && (
                <Btn variant="outline" full size="sm">
                  Send Follow-up
                </Btn>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
