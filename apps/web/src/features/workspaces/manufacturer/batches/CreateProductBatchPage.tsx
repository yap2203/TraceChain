import { BackNavigation } from '../../../../components/ui/BackNavigation';
import { formatLocationLabel } from '../../../orders/location-format';
import { RequiredMarker } from '../../../../components/ui/RequiredLabel';
import { reportError } from '../../../../components/ui/feedback';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { useEffect, useRef, useState } from 'react';

import {
  listProductionIngredients,
  prepareProduct,
  type ProductionIngredient,
} from '../../../production-flow/production-flow.api';
import {
  completePreparedWorkflow,
  WorkflowRefreshPendingError,
} from '../../../production-flow/production-flow.transaction';
import { ProductQrDisplay } from '../../../product-traceability';
import {
  Alert,
  Badge,
  Btn,
  Card,
  Input,
  SelectField,
  StepProgress,
  T,
  Textarea,
} from '../../shared/ui';
import { registeredIngredientQuantity, ingredientUnitOptions } from './ingredient-quantities';
import { shortChainId } from '../../shared/operational-format';
import {
  getOrders,
  imageFilePayload,
  uploadProductCatalogueImage,
} from '../../../orders/orders.api';
import {
  textError,
  quantityError,
  referenceError,
  productionDateError,
} from '../../../validation/form-validation';

type ProductPreparationInput = Parameters<typeof prepareProduct>[0];
type IngredientBalance = { batchId: string; remaining: string; unit: string };
type SubmittedProduct = {
  batchId?: string;
  batchReference: string;
  ingredientBalances: IngredientBalance[];
  imageFile?: File;
  producedAt: string;
  productName: string;
  request: ProductPreparationInput;
};

