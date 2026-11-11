import { useEffect, useState } from 'react';

import {
  listProductionIngredients,
  prepareProduct,
  type ProductionIngredient,
} from '../../../production-flow/production-flow.api';
import { completePreparedWorkflow } from '../../../production-flow/production-flow.transaction';
import { ProductQrDisplay } from '../../../product-traceability';
import { Alert, Badge, Btn, Card, Input, T } from '../../shared/ui';
import { shortChainId } from '../../shared/operational-format';
import {
  textError,
  quantityError,
  referenceError,
  productionDateError,
} from '../../../validation/form-validation';

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
  const [createdProduct, setCreatedProduct] = useState<{
    batchId: string;
    batchReference: string;
    productName: string;
  }>();

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
    const invalidAmount = Object.entries(amounts).find(
      ([, amount]) => amount !== '' && !!quantityError(amount),
    );
    const excessAmount = links.find((link) => {
      const ingredient = ingredients.find((item) => item.batchId === link.batchId);
      return (
        !ingredient ||
        !!quantityError(link.quantity, 'Ingredient quantity', ingredient.availableQuantity)
      );
    });
    const validationError =
      textError(productName, 'Product name', 160) ||
      referenceError(batchReference) ||
      textError(category, 'Category', 100) ||
      quantityError(quantity) ||
      textError(unit, 'Unit', 31) ||
      (!/^[A-Za-z0-9._/-]+$/.test(unit.trim()) ? 'Unit contains unsupported characters.' : '') ||
      productionDateError(producedAt, expiresAt) ||
      (invalidAmount ? 'Every entered ingredient quantity must be a positive whole number.' : '') ||
      (excessAmount ? 'An ingredient quantity exceeds its available inventory.' : '') ||
      (!links.length || links.length > 50
        ? 'Select between 1 and 50 valid ingredient batches.'
        : '');
    if (validationError) {
      setError(validationError);
      return;
    }
    const submittedProductName = productName.trim();
    const submittedBatchReference = batchReference.trim();
    setBusy(true);
    setError('');
    try {
      const result = await completePreparedWorkflow(() =>
        prepareProduct({
          batchReference: submittedBatchReference,
          category,
          expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString(),
          ingredientLinks: links,
          privateMetadata: { productName: submittedProductName, category },
          producedAt: new Date(`${producedAt}T00:00:00`).toISOString(),
          productName: submittedProductName,
          quantity,
          unit,
        }),
      );
      if ('batchId' in result && typeof result.batchId === 'string') {
        setCreatedProduct({
          batchId: result.batchId,
          batchReference: submittedBatchReference,
          productName: submittedProductName,
        });
      } else {
        throw new Error('The confirmed product did not include its on-chain batch ID.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Product creation failed.');
    } finally {
      setBusy(false);
    }
  };

  if (createdProduct) {
    return (
      <div style={{ maxWidth: 820 }}>
        <Alert
          type="success"
          message="Product creation was verified on chain. Its permanent traceability QR is ready."
        />
        <Card>
          <ProductQrDisplay
            batchId={createdProduct.batchId}
            batchReference={createdProduct.batchReference}
            productName={createdProduct.productName}
          />
        </Card>
        <Btn onClick={onBack}>Done</Btn>
      </div>
    );
  }

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
          <Input
            label="Product name"
            maxLength={160}
            value={productName}
            onChange={setProductName}
            required
          />
          <Input
            label="Product batch reference"
            maxLength={120}
            pattern="[A-Za-z0-9._:/-]+"
            value={batchReference}
            onChange={setBatchReference}
            required
          />
          <Input label="Category" value={category} onChange={setCategory} required />
          <Input
            label="Quantity produced"
            inputMode="numeric"
            pattern="[1-9][0-9]{0,38}"
            maxLength={39}
            value={quantity}
            onChange={setQuantity}
            required
          />
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
