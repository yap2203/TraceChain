import { useOperationalData } from '../../../blockchain/useOperationalData';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  T,
  Table,
  TD,
  TechnicalDetails,
  TR,
} from '../../shared/ui';
import { chainDate, recordStatuses, shortChainId } from '../../shared/operational-format';
export function ProductBatchDetail({
  batchId,
  onBack,
  onTransfer,
}: {
  batchId: string;
  onBack: () => void;
  onTransfer: () => void;
}) {
  const { data, error, loading } = useOperationalData();
  const p = data.productBatches.find((x) => x.batchId === batchId);
  if (error) return <Alert type="error" message={error} />;
  if (loading) return <div>Reading ProductRegistry…</div>;
  if (!p)
    return (
      <EmptyState
        icon={<span />}
        title="Product not found on chain"
        sub="This product is not available to the authenticated wallet."
      />
    );
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
        <Btn variant="ghost" size="sm" onClick={onBack}>
          Back
        </Btn>
        <h2 style={{ margin: 0, color: T.navy, flex: 1 }}>Product batch</h2>
        <Badge
          label={recordStatuses[p.status] ?? 'Unknown'}
          variant={p.status === 1 ? 'active' : 'pending'}
        />
        <Btn onClick={onTransfer}>Transfer Product</Btn>
      </div>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          {[
            ['Manufacturer', p.manufacturerName ?? 'Verified Manufacturer'],
            ['Quantity', p.totalQuantity],
            ['Produced', chainDate(p.producedAt)],
            ['Expires', chainDate(p.expiresAt)],
          ].map(([l, v]) => (
            <div key={l} style={{ padding: '10px 0', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.text2 }}>{l}</div>
              <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{v}</div>
            </div>
          ))}
        </div>
        <TechnicalDetails
          fields={[
            { label: 'Product batch ID', value: p.batchId },
            { label: 'Manufacturer wallet', value: p.manufacturer },
            { label: 'Metadata hash', value: p.metadataHash },
            { label: 'Public CID', value: p.publicCid },
          ]}
        />
      </Card>
      <Card>
        <b>Linked ingredients</b>
        <Table headers={['Ingredient batch', 'Quantity']}>
          {p.ingredients.map((i) => (
            <TR key={i.batchId}>
              <TD mono>{shortChainId(i.batchId)}</TD>
              <TD>{i.quantity}</TD>
            </TR>
          ))}
        </Table>
      </Card>
    </div>
  );
}
