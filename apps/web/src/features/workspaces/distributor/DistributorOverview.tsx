import { ArrowUpRight, CheckCircle, Layers, PackageCheck } from 'lucide-react';
import { useOperationalData } from '../../blockchain/useOperationalData';
import { Alert, Badge, Btn, Card, EmptyState, StatCard, T } from '../shared/ui';
import { shortChainId, transferStatuses } from '../shared/operational-format';
export function DistributorOverview({ onNav }: { onNav: (tab: string) => void }) {
  const { data, error, loading } = useOperationalData();
  const incoming = data.transfers.filter((t) => t.direction === 'incoming' && t.status === 1);
  const inventory = data.transfers.filter(
    (transfer, index, all) =>
      all.findIndex((candidate) => candidate.productBatchId === transfer.productBatchId) === index &&
      BigInt(transfer.inventory.available) > 0n,
  );
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {error && <Alert type="error" message={error} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <StatCard
          label="Incoming Shipments"
          value={loading ? '…' : String(incoming.length)}
          color={T.amber}
          icon={<PackageCheck size={22} />}
        />
        <StatCard
          label="Inventory Batches"
          value={String(inventory.length)}
          color={T.navy}
          icon={<Layers size={22} />}
        />
        <StatCard
          label="Pending Transfers"
          value={String(
            data.transfers.filter((t) => t.direction === 'outgoing' && t.status === 1).length,
          )}
          color={T.grey}
          icon={<ArrowUpRight size={22} />}
        />
        <StatCard
          label="Completed Transfers"
          value={String(data.transfers.filter((t) => t.status === 2).length)}
          color={T.green}
          icon={<CheckCircle size={22} />}
        />
      </div>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <b>On-chain custody transfers</b>
          <Btn size="sm" variant="outline" onClick={() => onNav('incoming')}>
            View incoming
          </Btn>
        </div>
        {!loading && data.transfers.length === 0 ? (
          <EmptyState
            icon={<PackageCheck size={40} />}
            title="No transfers on chain"
            sub="Transfers involving this wallet will appear here."
          />
        ) : (
          data.transfers.slice(0, 5).map((t) => (
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
                  {t.quantity} units · {shortChainId(t.transferId)}
                </div>
              </div>
              <Badge
                label={transferStatuses[t.status] ?? 'Unknown'}
                variant={t.status === 2 ? 'active' : 'transfer-pending'}
              />
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
