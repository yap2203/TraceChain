import { useOperationalData } from '../../../blockchain/useOperationalData';
import { Alert, Badge, Btn, Card, EmptyState, T } from '../../shared/ui';
import { chainDate, shortChainId, transferStatuses } from '../../shared/operational-format';
export function IncomingShipment({
  shipmentId,
  onBack,
}: {
  shipmentId?: string;
  onBack: () => void;
}) {
  const { data, error, loading } = useOperationalData();
  const t = data.transfers.find((x) => x.transferId === shipmentId);
  if (error) return <Alert type="error" message={error} />;
  if (loading) return <div>Reading CustodyTransfer…</div>;
  if (!t)
    return (
      <EmptyState
        icon={<span />}
        title="Transfer not found on chain"
        sub="This transfer is not addressed to the authenticated wallet."
      />
    );
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
        <Btn variant="ghost" size="sm" onClick={onBack}>
          Back
        </Btn>
        <h2 style={{ margin: 0, color: T.navy }}>
          Incoming transfer · {shortChainId(t.transferId)}
        </h2>
        <Badge
          label={transferStatuses[t.status] ?? 'Unknown'}
          variant={t.status === 2 ? 'active' : 'transfer-pending'}
        />
      </div>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          {[
            ['Product batch', t.productBatchId],
            ['Sender', t.sender],
            ['Recipient', t.recipient],
            ['Quantity', t.quantity],
            ['Dispatched', chainDate(t.dispatchedAt)],
            ['Expected', chainDate(t.expectedAt)],
            ['Shipment hash', t.shipmentHash],
            ['Shipment CID', t.shipmentCid || '—'],
          ].map(([l, v]) => (
            <div key={l} style={{ padding: '10px 0', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.text2 }}>{l}</div>
              <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{v}</div>
            </div>
          ))}
        </div>
      </Card>
      <Alert
        type="info"
        message="Receipt writes must be signed through the QR receipt flow. This view only displays authoritative contract state."
      />
    </div>
  );
}
