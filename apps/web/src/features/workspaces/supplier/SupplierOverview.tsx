import { Boxes, ClipboardList, PackageCheck, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useOperationalData } from '../../blockchain/useOperationalData';
import { Alert, Badge, Btn, Card, EmptyState, StatCard, T } from '../shared/ui';
import { evidenceStatuses, shortChainId } from '../shared/operational-format';
import {
  getIngredientBatches,
  type RegisteredIngredientBatch,
} from './batches/ingredient-batch.api';

export function SupplierOverview({ onNav }: { onNav: (tab: string) => void }) {
  const { data, error: operationalError, loading: operationalLoading } = useOperationalData();
  const [batches, setBatches] = useState<RegisteredIngredientBatch[]>([]);
  const [batchError, setBatchError] = useState('');
  const [batchesLoading, setBatchesLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getIngredientBatches()
      .then(({ batches: result }) => {
        if (active) setBatches(result);
      })
      .catch((caught: unknown) => {
        if (active)
          setBatchError(caught instanceof Error ? caught.message : 'Batches could not be loaded.');
      })
      .finally(() => {
        if (active) setBatchesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const activeBatches = batches.filter((batch) => batch.status === 1);
  const availableBatches = activeBatches.filter((batch) => BigInt(batch.availableQuantity) > 0n);
  const pendingRequests = data.evidenceRequests.filter((request) => request.status === 1);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {batchError && <Alert type="error" message={batchError} />}
      {operationalError && <Alert type="error" message={operationalError} />}

      <div className="workspace-stat-grid">
        <StatCard
          label="Ingredient Batches"
          value={batchesLoading ? '…' : String(batches.length)}
          color={T.navy}
          icon={<Boxes size={22} />}
        />
        <StatCard
          label="Available Batches"
          value={String(availableBatches.length)}
          color={T.green}
          icon={<PackageCheck size={22} />}
        />
        <StatCard
          label="Evidence Requests"
          value={operationalLoading ? '…' : String(data.evidenceRequests.length)}
          color={T.grey}
          icon={<ClipboardList size={22} />}
        />
        <StatCard
          label="Awaiting Response"
          value={String(pendingRequests.length)}
          color={T.amber}
          icon={<ShieldCheck size={22} />}
        />
      </div>

      <div className="workspace-overview-grid">
        <Card>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy }}>
              My Ingredient Batches
            </div>
            <Btn onClick={() => onNav('batches')} variant="outline" size="sm">
              View All
            </Btn>
          </div>
          {!batchesLoading && batches.length === 0 ? (
            <EmptyState
              icon={<Boxes size={40} />}
              title="No ingredient batches on chain"
              sub="Register a batch to create the first verified Ingredient Credential and record."
              action={<Btn onClick={() => onNav('batches-new')}>Register Ingredient Batch</Btn>}
            />
          ) : (
            batches.slice(0, 4).map((batch) => (
              <div
                key={batch.batchId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 0',
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.navy }}>
                    {batch.ingredientName}
                  </div>
                  <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
                    {batch.batchReference} · {batch.availableQuantity} {batch.unit} ·{' '}
                    {batch.origin || 'Private'}
                  </div>
                </div>
                <Badge
                  label={batch.status === 1 ? 'Active' : 'Unavailable'}
                  variant={batch.status === 1 ? 'active' : 'pending'}
                />
              </div>
            ))
          )}
          {batches.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <Btn onClick={() => onNav('batches-new')} full>
                + Register Ingredient Batch
              </Btn>
            </div>
          )}
        </Card>

        <Card>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy }}>
              On-chain Evidence Requests
            </div>
            <Btn onClick={() => onNav('requests')} variant="outline" size="sm">
              View All
            </Btn>
          </div>
          {!operationalLoading && pendingRequests.length === 0 ? (
            <EmptyState
              icon={<ClipboardList size={40} />}
              title="No pending requests"
              sub="New evidence requests from Manufacturers will appear here."
            />
          ) : (
            pendingRequests.slice(0, 4).map((request) => (
              <div
                key={request.requestId}
                style={{ padding: '11px 0', borderBottom: `1px solid ${T.border}` }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: T.navy }}>
                  {shortChainId(request.requestId)}
                </div>
                <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
                  Batch {shortChainId(request.ingredientBatchId)} ·{' '}
                  {evidenceStatuses[request.status] ?? 'Unknown'}
                </div>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}
