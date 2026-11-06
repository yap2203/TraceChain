import { CheckCircle, ClipboardList, Package, Store } from 'lucide-react';
import { useOperationalData } from '../../blockchain/useOperationalData';
import { Alert, Badge, Btn, Card, EmptyState, StatCard, T } from '../shared/ui';
import { shortChainId, transferStatuses } from '../shared/operational-format';
export function RetailerOverview({ onNav }: { onNav: (tab: string) => void }) {
  const { data, error, loading } = useOperationalData();
  const incoming = data.transfers.filter((t) => t.direction === 'incoming' && t.status === 1);
  const stock = data.transfers
    .filter(
      (transfer, index, all) =>
        all.findIndex((candidate) => candidate.productBatchId === transfer.productBatchId) === index,
    )
    .reduce((sum, transfer) => sum + BigInt(transfer.inventory.available), 0n);
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {error && <Alert type="error" message={error} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <StatCard
          label="Incoming Shipments"
          value={loading ? '…' : String(incoming.length)}
          color={T.amber}
          icon={<Package size={22} />}
        />
        <StatCard
          label="Products in Stock"
          value={String(stock)}
          color={T.navy}
          icon={<Store size={22} />}
        />
        <StatCard
          label="Evidence Requests"
          value={String(data.evidenceRequests.length)}
          color={T.grey}
          icon={<ClipboardList size={22} />}
        />
        <StatCard
          label="Received Transfers"
          value={String(data.transfers.filter((t) => t.status === 2).length)}
          color={T.green}
          icon={<CheckCircle size={22} />}
        />
      </div>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <b>On-chain incoming shipments</b>
          <Btn size="sm" variant="outline" onClick={() => onNav('receive')}>
            View all
          </Btn>
        </div>
        {!loading && incoming.length === 0 ? (
          <EmptyState
            icon={<Package size={40} />}
            title="No incoming shipments"
            sub="Distributor transfers will appear here."
          />
        ) : (
          incoming.map((t) => (
            <div
              key={t.transferId}
              style={{
                padding: '10px 0',
                borderBottom: `1px solid ${T.border}`,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <b>{shortChainId(t.productBatchId)}</b>
                <div style={{ fontSize: 12, color: T.text2 }}>
                  {t.quantity} units · {shortChainId(t.sender)}
                </div>
              </div>
              <Badge label={transferStatuses[t.status]} variant="transfer-pending" />
            </div>
          ))
        )}
      </Card>
      <Card>
        <b>Quick actions</b>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <Btn onClick={() => onNav('scan')} variant="secondary" full>
            Scan & Verify QR
          </Btn>
          <Btn onClick={() => onNav('history')} variant="outline" full>
            Product History
          </Btn>
        </div>
      </Card>
    </div>
  );
}
