import { FlaskConical } from 'lucide-react';
import { T, MONO, Btn, Card, Badge, EmptyState } from '../../shared/ui';
import { type EvidenceRequest } from './types';
import { STATUS_LABEL, STATUS_VARIANT } from './fixtures';

export function RequestsTable({
  tab,
  filteredRequests,
  setView,
  setActiveId,
}: {
  tab: 'requests' | 'accepted';
  filteredRequests: EvidenceRequest[];
  setView: (view: 'list' | 'wizard' | 'detail' | 'review') => void;
  setActiveId: (id: string | null) => void;
}) {
  return (
    <>
      {/* Requests tab */}
      {tab === 'requests' &&
        (filteredRequests.length === 0 ? (
          <EmptyState
            icon={<FlaskConical size={44} />}
            title="No evidence requests"
            sub="Send a request to a supplier to get started."
            action={<Btn onClick={() => setView('wizard')}>Request Ingredient Evidence</Btn>}
          />
        ) : (
          <Card padding="0px">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: T.surface2 }}>
                    {[
                      'Request ID',
                      'Supplier',
                      'Ingredient',
                      'Batch',
                      'Claims',
                      'Request Date',
                      'Due',
                      'Status',
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
                  {filteredRequests.map((r) => {
                    const actionLabel =
                      r.status === 'awaiting'
                        ? 'View Request'
                        : r.status === 'received'
                          ? 'Review Evidence'
                          : r.status === 'accepted'
                            ? 'View Evidence'
                            : 'View Reason';
                    const openView: 'review' | 'detail' =
                      r.status === 'received' ? 'review' : 'detail';
                    return (
                      <tr
                        key={r.id}
                        onClick={() => {
                          setActiveId(r.id);
                          setView(openView);
                        }}
                        style={{ borderBottom: `1px solid ${T.border}`, cursor: 'pointer' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = T.surface2)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                      >
                        <td
                          style={{
                            padding: '11px 14px',
                            fontFamily: MONO,
                            fontSize: 11.5,
                            color: T.teal,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {r.id}
                        </td>
                        <td
                          style={{
                            padding: '11px 14px',
                            fontSize: 12.5,
                            color: T.text,
                            maxWidth: 160,
                          }}
                        >
                          <div
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {r.supplier.split(' ')[0]}
                          </div>
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: 12.5, color: T.text }}>
                          {r.ingredient}
                        </td>
                        <td
                          style={{
                            padding: '11px 14px',
                            fontFamily: MONO,
                            fontSize: 11,
                            color: T.text2,
                          }}
                        >
                          {r.batch}
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: T.text2 }}>
                          {r.claims.length} claims
                        </td>
                        <td
                          style={{
                            padding: '11px 14px',
                            fontFamily: MONO,
                            fontSize: 11,
                            color: T.text2,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {r.requestDate}
                        </td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          <div
                            style={{
                              fontFamily: MONO,
                              fontSize: 11,
                              color: r.overdue && r.status === 'awaiting' ? T.red : T.text2,
                            }}
                          >
                            {r.dueDate}
                          </div>
                          {r.overdue && r.status === 'awaiting' && (
                            <div
                              style={{ fontSize: 9.5, color: T.red, fontWeight: 700, marginTop: 2 }}
                            >
                              Overdue
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          <Badge
                            label={STATUS_LABEL[r.status]}
                            variant={STATUS_VARIANT[r.status] as any}
                          />
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <Btn
                            size="xs"
                            variant={r.status === 'received' ? 'primary' : 'outline'}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveId(r.id);
                              setView(openView);
                            }}
                          >
                            {actionLabel}
                          </Btn>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
    </>
  );
}
