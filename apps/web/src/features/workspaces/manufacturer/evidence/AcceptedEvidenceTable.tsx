import { CheckCircle2, RefreshCw } from 'lucide-react';
import { T, MONO, Btn, Card, Badge, EmptyState } from '../../shared/ui';
import { type AcceptedEvidence } from './types';
import { AVAIL_LABEL, AVAIL_COLOR } from './fixtures';

export function AcceptedEvidenceTable({
  tab,
  filteredAccepted,
  onNav,
}: {
  tab: 'requests' | 'accepted';
  filteredAccepted: AcceptedEvidence[];
  onNav: (tab: string) => void;
}) {
  return (
    <>
      {/* Accepted Evidence tab */}
      {tab === 'accepted' &&
        (filteredAccepted.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={44} />}
            title="No accepted evidence"
            sub="Accepted ingredient evidence will appear here."
          />
        ) : (
          <Card padding="0px">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: T.surface2 }}>
                    {[
                      'Ingredient',
                      'Batch',
                      'Supplier',
                      'Credential ID',
                      'Accepted',
                      'Credential Expiry',
                      'Cred. Status',
                      'Availability',
                      'Action',
                    ].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: '10px 14px',
                          textAlign: 'left',
                          fontSize: 11,
                          color: T.text2,
                          fontWeight: 600,
                          letterSpacing: '0.05em',
                          textTransform: 'uppercase',
                          borderBottom: `1px solid ${T.border}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAccepted.map((a) => (
                    <tr key={a.reqId} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td
                        style={{
                          padding: '11px 14px',
                          fontSize: 13,
                          color: T.text,
                          fontWeight: 500,
                        }}
                      >
                        {a.ingredient}
                      </td>
                      <td
                        style={{
                          padding: '11px 14px',
                          fontFamily: MONO,
                          fontSize: 11,
                          color: T.text2,
                        }}
                      >
                        {a.batch}
                      </td>
                      <td style={{ padding: '11px 14px', fontSize: 12, color: T.text2 }}>
                        {a.supplier.split(' ')[0]}
                      </td>
                      <td
                        style={{
                          padding: '11px 14px',
                          fontFamily: MONO,
                          fontSize: 11,
                          color: T.teal,
                        }}
                      >
                        {a.credentialId}
                      </td>
                      <td
                        style={{
                          padding: '11px 14px',
                          fontFamily: MONO,
                          fontSize: 11,
                          color: T.text2,
                        }}
                      >
                        {a.acceptedDate}
                      </td>
                      <td
                        style={{
                          padding: '11px 14px',
                          fontFamily: MONO,
                          fontSize: 11,
                          color: T.text2,
                        }}
                      >
                        {a.credentialExpiry}
                      </td>
                      <td style={{ padding: '11px 14px' }}>
                        <Badge label={a.credentialStatus} variant={a.credentialStatus} />
                      </td>
                      <td style={{ padding: '11px 14px' }}>
                        <span
                          style={{
                            fontSize: 11.5,
                            fontWeight: 600,
                            color: AVAIL_COLOR[a.availability],
                          }}
                        >
                          {AVAIL_LABEL[a.availability]}
                        </span>
                      </td>
                      <td style={{ padding: '11px 14px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Btn size="xs" variant="outline">
                            View Evidence
                          </Btn>
                          <Btn size="xs" variant="ghost">
                            <RefreshCw size={11} />
                          </Btn>
                          <Btn
                            size="xs"
                            onClick={() => onNav('products')}
                            disabled={a.availability !== 'available'}
                          >
                            Use in Batch
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
    </>
  );
}
