import { useRef, useState } from 'react';

import { Alert, Btn, Card, Input, SelectField, StepProgress, T } from '../../shared/ui';
import {
  prepareIngredientBatch,
  type IngredientBatchInput,
  type IngredientBatchWorkflow,
} from './ingredient-batch.api';
import { submitIngredientBatchTransaction } from './ingredient-batch-transaction';
import { PresentationSigningSettingsLink } from '../../../didcomm/HolderSigningKeyPanel';
import { imageFilePayload, uploadIngredientCatalogueImage } from '../../../orders/orders.api';
import {
  textError,
  quantityError,
  referenceError,
  productionDateError,
} from '../../../validation/form-validation';

type WorkflowStep = 'waiting' | 'active' | 'complete';

interface RegisterBatchProps {
  onBack: () => void;
  onCompleted?: () => void;
  prepareWorkflow?: typeof prepareIngredientBatch;
  submitTransaction?: typeof submitIngredientBatchTransaction;
}

export function RegisterBatch({
  onBack,
  onCompleted,
  prepareWorkflow = prepareIngredientBatch,
  submitTransaction = submitIngredientBatchTransaction,
}: RegisterBatchProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [batchReference, setBatchReference] = useState('');
  const [category, setCategory] = useState('cocoa');
  const [origin, setOrigin] = useState('');
  const [producedAt, setProducedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('MYR');
  const [unit, setUnit] = useState('g');
  const [allergen, setAllergen] = useState('');
  const [certifications, setCertifications] = useState('');
  const [imageFile, setImageFile] = useState<File>();
  const [imageNotice, setImageNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [credentialStep, setCredentialStep] = useState<WorkflowStep>('waiting');
  const [batchStep, setBatchStep] = useState<WorkflowStep>('waiting');
  const activeSubmission = useRef(false);

  const buildInput = (): IngredientBatchInput => ({
    allergenInformation: allergen.trim(),
    batchReference: batchReference.trim(),
    category,
    certifications: certifications
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    expiryDate: expiresAt,
    ingredientName: name.trim(),
    origin: origin.trim(),
    productionDate: producedAt,
    quantity,
    unit,
    ...(price ? { price, currency } : {}),
  });

  const validationError =
    (price && !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(price)
      ? 'Enter a non-negative unit price with at most two decimal places.'
      : '') ||
    (price && !/^[A-Z]{3}$/.test(currency) ? 'Enter a three-letter currency code.' : '') ||
    textError(name, 'Ingredient name', 160) ||
    referenceError(batchReference) ||
    textError(origin, 'Origin', 160) ||
    textError(category, 'Category', 80) ||
    quantityError(quantity) ||
    textError(unit, 'Unit', 31) ||
    textError(allergen, 'Allergen information', 500, false) ||
    (buildInput().certifications.length > 20 ||
    buildInput().certifications.some((value) => value.length > 120)
      ? 'Use at most 20 certifications, each with at most 120 characters.'
      : '') ||
    productionDateError(producedAt, expiresAt);
  const isFormComplete = !validationError;

  const applyState = (workflow: IngredientBatchWorkflow) => {
    if (workflow.state === 'CREDENTIAL_REGISTRATION_REQUIRED') {
      setCredentialStep('active');
      setBatchStep('waiting');
    } else if (workflow.state === 'BATCH_REGISTRATION_REQUIRED') {
      setCredentialStep('complete');
      setBatchStep('active');
    } else {
      setCredentialStep('complete');
      setBatchStep('complete');
    }
  };

  const register = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    if (activeSubmission.current) return;
    activeSubmission.current = true;
    setBusy(true);
    setError('');
    setImageNotice('');
    setComplete(false);
    try {
      let workflow = await prepareWorkflow(buildInput());
      applyState(workflow);
      for (let transactionCount = 0; workflow.state !== 'COMPLETE'; transactionCount += 1) {
        if (transactionCount >= 2 || !workflow.transaction) {
          throw new Error('The server returned an incomplete ingredient registration workflow.');
        }
        await submitTransaction(workflow.transaction, workflow.supplierWallet);
        workflow = await prepareWorkflow(buildInput());
        applyState(workflow);
      }
      setComplete(true);
      if (imageFile) {
        try {
          await uploadIngredientCatalogueImage(workflow.batchId, await imageFilePayload(imageFile));
          setImageNotice('Supplier-provided presentation image uploaded successfully.');
        } catch (imageError) {
          setError(
            `The batch was registered successfully, but its optional image could not be uploaded. ${
              imageError instanceof Error
                ? imageError.message
                : 'Add the image later from View details.'
            }`,
          );
        }
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The ingredient batch could not be registered.',
      );
    } finally {
      activeSubmission.current = false;
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm" disabled={busy}>
          Back
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          Register Ingredient Batch
        </h2>
      </div>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        {error && <Alert type="error" message={error} />}
        <StepProgress steps={['Ingredient information', 'Review & register']} current={step} />

        {step === 0 && (
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 20 }}>
              Ingredient information
            </div>
            <div className="ingredient-registration-form">
              <fieldset className="ingredient-form-section">
                <legend>Basic ingredient information</legend>
                <div className="workspace-form-grid">
                  <Input
                    label="Ingredient name"
                    maxLength={160}
                    placeholder="Cocoa Powder"
                    value={name}
                    onChange={setName}
                    required
                  />
                  <Input
                    label="Batch reference"
                    maxLength={120}
                    pattern="[A-Za-z0-9._:/-]+"
                    placeholder="COCOA-2026-001"
                    value={batchReference}
                    onChange={setBatchReference}
                    required
                  />
                </div>
                <SelectField
                  label="Category"
                  value={category}
                  onChange={setCategory}
                  options={[
                    { value: 'cocoa', label: 'Cocoa & Chocolate' },
                    { value: 'dairy', label: 'Dairy Products' },
                    { value: 'sugar', label: 'Sugar & Sweeteners' },
                    { value: 'grain', label: 'Grains & Flours' },
                    { value: 'other', label: 'Other' },
                  ]}
                />
              </fieldset>

              <fieldset className="ingredient-form-section">
                <legend>Origin and dates</legend>
                <div className="workspace-form-grid">
                  <Input
                    label="Country / location of origin"
                    maxLength={160}
                    placeholder="Ghana"
                    value={origin}
                    onChange={setOrigin}
                    required
                  />
                  <Input
                    label="Production date"
                    max={new Date().toISOString().slice(0, 10)}
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
              </fieldset>

              <fieldset className="ingredient-form-section">
                <legend>Quantity and indicative price</legend>
                <div className="workspace-form-grid workspace-form-grid--quantity">
                  <Input
                    label="Quantity"
                    inputMode="numeric"
                    pattern="[1-9][0-9]{0,38}"
                    maxLength={39}
                    placeholder="500"
                    value={quantity}
                    onChange={setQuantity}
                    required
                  />
                  <SelectField
                    label="Unit"
                    value={unit}
                    onChange={setUnit}
                    options={[
                      { value: 'kg', label: 'kg' },
                      { value: 'g', label: 'g (integer grams; 1000 g = 1 kg)' },
                      { value: 'each', label: 'each (individual items)' },
                      { value: 'litre', label: 'litre' },
                      { value: 'unit', label: 'unit' },
                    ]}
                  />
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
                </div>
              </fieldset>

              <fieldset className="ingredient-form-section">
                <legend>Credential claims</legend>
                <p>
                  These values become part of the signed Ingredient Credential and cannot be changed
                  through listing edits.
                </p>
                <Input
                  label="Allergen information"
                  maxLength={500}
                  placeholder="None"
                  value={allergen}
                  onChange={setAllergen}
                />
                <Input
                  label="Certifications"
                  placeholder="Organic, Halal, Fair Trade"
                  value={certifications}
                  onChange={setCertifications}
                  hint="Separate multiple certifications with commas"
                />
              </fieldset>

              <fieldset className="ingredient-form-section">
                <legend>Optional ingredient image</legend>
                <p>
                  Supplier-provided presentation information only. It is not a credential claim or
                  laboratory evidence. PNG, JPEG or WebP, maximum 2 MB.
                </p>
                <input
                  aria-label="Choose optional ingredient image"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      setImageFile(undefined);
                      return;
                    }
                    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
                      setError('Choose a PNG, JPEG or WebP image.');
                      setImageFile(undefined);
                      event.currentTarget.value = '';
                      return;
                    }
                    if (file.size > 2 * 1024 * 1024) {
                      setError('Images must not exceed 2 MB.');
                      setImageFile(undefined);
                      event.currentTarget.value = '';
                      return;
                    }
                    setError('');
                    setImageFile(file);
                  }}
                />
              </fieldset>
              <Btn
                onClick={() => {
                  if (!isFormComplete) setError(validationError);
                  else {
                    setError('');
                    setStep(1);
                  }
                }}
                full
                disabled={busy}
              >
                Continue to review
              </Btn>
            </div>
          </Card>
        )}

        {step === 1 && (
          <div style={{ display: 'grid', gap: 16 }}>
            <PresentationSigningSettingsLink role="supplier" />
            <Card>
              <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 16 }}>
                Review batch
              </div>
              <Alert
                type="warning"
                message="Ingredient name, batch reference, origin, category, quantity, unit, dates, allergens and certifications become signed or blockchain records. A separate catalogue listing copy of the name and category, plus its description, indicative price and image, can later be edited without changing those signed claims."
              />
              <div className="workspace-review-grid">
                {[
                  ['Ingredient', name],
                  ['Batch reference', batchReference],
                  ['Origin', origin],
                  ['Category', category],
                  ['Production date', producedAt],
                  ['Expiry date', expiresAt],
                  ['Quantity', `${quantity} ${unit}`],
                  ['Certifications', certifications || 'None'],
                  ['Optional image', imageFile?.name || 'None selected'],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{ borderBottom: `1px solid ${T.border}`, padding: '8px 0' }}
                  >
                    <div style={{ fontSize: 11, color: T.text2 }}>{label}</div>
                    <div style={{ fontSize: 13, color: T.navy, fontWeight: 600 }}>{value}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 12 }}>
                Registration progress
              </div>
              <WorkflowStatus label="Register Ingredient Credential" status={credentialStep} />
              <WorkflowStatus label="Register ingredient batch" status={batchStep} />
              <p style={{ fontSize: 12, color: T.text2, margin: '12px 0 0' }}>
                MetaMask confirms each blockchain step separately. If a later step fails, retrying
                safely resumes from the confirmed step.
              </p>
            </Card>

            {complete && (
              <Alert
                type="success"
                message="The Ingredient Credential and ingredient batch are registered and verified on-chain."
              />
            )}
            {imageNotice && <Alert type="success" message={imageNotice} />}

            <div style={{ display: 'flex', gap: 10 }}>
              {!complete && (
                <Btn
                  onClick={() => setStep(0)}
                  variant="outline"
                  style={{ flex: 1 }}
                  disabled={busy}
                >
                  Edit details
                </Btn>
              )}
              <Btn
                onClick={complete ? (onCompleted ?? onBack) : register}
                style={{ flex: 2 }}
                disabled={busy}
              >
                {complete
                  ? 'View ingredient batches'
                  : busy
                    ? 'Waiting for confirmation…'
                    : error
                      ? 'Retry registration'
                      : 'Register with MetaMask'}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkflowStatus({ label, status }: { label: string; status: WorkflowStep }) {
  const text = status === 'complete' ? 'Complete' : status === 'active' ? 'Next' : 'Waiting';
  const color = status === 'complete' ? T.green : status === 'active' ? T.teal : T.text2;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '10px 0',
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <span style={{ fontSize: 13, color: T.text }}>{label}</span>
      <span style={{ color, fontSize: 12, fontWeight: 700 }}>{text}</span>
    </div>
  );
}
