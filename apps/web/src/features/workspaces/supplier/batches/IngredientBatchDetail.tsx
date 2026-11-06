import { useOperationalData } from '../../../blockchain/useOperationalData';
import { Alert, Badge, Btn, Card, EmptyState, T } from '../../shared/ui';
import { chainDate, recordStatuses, shortChainId } from '../../shared/operational-format';
export function IngredientBatchDetail({
  batchId,
  onBack,
}: {
  batchId: string;
  onBack: () => void;
}) {
  const { data, error, loading } = useOperationalData();
  const batch = data.ingredientBatches.find((b) => b.batchId === batchId);
  if (error) return <Alert type="error" message={error} />;
  if (loading) return <div>Reading IngredientRegistry…</div>;
  if (!batch)
    return (
      <EmptyState
        icon={<span />}
        title="Batch not found on chain"
        sub="This wallet does not own the requested ingredient batch."
      />
    );
  const fields = [
    ['Batch ID', batch.batchId],
    ['Supplier', batch.supplier],
    ['Total quantity', batch.totalQuantity],
    ['Available quantity', batch.availableQuantity],
    ['Produced', chainDate(batch.producedAt)],
    ['Expires', chainDate(batch.expiresAt)],
    ['Credential ID', batch.credentialId],
    ['Metadata hash', batch.metadataHash],
    ['Encrypted CID', batch.encryptedCid || '—'],
  ];
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
        <Btn variant="ghost" size="sm" onClick={onBack}>
          Back to Batches
        </Btn>
        <h2 style={{ margin: 0, color: T.navy }}>Ingredient · {shortChainId(batch.batchId)}</h2>
        <Badge
          label={recordStatuses[batch.status] ?? 'Unknown'}
          variant={batch.status === 1 ? 'active' : 'pending'}
        />
      </div>
      <Card>
        <b>On-chain record</b>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', marginTop: 12 }}>
          {fields.map(([label, value]) => (
            <div key={label} style={{ padding: '10px 0', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.text2 }}>{label}</div>
              <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{value}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