export function CreateProductBatch({ onBack }: { onBack: () => void }) {
  const [ingredients, setIngredients] = useState<ProductionIngredient[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [ingredientUnits, setIngredientUnits] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [stockLoading, setStockLoading] = useState(true);
  const [stockError, setStockError] = useState('');
  const [confirmedStock, setConfirmedStock] = useState<ProductionIngredient[]>([]);
  const [locations, setLocations] = useState<
    { location: string; label: string; address?: string }[]
  >([]);
  const [productionLocation, setProductionLocation] = useState('');
  const [productName, setProductName] = useState('');
  const [batchReference, setBatchReference] = useState('');
  const [category, setCategory] = useState('');
  const [origin, setOrigin] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('MYR');
  const [imageFile, setImageFile] = useState<File>();
  const [imagePreview, setImagePreview] = useState('');
  const [imageError, setImageError] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [unit, setUnit] = useState('each');
  const [producedAt, setProducedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [presentationWarning, setPresentationWarning] = useState('');
  const [refreshPending, setRefreshPending] = useState<SubmittedProduct>();
  const [createdProduct, setCreatedProduct] = useState<{
    production?: { location: string; recordedAt: number };
    producedAt?: string;
    batchId: string;
    batchReference: string;
    ingredientBalances: IngredientBalance[];
    locationName: string;
    output: string;
    productName: string;
  }>();

  useEffect(() => {
    if (!imageFile) {
      setImagePreview('');
      return;
    }
    const preview = URL.createObjectURL(imageFile);
    setImagePreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [imageFile]);

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
              address: location.address,
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
        if (active) setStockError(reportError(cause, 'Could not load received stock.'));
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
  const productNameError = productName ? textError(productName, 'Product name', 160) : '';
  const batchReferenceError = batchReference ? referenceError(batchReference) : '';
  const outputQuantityError = quantity ? quantityError(quantity) : '';
  const priceError =
    price && !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(price)
      ? 'Enter a non-negative unit price with at most two decimal places.'
      : '';
  const datesError = producedAt && expiresAt ? productionDateError(producedAt, expiresAt) : '';
  const detailsComplete =
    !!productName && !!batchReference && !!quantity && !!unit && !!producedAt && !!expiresAt;
  const refreshStock = async (location: string) => {
    try {
      setConfirmedStock((await listProductionIngredients(location, 'production')).batches);
      setStockError('');
    } catch {
      setStockError(
        'Product creation succeeded, but the updated stock could not be loaded. Refresh before creating another product.',
      );
    }
  };
  const showCreatedProduct = async (
    result: { batchId?: string; production?: { location: string; recordedAt: number } },
    submitted: SubmittedProduct,
  ) => {
    if (!result.batchId)
      throw new Error('The confirmed product did not include its on-chain batch ID.');
    if (submitted.imageFile) {
      try {
        await uploadProductCatalogueImage(
          result.batchId,
          await imageFilePayload(submitted.imageFile),
        );
        setPresentationWarning('');
      } catch (cause) {
        setPresentationWarning(
          reportError(
            cause,
            'The product was created, but its optional image could not be saved. The on-chain product record is unchanged.',
          ),
        );
      }
    }
    setCreatedProduct({
      production: result.production,
      producedAt: submitted.producedAt,
      batchId: result.batchId,
      batchReference: submitted.batchReference,
      ingredientBalances: submitted.ingredientBalances,
      locationName:
        locations.find((entry) => entry.location === submitted.request.productionLocation)?.label ??
        'Recorded production location',
      output: `${submitted.request.quantity} ${submitted.request.unit}`,
      productName: submitted.productName,
    });
    setRefreshPending(undefined);
    await refreshStock(submitted.request.productionLocation ?? '');
  };
  const submit = async () => {
    const validationError =
      textError(productName, 'Product name', 160) ||
      referenceError(batchReference) ||
      (category ? textError(category, 'Category', 100) : '') ||
      (origin ? textError(origin, 'Country of manufacture', 120) : '') ||
      (description ? textError(description, 'Description', 1_000) : '') ||
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
    const selectedLocation = locations.find((entry) => entry.location === productionLocation);
    const request: ProductPreparationInput = {
      ...(productionLocation ? { productionLocation } : {}),
      ...(selectedLocation?.label ? { productionLocationName: selectedLocation.label } : {}),
      batchReference: submittedBatchReference,
      category: category.trim(),
      origin: origin.trim(),
      description: description.trim(),
      ...(price ? { price, currency } : {}),
      expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString(),
      ingredientLinks: links,
      privateMetadata: { productName: submittedProductName, category },
      producedAt: new Date(`${producedAt}T00:00:00`).toISOString(),
      productName: submittedProductName,
      quantity,
      unit,
    };
    const submitted: SubmittedProduct = {
      batchReference: submittedBatchReference,
      ...(imageFile ? { imageFile } : {}),
      ingredientBalances: links.map((link) => {
        const ingredient = ingredients.find((item) => item.batchId === link.batchId)!;
        return {
          batchId: link.batchId,
          remaining: (BigInt(ingredient.availableQuantity) - BigInt(link.quantity)).toString(),
          unit: ingredient.unit,
        };
      }),
      producedAt,
      productName: submittedProductName,
      request,
    };
    setBusy(true);
    setError('');
    try {
      const result = await completePreparedWorkflow(() => prepareProduct(request));
      await showCreatedProduct(result, submitted);
    } catch (cause) {
      if (cause instanceof WorkflowRefreshPendingError) {
        const prepared = cause.prepared as { batchId?: string } | undefined;
        setRefreshPending({ ...submitted, batchId: prepared?.batchId });
      } else setError(reportError(cause, 'Product creation failed.'));
    } finally {
      setBusy(false);
    }
  };

  const refreshConfirmedProduct = async () => {
    if (!refreshPending || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await prepareProduct(refreshPending.request);
      if (result.state !== 'COMPLETE') {
        setError(
          'The confirmed product is not readable yet. Wait briefly and refresh records again; do not create it again.',
        );
        return;
      }
      await showCreatedProduct(result, refreshPending);
    } catch {
      setError(
        'The confirmed product is not readable yet. Wait briefly and refresh records again; do not create it again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (createdProduct) {
    return (
      <div className="workspace-editor product-success">
        <Alert
          type="success"
          message="Product creation was verified on chain. Its permanent traceability QR is ready."
        />
        {presentationWarning && <Alert type="warning" message={presentationWarning} />}
        <Card className="product-success__summary">
          <div>
            <span>Product created</span>
            <h2>{createdProduct.productName}</h2>
            <p>{createdProduct.batchReference}</p>
          </div>
          <dl className="workspace-record-facts">
            <div>
              <dt>Output quantity</dt>
              <dd>{createdProduct.output}</dd>
            </div>
            <div>
              <dt>Production location</dt>
              <dd>{createdProduct.locationName}</dd>
            </div>
            <div>
              <dt>Production date</dt>
              <dd>{createdProduct.producedAt ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Linked ingredients</dt>
              <dd>{createdProduct.ingredientBalances.length}</dd>
            </div>
          </dl>
        </Card>
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
            const submittedBalance = createdProduct.ingredientBalances.find(
              (item) => item.batchId === link.batchId,
            );
            return (
              <p key={link.batchId}>
                {names[link.batchId] ?? shortChainId(link.batchId)}:{' '}
                {stock
                  ? `${stock.availableQuantity} ${stock.unit}`
                  : submittedBalance
                    ? `${submittedBalance.remaining} ${submittedBalance.unit}`
                    : 'Refreshing / unavailable'}
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
        <div className="product-success__actions action-row">
          <Btn
            variant="outline"
            onClick={() => {
              setCreatedProduct(undefined);
              setProductName('');
              setBatchReference('');
              setQuantity('');
              setImageFile(undefined);
              setSelected({});
              setAmounts({});
            }}
          >
            Create another batch
          </Btn>
          <Btn
            variant="outline"
            onClick={() => {
              window.history.pushState(
                {},
                '',
                `/manufacturer/transfers?batchId=${encodeURIComponent(createdProduct.batchId)}`,
              );
              window.dispatchEvent(new PopStateEvent('popstate'));
            }}
          >
            Transfer product
          </Btn>
          <Btn onClick={onBack}>View product</Btn>
        </div>
      </div>
    );
  }

  if (refreshPending) {
    return (
      <div className="workspace-editor">
        <BackNavigation onClick={onBack}>Return to products</BackNavigation>
        <Alert
          type="success"
          message="The product transaction was confirmed. TraceChain is waiting to refresh the authoritative product record. Do not submit the transaction again."
        />
        {error && <Alert type="warning" message={error} />}
        <Card>
          <h3>Product confirmation pending refresh</h3>
          <p>
            {refreshPending.productName} · {refreshPending.batchReference}
          </p>
          {refreshPending.batchId && (
            <p>Product batch ID: {shortChainId(refreshPending.batchId)}</p>
          )}
          <div className="action-row">
            <Btn disabled={busy} onClick={() => void refreshConfirmedProduct()}>
              {busy ? 'Refreshing records…' : 'Refresh records'}
            </Btn>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="workspace-editor">
      <BackNavigation onClick={onBack}>Back</BackNavigation>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, color: T.navy }}>Create Product Batch</h2>
      </div>
      <StepProgress
        steps={[
          'Product details',
          'Product presentation',
          'Ingredients and quantities',
          'Review and create',
        ]}
        current={!detailsComplete ? 0 : !productionLocation ? 1 : links.length === 0 ? 2 : 3}
      />
      {error && <Alert type="error" message={error} />}
      <Card>
        <h3>1. Product details</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Input
            label="Product name"
            maxLength={160}
            value={productName}
            onChange={setProductName}
            error={productNameError || undefined}
            required
          />
          <Input
            label="Product batch reference"
            maxLength={120}
            pattern="[A-Za-z0-9._:/-]+"
            value={batchReference}
            onChange={setBatchReference}
            error={batchReferenceError || undefined}
            required
          />
          <Input
            label="Quantity produced"
            inputMode="numeric"
            pattern="[1-9][0-9]{0,38}"
            maxLength={39}
            value={quantity}
            onChange={setQuantity}
            error={outputQuantityError || undefined}
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
            error={datesError || undefined}
            required
          />
        </div>
      </Card>
      <Card>
        <h3>2. Product presentation</h3>
        <p style={{ color: T.text2 }}>
          These catalogue details are encrypted off chain and remain separate from the signed and
          on-chain product identity.
        </p>
        <label style={{ display: 'grid', gap: 6 }}>
          Production location <RequiredMarker />
          <select
            aria-label="Production stock location"
            value={productionLocation}
            onChange={(event) => setProductionLocation(event.target.value)}
          >
            <option value="">Select your registered receiving / production location</option>
            {locations.map((location) => (
              <option key={location.location} value={location.location}>
                {formatLocationLabel(location, location.location)}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <Input
            label="Product category (optional)"
            maxLength={100}
            value={category}
            onChange={setCategory}
          />
          <Input
            label="Country of manufacture (optional)"
            maxLength={120}
            value={origin}
            onChange={setOrigin}
          />
          <Input
            label={`Indicative price per ${unit || 'unit'} (optional)`}
            value={price}
            onChange={setPrice}
            type="number"
            min="0"
            step="0.01"
            error={priceError || undefined}
            hint="Indicative catalogue price only; this is not a payment or on-chain sale price."
          />
          <Input
            label="Currency code"
            value={currency}
            onChange={(value) => setCurrency(value.toUpperCase())}
            maxLength={3}
          />
        </div>
        <div style={{ marginTop: 14 }}>
          <Textarea
            label="Product description (optional)"
            value={description}
            onChange={setDescription}
            maxLength={1_000}
            rows={4}
          />
        </div>
        <div className="ingredient-photo-review">
          <div>
            <span className="ingredient-photo-review__label">Product image (optional)</span>
            {imagePreview && imageFile ? (
              <>
                <img src={imagePreview} alt="Product image preview" />
                <span className="ingredient-photo-review__filename" title={imageFile.name}>
                  {imageFile.name}
                </span>
              </>
            ) : (
              <span className="ingredient-photo-review__empty">No image selected</span>
            )}
          </div>
          <div>
            <input
              ref={imageInputRef}
              aria-label="Product image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
                  setImageError('Choose a PNG, JPEG or WebP image.');
                  event.currentTarget.value = '';
                  return;
                }
                if (file.size > 2 * 1024 * 1024) {
                  setImageError('Images must not exceed 2 MB.');
                  event.currentTarget.value = '';
                  return;
                }
                setImageError('');
                setImageFile(file);
              }}
            />
            <Btn
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => imageInputRef.current?.click()}
            >
              {imageFile ? 'Replace image' : 'Choose image'}
            </Btn>
            {imageFile && (
              <Btn
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setImageFile(undefined);
                  setImageError('');
                  if (imageInputRef.current) imageInputRef.current.value = '';
                }}
              >
                Remove image
              </Btn>
            )}
          </div>
        </div>
        {imageError && <Alert type="error" message={imageError} />}
      </Card>
      <Card>
        <h3>3. Select received ingredients</h3>
        <p style={{ color: T.text2, fontSize: 12, marginTop: 0 }}>
          Choose received ingredients and the amount to use. Remaining stock updates automatically;
          ingredient evidence is optional.
        </p>
        {stockLoading && <LoadingIndicator page label="Reading ingredient stock…" />}
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
      </Card>
      <Card>
        <h3>4. Review and create</h3>
        <div className="ingredient-photo-review">
          <div>
            <span className="ingredient-photo-review__label">Product image</span>
            {imagePreview && imageFile ? (
              <>
                <img src={imagePreview} alt="Product image review preview" />
                <span className="ingredient-photo-review__filename" title={imageFile.name}>
                  {imageFile.name}
                </span>
              </>
            ) : (
              <span className="ingredient-photo-review__empty">No image selected</span>
            )}
          </div>
          <Btn
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => imageInputRef.current?.click()}
          >
            {imageFile ? 'Change image' : 'Add image'}
          </Btn>
        </div>
        <dl className="workspace-record-facts">
          <div>
            <dt>Product</dt>
            <dd>{productName || 'Not entered'}</dd>
          </div>
          <div>
            <dt>Batch reference</dt>
            <dd>{batchReference || 'Not entered'}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{category || 'Not provided'}</dd>
          </div>
          <div>
            <dt>Description</dt>
            <dd>{description || 'Not provided'}</dd>
          </div>
          <div>
            <dt>Country of manufacture</dt>
            <dd>{origin || 'Not provided'}</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>
              {quantity && unit ? `${quantity} ${unit === 'each' ? 'units' : unit}` : 'Not entered'}
            </dd>
          </div>
          <div>
            <dt>Indicative price</dt>
            <dd>{price ? `${currency} ${Number(price).toFixed(2)} / ${unit}` : 'Not provided'}</dd>
          </div>
          <div>
            <dt>Ingredient batches</dt>
            <dd>
              {links.length
                ? links
                    .map(
                      (link) =>
                        `${names[link.batchId] ?? shortChainId(link.batchId)} — ${link.quantity} ${ingredients.find((item) => item.batchId === link.batchId)?.unit ?? ''}`,
                    )
                    .join(', ')
                : 'None selected'}
            </dd>
          </div>
          <div>
            <dt>Production location</dt>
            <dd>
              {locations.find((entry) => entry.location === productionLocation)?.label ??
                'Not selected'}
            </dd>
          </div>
          <div>
            <dt>Production date</dt>
            <dd>{producedAt || 'Not entered'}</dd>
          </div>
          <div>
            <dt>Expiry</dt>
            <dd>{expiresAt || 'Not entered'}</dd>
          </div>
        </dl>
        <div className="action-row">
          <Btn
            disabled={
              busy ||
              !detailsComplete ||
              !!productNameError ||
              !!batchReferenceError ||
              !!outputQuantityError ||
              !!priceError ||
              !!datesError ||
              !!imageError ||
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
