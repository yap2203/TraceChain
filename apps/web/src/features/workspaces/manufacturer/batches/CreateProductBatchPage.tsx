import { useEffect, useState } from 'react';

import {
  listProductionIngredients,
  prepareProduct,
  type ProductionIngredient,
} from '../../../production-flow/production-flow.api';
import { completePreparedWorkflow } from '../../../production-flow/production-flow.transaction';
import { ProductQrDisplay } from '../../../product-traceability';
import { Alert, Badge, Btn, Card, Input, SelectField, T } from '../../shared/ui';
import { registeredIngredientQuantity, ingredientUnitOptions } from './ingredient-quantities';
import { shortChainId } from '../../shared/operational-format';
import { getOrders } from '../../../orders/orders.api';
import {
  textError,
  quantityError,
  referenceError,
  productionDateError,
} from '../../../validation/form-validation';

export function CreateProductBatch({ onBack }: { onBack: () => void }) {
  const [ingredients, setIngredients] = useState<ProductionIngredient[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [ingredientUnits, setIngredientUnits] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [stockLoading, setStockLoading] = useState(true);
  const [stockError, setStockError] = useState('');
  const [confirmedStock, setConfirmedStock] = useState<ProductionIngredient[]>([]);
  const [locations, setLocations] = useState<{ location: string; label: string }[]>([]);
  const [productionLocation, setProductionLocation] = useState('');
  const [productName, setProductName] = useState('');
  const [batchReference, setBatchReference] = useState('');
  const [category, setCategory] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('MYR');
  const [unit, setUnit] = useState('each');
  const [producedAt, setProducedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createdProduct, setCreatedProduct] = useState<{
    production?: { location: string; recordedAt: number };
    producedAt?: string;
    batchId: string;
    batchReference: string;
    productName: string;
  }>();

  useEffect(() => {
    void getOrders()
      .then((result) => {
        setNames(
          Object.fromEntries(
            result.catalogue.flatMap((item) =>
              item.batches.map((batchId: string) => [batchId, item.name]),
            ),
          ),
        );
        setLocations(
          result.locations
            .filter((location) => location.company.toLowerCase() === result.actor.toLowerCase())
            .map((location) => ({
              location: location.location,
              label: location.label ?? location.location,
            })),
        );
      })
      .catch(() =>
        setError('Receiving locations and readable ingredient names could not be loaded.'),
      );
  }, []);
  useEffect(() => {
    let active = true;
    setStockLoading(true);
    setStockError('');
    setIngredients([]);
    setSelected({});
    setAmounts({});
    setIngredientUnits({});
    void listProductionIngredients(productionLocation || undefined, 'production')
      .then((result) => {
        if (active)
          setIngredients(result.batches.filter((batch) => BigInt(batch.availableQuantity) > 0n));
      })
      .catch((cause) => {
        if (active)
          setStockError(cause instanceof Error ? cause.message : 'Could not load received stock.');
      })
      .finally(() => {
        if (active) setStockLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productionLocation]);

  const selections = ingredients
    .filter((ingredient) => selected[ingredient.batchId])
    .map((ingredient) => {
      const converted = registeredIngredientQuantity(
        amounts[ingredient.batchId] ?? '',
        ingredientUnits[ingredient.batchId] ?? ingredient.unit,
        ingredient.unit,
      );
      const excess =
        converted.quantity !== undefined &&
        BigInt(converted.quantity) > BigInt(ingredient.availableQuantity);
      return {
        ingredient,
        quantity: converted.quantity,
        error:
          converted.error ??
          (excess ? 'Amount exceeds received stock at this location.' : undefined),
      };
    });
  const links = selections
    .filter((entry) => entry.quantity && !entry.error)
    .map((entry) => ({ batchId: entry.ingredient.batchId, quantity: entry.quantity! }));
  const submit = async () => {
    const validationError =
      textError(productName, 'Product name', 160) ||
      referenceError(batchReference) ||
      textError(category, 'Category', 100) ||
      (price && !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(price)
        ? 'Enter a non-negative unit price with at most two decimal places.'
        : '') ||
      (price && !/^[A-Z]{3}$/.test(currency) ? 'Enter a three-letter currency code.' : '') ||
      quantityError(quantity) ||
      textError(unit, 'Unit', 31) ||
      (!/^[A-Za-z0-9._/-]+$/.test(unit.trim()) ? 'Unit contains unsupported characters.' : '') ||
      productionDateError(producedAt, expiresAt) ||
      (!productionLocation
        ? 'Select the receiving / production location holding your ingredients.'
        : '') ||
      (selections.find((entry) => entry.error)?.error ?? '') ||
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
          ...(productionLocation ? { productionLocation } : {}),
          batchReference: submittedBatchReference,
          category,
          ...(price ? { price, currency } : {}),
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
          production: result.production,
          producedAt,
          batchId: result.batchId,
          batchReference: submittedBatchReference,
          productName: submittedProductName,
        });
        try {
          setConfirmedStock(
            (await listProductionIngredients(productionLocation, 'production')).batches,
          );
        } catch {
          setStockError(
            'Product creation succeeded, but the updated stock could not be loaded. Refresh before creating another product.',
          );
        }
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
        <p>
          Production occurred: {createdProduct.producedAt ?? 'Unavailable'} · Recorded on-chain:{' '}
          {createdProduct.production?.recordedAt
            ? new Date(createdProduct.production.recordedAt * 1000).toLocaleString()
            : 'Unavailable'}{' '}
          · Location:{' '}
          {createdProduct.production?.location
            ? shortChainId(createdProduct.production.location)
            : 'Unavailable'}
        </p>
        <Card>
          <h3>Remaining ingredient stock</h3>
          {stockError && <Alert type="warning" message={stockError} />}
          {links.map((link) => {
            const stock = confirmedStock.find((item) => item.batchId === link.batchId);
            return (
              <p key={link.batchId}>
                {names[link.batchId] ?? shortChainId(link.batchId)}:{' '}
                {stock ? `${stock.availableQuantity} ${stock.unit}` : 'Refreshing / unavailable'}
              </p>
            );
          })}
        </Card>
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
        <label style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          Production stock location
          <select
            aria-label="Production stock location"
            value={productionLocation}
            onChange={(event) => setProductionLocation(event.target.value)}
          >
            <option value="">Select your registered receiving / production location</option>
            {locations.map((location) => (
              <option key={location.location} value={location.location}>
                {location.label}
              </option>
            ))}
          </select>
        </label>
        <p>
          Production consumes only accepted ingredient stock already received at this location.
          Quantity requests and evidence acceptance do not add usable stock.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Input
            label={`Price per ${unit} (optional)`}
            value={price}
            onChange={setPrice}
            type="number"
            min="0"
            step="0.01"
          />
          <Input
            label="Currency code"
            value={currency}
            onChange={(value) => setCurrency(value.toUpperCase())}
            maxLength={3}
          />
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
          <SelectField
            label="Product output unit"
            value={['each', 'kg', 'g', 'litre', 'ml'].includes(unit) ? unit : 'custom'}
            onChange={(value) => setUnit(value === 'custom' ? '' : value)}
            options={['each', 'kg', 'g', 'litre', 'ml', 'custom'].map((value) => ({
              value,
              label: value === 'custom' ? 'Other unit' : value,
            }))}
          />
          {!['each', 'kg', 'g', 'litre', 'ml'].includes(unit) && (
            <Input
              label="Custom product unit"
              value={unit}
              onChange={setUnit}
              maxLength={31}
              required
            />
          )}
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
          Select received ingredients
        </div>
        <p style={{ color: T.text2, fontSize: 12, marginTop: 0 }}>
          Select one or more ingredients, choose compatible units and enter the amount used.
          Remaining stock updates automatically. Confirmed received stock can be consumed;
          requesting ingredient evidence is optional.
        </p>
        {stockLoading && <p role="status">Reading ingredient stock…</p>}
        {stockError && <Alert type="error" message={stockError} />}
        {!stockLoading && ingredients.length === 0 ? (
          <Alert
            type="warning"
            message="No received ingredient stock is available here. Confirm receipt of a Supplier-approved request at this location first. Ingredient evidence is optional."
          />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {ingredients.map((ingredient) => {
              const selection = selections.find(
                (entry) => entry.ingredient.batchId === ingredient.batchId,
              );
              return (
                <div
                  key={ingredient.batchId}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
                    alignItems: 'center',
                    gap: 12,
                    border: `1px solid ${T.border}`,
                    borderRadius: 9,
                    padding: 12,
                  }}
                >
                  <div>
                    <label className="flex items-start gap-[8px]">
                      <input
                        type="checkbox"
                        aria-label={`Select ${names[ingredient.batchId] ?? shortChainId(ingredient.batchId)}`}
                        disabled={
                          busy || !productionLocation || BigInt(ingredient.availableQuantity) === 0n
                        }
                        checked={!!selected[ingredient.batchId]}
                        onChange={(event) =>
                          setSelected((current) => ({
                            ...current,
                            [ingredient.batchId]: event.target.checked,
                          }))
                        }
                      />
                      <b>{names[ingredient.batchId] ?? shortChainId(ingredient.batchId)}</b>
                    </label>
                    <div style={{ fontSize: 11, color: T.text2 }}>
                      {ingredient.supplierName ?? 'Verified Supplier'} ·{' '}
                      {ingredient.availableQuantity} {ingredient.unit} received and available
                    </div>
                    {selected[ingredient.batchId] && (
                      <p aria-live="polite">
                        Remaining after production:{' '}
                        {selection?.quantity && !selection.error
                          ? `${BigInt(ingredient.availableQuantity) - BigInt(selection.quantity)} ${ingredient.unit}`
                          : 'Enter a valid amount'}
                      </p>
                    )}
                  </div>
                  {selected[ingredient.batchId] && (
                    <div className="grid gap-[8px]">
                      <SelectField
                        label={`Ingredient unit for ${names[ingredient.batchId] ?? shortChainId(ingredient.batchId)}`}
                        value={ingredientUnits[ingredient.batchId] ?? ingredient.unit}
                        onChange={(value) =>
                          setIngredientUnits((current) => ({
                            ...current,
                            [ingredient.batchId]: value,
                          }))
                        }
                        options={ingredientUnitOptions(ingredient.unit)}
                      />
                      <Input
                        label={`Quantity to use for ${names[ingredient.batchId] ?? shortChainId(ingredient.batchId)}`}
                        value={amounts[ingredient.batchId] ?? ''}
                        inputMode="decimal"
                        maxLength={46}
                        error={amounts[ingredient.batchId] ? selection?.error : undefined}
                        onChange={(value) =>
                          setAmounts((current) => ({ ...current, [ingredient.batchId]: value }))
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
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
              !productionLocation ||
              stockLoading ||
              !!stockError ||
              selections.some((entry) => !!entry.error) ||
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
