import { Boxes, ClipboardList, PackageCheck, ShieldCheck } from 'lucide-react';
import { useOperationalData } from '../../blockchain/useOperationalData';
import { T, Alert, Btn, Card, EmptyState, StatCard, Badge } from '../shared/ui';
import { evidenceStatuses, recordStatuses, shortChainId } from '../shared/operational-format';
export function SupplierOverview({ onNav }: { onNav: (tab: string) => void }) {
  const { data, error, loading } = useOperationalData();
  const pending = data.evidenceRequests.filter((r) => r.status === 1);
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {error && <Alert type="error" message={error} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <StatCard
          label="Ingredient Batches"
          value={loading ? '…' : String(data.ingredientBatches.length)}
          color={T.navy}
          icon={<Boxes size={22} />}
        />
        <StatCard
          label="Available Batches"
          value={String(
            data.ingredientBatches.filter((b) => b.status === 1 && BigInt(b.availableQuantity) > 0n)
              .length,
          )}
          color={T.green}
          icon={<PackageCheck size={22} />}
        />
        <StatCard
          label="Evidence Requests"
          value={String(data.evidenceRequests.length)}
          color={T.grey}
          icon={<ClipboardList size={22} />}
        />
        <StatCard
          label="Awaiting Response"
          value={String(pending.length)}
          color={T.amber}
          icon={<ShieldCheck size={22} />}
        />
      </div>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <b>On-chain ingredient batches</b>
          <Btn size="sm" variant="outline" onClick={() => onNav('batches')}>
            View all
          </Btn>
        </div>
        {!loading && data.ingredientBatches.length === 0 ? (
          <EmptyState
            title="No ingredient batches on chain"
            sub="Register a batch to create the first record."
            icon={<Boxes size={40} />}
          />
        ) : (
          data.ingredientBatches.slice(0, 4).map((b) => (
            <div
              key={b.batchId}
              style={{
                padding: '10px 0',
                borderBottom: `1px solid ${T.border}`,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <b>{shortChainId(b.batchId)}</b>
                <div style={{ color: T.text2, fontSize: 12 }}>
                  {b.availableQuantity} / {b.totalQuantity} available
                </div>
              </div>
              <Badge
                label={recordStatuses[b.status] ?? 'Unknown'}
                variant={b.status === 1 ? 'active' : 'pending'}
              />
            </div>
          ))
        )}
      </Card>
      {pending.length > 0 && (
        <Card>
          <b>Requests needing response</b>
          {pending.map((r) => (
            <div
              key={r.requestId}
              style={{ padding: '10px 0', borderBottom: `1px solid ${T.border}` }}
            >
              {shortChainId(r.ingredientBatchId)} · {evidenceStatuses[r.status]}
            </div>
          ))}
          <Btn onClick={() => onNav('requests')} size="sm">
            Review requests
          </Btn>
        </Card>
      )}
    </div>
  );
}
