import { ArrowUpRight, CheckCircle, Package, TrendingUp } from 'lucide-react';
import { useOperationalData } from '../../blockchain/useOperationalData';
import { Alert, Badge, Btn, Card, EmptyState, StatCard, T } from '../shared/ui';
import { recordStatuses, shortChainId } from '../shared/operational-format';
export function ManufacturerOverview({ onNav }: { onNav: (tab: string) => void }) {
  const { data, error, loading } = useOperationalData();
  const pending = data.transfers.filter((t) => t.status === 1);
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {error && <Alert type="error" message={error} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <StatCard
          label="Product Batches"
          value={loading ? '…' : String(data.productBatches.length)}
          color={T.navy}
          icon={<Package size={22} />}
        />
        <StatCard
          label="Active Products"
          value={String(data.productBatches.filter((p) => p.status === 1).length)}
          color={T.teal}
          icon={<TrendingUp size={22} />}
        />
        <StatCard
          label="Accepted Evidence"
          value={String(data.evidenceRequests.filter((r) => r.status === 3).length)}
          color={T.green}
          icon={<CheckCircle size={22} />}
        />
        <StatCard
          label="Pending Transfers"
          value={String(pending.length)}
          color={T.grey}
          icon={<ArrowUpRight size={22} />}
        />
      </div>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <b>On-chain product batches</b>
          <Btn size="sm" variant="outline" onClick={() => onNav('products')}>
            View all
          </Btn>
        </div>
        {!loading && data.productBatches.length === 0 ? (
          <EmptyState
            icon={<Package size={40} />}
            title="No product batches on chain"
            sub="Create a product after accepting ingredient evidence."
          />
        ) : (
          data.productBatches.slice(0, 4).map((p) => (
            <div
              key={p.batchId}
              style={{
                padding: '10px 0',
                borderBottom: `1px solid ${T.border}`,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <b>{shortChainId(p.batchId)}</b>
                <div style={{ fontSize: 12, color: T.text2 }}>
                  {p.totalQuantity} units · {p.ingredients.length} linked ingredients
                </div>
              </div>
              <Badge
                label={recordStatuses[p.status] ?? 'Unknown'}
                variant={p.status === 1 ? 'active' : 'pending'}
              />
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
