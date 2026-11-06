import { Boxes } from 'lucide-react';
import { useOperationalData } from '../../../blockchain/useOperationalData';
import { Alert, Badge, Btn, Card, EmptyState, SectionTitle, Table, TD, TR } from '../../shared/ui';
import { chainDate, recordStatuses, shortChainId } from '../../shared/operational-format';
export function IngredientBatches({
  onNew,
  onDetail,
}: {
  onNew: () => void;
  onDetail: (id: string) => void;
}) {
  const { data, error, loading } = useOperationalData();
  return (
    <div>
      <SectionTitle
        title="Ingredient Batches"
        sub="Current records read from IngredientRegistry"
        action={<Btn onClick={onNew}>+ Register Batch</Btn>}
      />
      {error && <Alert type="error" message={error} />}
      {!loading && data.ingredientBatches.length === 0 ? (
        <EmptyState
          icon={<Boxes size={44} />}
          title="No on-chain ingredient batches"
          sub="Registered batches belonging to this wallet will appear here."
        />
      ) : (
        <Card padding="0">
          <Table
            headers={['Batch ID', 'Quantity', 'Available', 'Produced', 'Expires', 'Status', '']}
          >
            {data.ingredientBatches.map((b) => (
              <TR key={b.batchId}>
                <TD mono muted>
                  {shortChainId(b.batchId)}
                </TD>
                <TD>{b.totalQuantity}</TD>
                <TD bold>{b.availableQuantity}</TD>
                <TD muted>{chainDate(b.producedAt)}</TD>
                <TD muted>{chainDate(b.expiresAt)}</TD>
                <TD>
                  <Badge
                    label={recordStatuses[b.status] ?? 'Unknown'}
                    variant={b.status === 1 ? 'active' : 'pending'}
                  />
                </TD>
                <TD>
                  <Btn size="xs" variant="outline" onClick={() => onDetail(b.batchId)}>
                    View →
                  </Btn>
                </TD>
              </TR>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
