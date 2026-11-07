import { useEffect, useState } from 'react';

import {
  listProductionIngredients,
  prepareProduct,
  type ProductionIngredient,
} from '../../../production-flow/production-flow.api';
import { completePreparedWorkflow } from '../../../production-flow/production-flow.transaction';
import { Alert, Badge, Btn, Card, Input, T } from '../../shared/ui';
import { shortChainId } from '../../shared/operational-format';

export function CreateProductBatch({ onBack }: { onBack: () => void }) {
  const [ingredients, setIngredients] = useState<ProductionIngredient[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [productName, setProductName] = useState('');
  const [batchReference, setBatchReference] = useState('');
  const [category, setCategory] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('units');
  const [producedAt, setProducedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void listProductionIngredients()
      .then((result) => setIngredients(result.batches.filter((batch) => batch.accepted)))
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Could not load ingredients.'),
      );
  }, []);

  const links = Object.entries(amounts)
    .filter(([, amount]) => /^[1-9]\d*$/.test(amount))
    .map(([batchId, amount]) => ({ batchId, quantity: amount }));
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await completePreparedWorkflow(() =>
        prepareProduct({
          batchReference,
          category,
          expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString(),
          ingredientLinks: links,
          privateMetadata: { productName, category },
          producedAt: new Date(`${producedAt}T00:00:00`).toISOString(),
          productName,
          quantity,
          unit,
        }),
      );
      onBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Product creation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back
        </Btn>
        <h2 style={{ margin: 0, color: T.navy }}>Create Product Batch</h2>
      </div>
      {error && <Alert type="error" message={error} />}
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Input label="Product name" value={productName} onChange={setProductName} required />
          <Input
            label="Product batch reference"
            value={batchReference}
            onChange={setBatchReference}
            required
          />
          <Input label="Category" value={category} onChange={setCategory} required />
          <Input label="Quantity produced" value={quantity} onChange={setQuantity} required />
          <Input label="Unit" value={unit} onChange={setUnit} required />
          <Input
            label="Production date"
            type="date"
            value={producedAt}
            onChange={setProducedAt}
            required
          />
          <Input
            label="Expiry date"
            type="date"
            value={expiresAt}
            onChange={setExpiresAt}
            required
          />
        </div>
      </Card>
      <Card>
        <div style={{ fontWeight: 700, color: T.navy, marginBottom: 5 }}>
          Accepted ingredient evidence
        </div>
        <p style={{ color: T.text2, fontSize: 12, marginTop: 0 }}>
          Enter the amount to consume from one or more accepted, active ingredient batches.
        </p>
        {ingredients.length === 0 ? (
          <Alert
            type="warning"
            message="No ingredient evidence has been accepted for this Manufacturer yet."
          />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {ingredients.map((ingredient) => (
              <div
                key={ingredient.batchId}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 180px',
                  alignItems: 'center',
                  gap: 12,
                  border: `1px solid ${T.border}`,
                  borderRadius: 9,
                  padding: 12,
                }}
              >
                <div>
                  <b>{shortChainId(ingredient.batchId)}</b>
                  <div style={{ fontSize: 11, color: T.text2 }}>
                    {ingredient.supplierName ?? 'Verified Supplier'} ·{' '}
                    {ingredient.availableQuantity} available
                  </div>
                </div>
                <Input
                  label="Quantity to consume"
                  value={amounts[ingredient.batchId] ?? ''}
                  onChange={(value) =>
                    setAmounts((current) => ({ ...current, [ingredient.batchId]: value }))
                  }
                />
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <Alert
            type="info"
            message="Private product metadata is encrypted off chain. The contract receives only the metadata hash, encrypted content reference, quantities, dates, and accepted ingredient links."
          />
        </div>
        <div style={{ marginTop: 14 }}>
          <Btn
            full
            disabled={
              busy ||
              !productName ||
              !batchReference ||
              !category ||
              !quantity ||
              !unit ||
              !producedAt ||
              !expiresAt ||
              links.length === 0
            }
            onClick={() => void submit()}
          >
            {busy ? 'Confirming product…' : 'Create product with MetaMask'}
          </Btn>
        </div>
      </Card>
    </div>
  );
}
