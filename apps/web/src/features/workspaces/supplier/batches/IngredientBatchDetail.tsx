import { useEffect, useState } from 'react';

import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { Alert, Badge, Btn, Card, EmptyState, T, TechnicalDetails } from '../../shared/ui';
import { getIngredientBatches, type RegisteredIngredientBatch } from './ingredient-batch.api';

export function IngredientBatchDetail({
  batchId,
  onBack,
}: {
  batchId: string;
  onBack: () => void;
}) {
  const [batch, setBatch] = useState<RegisteredIngredientBatch | null>();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getIngredientBatches()
      .then(({ batches }) => {
        if (active) setBatch(batches.find((candidate) => candidate.batchId === batchId) ?? null);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : 'The batch could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [batchId]);

  if (error) return <Alert type="error" message={error} />;
  if (batch === undefined)
    return (
      <Card>
        <LoadingIndicator label="Loading ingredient batch" />
      </Card>
    );
  if (!batch)
    return (
      <EmptyState
        icon={<span />}
        title="Batch not found on chain"
        sub="This authenticated Supplier does not own the requested ingredient batch."
      />
    );

  const details = [
    ['Ingredient name', batch.ingredientName],
    ['Batch reference', batch.batchReference],
    ['Origin', batch.origin || 'Private'],
    ['Category', batch.category || 'Private'],
    ['Total quantity', `${batch.quantity} ${batch.unit}`],
    ['Available quantity', `${batch.availableQuantity} ${batch.unit}`],
    ['Production date', formatDate(batch.producedAt)],
    ['Expiry date', formatDate(batch.expiresAt)],
    ['Allergen information', batch.allergenInformation || 'None declared'],
    ['Certifications', batch.certifications.join(', ') || 'None declared'],
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back to Batches
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          {batch.ingredientName} · {batch.batchReference}
        </h2>
        <Badge
          label={batch.status === 1 ? 'Active' : 'Unavailable'}
          variant={batch.status === 1 ? 'active' : 'pending'}
        />
      </div>
      <div className="workspace-detail-grid">
        <Card>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
            Ingredient details
          </div>
          <div className="workspace-review-grid">
            {details.map(([label, value]) => (
              <div key={label} style={{ padding: '10px 0', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 11, color: T.text2, marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.navy }}>{value}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <p style={{ fontSize: 12, color: T.text2, lineHeight: 1.55, marginBottom: 0 }}>
            The complete Ingredient Credential and private metadata remain encrypted off-chain.
            Private fields are returned only to the authenticated, currently authorized Supplier.
          </p>
          <TechnicalDetails
            fields={[
              { label: 'Batch ID', value: batch.batchId },
              { label: 'Supplier wallet', value: batch.supplier },
              { label: 'Credential ID', value: batch.credentialId },
              { label: 'Metadata hash', value: batch.metadataHash },
              { label: 'Encrypted CID', value: batch.encryptedCid },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp * 1_000);
}
