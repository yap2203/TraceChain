import { Package } from 'lucide-react';
import { useOperationalData } from '../../../blockchain/useOperationalData';
import { Alert, Badge, Btn, Card, EmptyState, SectionTitle, Table, TD, TR } from '../../shared/ui';
import { chainDate, recordStatuses } from '../../shared/operational-format';
export function ProductBatches({
  onNew,
  onTransfer,
  onDetail,
}: {
  onNew: () => void;
  onTransfer: () => void;
  onDetail: (id: string) => void;
}) {
  const { data, error, loading } = useOperationalData();
  return (
    <div>
      <SectionTitle
        title="Product Batches"
        sub="Current records read from ProductRegistry"
        action={<Btn onClick={onNew}>+ Create Product Batch</Btn>}
      />
      {error && <Alert type="error" message={error} />}{' '}
      {!loading && data.productBatches.length === 0 ? (
        <EmptyState
          icon={<Package size={44} />}
          title="No on-chain product batches"
          sub="Products created by this wallet will appear here."
        />
      ) : (
        <Card padding="0">
          <Table
            headers={['Product', 'Quantity', 'Ingredients', 'Produced', 'Expires', 'Status', '']}
          >
            {data.productBatches.map((p) => (
              <TR key={p.batchId}>
                <TD bold>Verified product batch</TD>
                <TD>{p.totalQuantity}</TD>
                <TD>{p.ingredients.length} linked</TD>
                <TD muted>{chainDate(p.producedAt)}</TD>
                <TD muted>{chainDate(p.expiresAt)}</TD>
                <TD>
                  <Badge
                    label={recordStatuses[p.status] ?? 'Unknown'}
                    variant={p.status === 1 ? 'active' : 'pending'}
                  />
                </TD>
                <TD>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn size="xs" variant="outline" onClick={() => onDetail(p.batchId)}>
                      View
                    </Btn>
                    <Btn size="xs" onClick={onTransfer}>
                      Transfer
                    </Btn>
                  </div>
                </TD>
              </TR>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
