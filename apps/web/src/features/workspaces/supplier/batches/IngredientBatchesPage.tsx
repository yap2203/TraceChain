import { Boxes } from 'lucide-react';
import { useEffect, useState } from 'react';

import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { Alert, Badge, Btn, Card, EmptyState, SectionTitle, Table, TD, TR } from '../../shared/ui';
import { shortChainId } from '../../shared/operational-format';
import { getIngredientBatches, type RegisteredIngredientBatch } from './ingredient-batch.api';

export function IngredientBatches({
  onNew,
  onDetail,
}: {
  onNew: () => void;
  onDetail: (id: string) => void;
}) {
  const [batches, setBatches] = useState<RegisteredIngredientBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getIngredientBatches()
      .then(({ batches: result }) => {
        if (active) setBatches(result);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : 'Ingredient batches could not be loaded.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <SectionTitle
        title="Ingredient Batches"
        sub="Verified credentials and current IngredientRegistry records for this Supplier"
        action={<Btn onClick={onNew}>Register Ingredient Batch</Btn>}
      />
      {loading && (
        <Card>
          <LoadingIndicator label="Loading ingredient batches" />
        </Card>
      )}
      {error && <Alert type="error" message={error} />}
      {!loading && !error && batches.length === 0 && (
        <EmptyState
          icon={<Boxes size={44} />}
          title="No on-chain ingredient batches"
          sub="Register the first Ingredient Credential and batch with MetaMask."
          action={<Btn onClick={onNew}>Register Ingredient Batch</Btn>}
        />
      )}
      {!loading && !error && batches.length > 0 && (
        <Card padding="0">
          <Table
            headers={[
              'Batch reference',
              'Ingredient',
              'On-chain ID',
              'Origin',
              'Available',
              'Produced',
              'Status',
              '',
            ]}
          >
            {batches.map((batch) => (
              <TR key={batch.batchId} onClick={() => onDetail(batch.batchId)}>
                <TD bold>{batch.batchReference}</TD>
                <TD>{batch.ingredientName}</TD>
                <TD mono muted>
                  {shortChainId(batch.batchId)}
                </TD>
                <TD muted>{batch.origin || 'Private'}</TD>
                <TD>
                  {batch.availableQuantity} {batch.unit}
                </TD>
                <TD muted>{formatDate(batch.producedAt)}</TD>
                <TD>
                  <Badge
                    label={batch.status === 1 ? 'Active' : 'Unavailable'}
                    variant={batch.status === 1 ? 'active' : 'pending'}
                  />
                </TD>
                <TD>
                  <Btn
                    onClick={(event) => {
                      event.stopPropagation();
                      onDetail(batch.batchId);
                    }}
                    variant="outline"
                    size="xs"
                  >
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

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp * 1_000);
}
