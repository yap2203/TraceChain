import { useState } from 'react';
import { T, Btn, Card, Badge, Alert, Modal, Textarea } from '../../shared/ui';
import { type EvidenceRequest } from './types';
import { STATUS_LABEL, STATUS_VARIANT } from './fixtures';
import { SupplierIdentityCard } from './SupplierIdentityCard';
import { RequestTimeline } from './RequestTimeline';

export function RequestDetail({
  req,
  onBack,
  onReview,
  onFollowUp,
  onCancel,
}: {
  req: EvidenceRequest;
  onBack: () => void;
  onReview: () => void;
  onFollowUp: () => void;
  onCancel: (reason: string) => void;
}) {
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back to Requests
        </Btn>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 17, color: T.navy }}>{req.id}</span>
            <Badge label={STATUS_LABEL[req.status]} variant={STATUS_VARIANT[req.status] as any} />
            {req.overdue && (
              <span
                style={{
                  fontSize: 10,
                  background: T.redBg,
                  color: T.red,
                  border: `1px solid color-mix(in srgb, ${T.red} 19%, transparent)`,
                  borderRadius: 5,
                  padding: '2px 7px',
                  fontWeight: 700,
                }}
              >
                Overdue
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: T.text2, marginTop: 3 }}>
            {req.ingredient} · {req.batch} · {req.supplier}
          </div>
        </div>
        {req.status === 'received' && <Btn onClick={onReview}>Review Evidence</Btn>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 12 }}>
              Supplier
            </div>
            <SupplierIdentityCard name={req.supplier} did={req.supplierDid} credStatus="active" />
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 12 }}>
              Request Details
            </div>
            <div style={{ display: 'grid', gap: 0 }}>
              {[
                { label: 'Ingredient', value: req.ingredient },
                { label: 'Batch', value: req.batch },
                { label: 'Request Date', value: req.requestDate },
                { label: 'Response Due', value: req.dueDate },
                { label: 'Reason', value: req.reason },
              ].map((r) => (
                <div
                  key={r.label}
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: '9px 0',
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  <div style={{ fontSize: 11, color: T.text3, width: 120, flexShrink: 0 }}>
                    {r.label}
                  </div>
                  <div style={{ fontSize: 13, color: T.text }}>{r.value}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 12 }}>
              Requested Claims
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {req.claims.map((c) => (
                <div
                  key={c.name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '7px 10px',
                    background: T.surface2,
                    borderRadius: 7,
                  }}
                >
                  <span style={{ fontSize: 13, color: T.text }}>{c.name}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: c.req === 'required' ? T.amber : T.teal,
                    }}
                  >
                    {c.req === 'required' ? 'Required' : 'Optional'}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {req.declineReason && (
            <Alert type="error" message={`Declined by supplier: ${req.declineReason}`} />
          )}
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 12 }}>
              Timeline
            </div>
            <RequestTimeline events={req.timeline} />
          </Card>

          {req.status === 'awaiting' && (
            <Btn onClick={() => setShowCancel(true)} variant="danger" full>
              Cancel Request
            </Btn>
          )}
          {req.status === 'declined' && (
            <Btn onClick={onFollowUp} variant="secondary" full>
              Create Follow-up Request
            </Btn>
          )}
        </div>
      </div>

      {showCancel && (
        <Modal title="Cancel Evidence Request" onClose={() => setShowCancel(false)}>
          <div style={{ fontSize: 13, color: T.text2, marginBottom: 16 }}>
            This will cancel request <strong>{req.id}</strong> for {req.ingredient} from{' '}
            {req.supplier}.
          </div>
          <Textarea
            label="Cancellation Reason"
            value={cancelReason}
            onChange={setCancelReason}
            placeholder="Why are you cancelling this request?"
            rows={3}
            required
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn onClick={() => setShowCancel(false)} variant="ghost">
              Keep Request
            </Btn>
            <Btn
              onClick={() => {
                onCancel(cancelReason);
                setShowCancel(false);
              }}
              variant="danger"
              full
              disabled={!cancelReason.trim()}
            >
              Confirm Cancellation
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
