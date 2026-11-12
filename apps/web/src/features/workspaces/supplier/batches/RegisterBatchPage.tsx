import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { FileSearch, Keyboard, Upload } from 'lucide-react';

import { Alert, Btn, Card, Input, SelectField, StepProgress, T } from '../../shared/ui';
import {
  extractIngredientDocument,
  prepareIngredientBatch,
  type ExtractedIngredientField,
  type IngredientBatchInput,
  type IngredientDocumentExtraction,
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
  extractDocument?: typeof extractIngredientDocument;
  prepareWorkflow?: typeof prepareIngredientBatch;
  submitTransaction?: typeof submitIngredientBatchTransaction;
}

export function RegisterBatch({
  onBack,
  onCompleted,
  extractDocument = extractIngredientDocument,
  prepareWorkflow = prepareIngredientBatch,
  submitTransaction = submitIngredientBatchTransaction,
}: RegisterBatchProps) {
  const [entryMode, setEntryMode] = useState<'choose' | 'document' | 'manual'>('choose');
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
  const [extraction, setExtraction] = useState<IngredientDocumentExtraction>();
  const [extracting, setExtracting] = useState(false);
  const [extractionConfirmed, setExtractionConfirmed] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [credentialStep, setCredentialStep] = useState<WorkflowStep>('waiting');
  const [batchStep, setBatchStep] = useState<WorkflowStep>('waiting');
  const activeSubmission = useRef(false);

  const update = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (extraction) setExtractionConfirmed(false);
  };

  const startManualEntry = () => {
    setEntryMode('manual');
    setExtraction(undefined);
    setExtractionConfirmed(false);
    setName('');
    setBatchReference('');
    setCategory('cocoa');
    setOrigin('');
    setProducedAt('');
    setExpiresAt('');
    setQuantity('');
    setUnit('g');
    setPrice('');
    setCurrency('MYR');
    setAllergen('');
    setCertifications('');
    setImageFile(undefined);
    setError('');
  };

  const extractFile = async (file: File | undefined) => {
    if (!file || extracting) return;
    const supportedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png',
      'image/jpeg',
    ];
    if (!supportedTypes.includes(file.type)) {
      setError('Choose a PDF, DOCX, PNG or JPG/JPEG document.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Documents must not exceed 10 MB.');
      return;
    }
    setEntryMode('document');
    setExtracting(true);
    setExtraction(undefined);
    setExtractionConfirmed(false);
    setError('');
    try {
      const result = await extractDocument(file);
      setExtraction(result);
      setName(result.fields.ingredientName.value);
      setBatchReference(result.fields.batchReference.value);
      setCategory(result.fields.category.value);
      setOrigin(result.fields.origin.value);
      setProducedAt(result.fields.productionDate.value);
      setExpiresAt(result.fields.expiryDate.value);
      setQuantity(result.fields.quantity.value);
      setUnit(result.fields.unit.value);
      setPrice(result.fields.price.value);
      setCurrency(result.fields.currency.value);
      setCertifications(result.fields.certifications.value);
      setAllergen(result.fields.allergenInformation.value);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The document could not be processed. Enter the values manually instead.',
      );
    } finally {
      setExtracting(false);
    }
  };

  const dropDocument = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    void extractFile(event.dataTransfer.files[0]);
  };

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
  const extractionReviewError =
    extraction && !extractionConfirmed
      ? 'Review every extracted value and confirm that the information is accurate.'
      : '';
  const isFormComplete = !validationError && !extractionReviewError;

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

        {entryMode === 'choose' && (
          <Card>
            <div className="ingredient-entry-heading">
              <div>
                <h3>How would you like to add the ingredient?</h3>
                <p>Upload a supply document to pre-fill the form, or enter the values manually.</p>
              </div>
            </div>
            <div className="ingredient-entry-options">
              <button
                type="button"
                className="ingredient-entry-option"
                aria-label="Upload supply document"
                onClick={() => setEntryMode('document')}
              >
                <FileSearch size={24} aria-hidden="true" />
                <strong>Upload supply document</strong>
                <span>Extract text locally from PDF, DOCX, PNG or JPG.</span>
              </button>
              <button
                type="button"
                className="ingredient-entry-option"
                aria-label="Enter information manually"
                onClick={startManualEntry}
              >
                <Keyboard size={24} aria-hidden="true" />
                <strong>Enter information manually</strong>
                <span>Complete the existing registration form yourself.</span>
              </button>
            </div>
          </Card>
        )}

        {entryMode === 'document' && !extraction && (
          <Card>
            <div className="ingredient-entry-heading">
              <div>
                <h3>Upload supply document</h3>
                <p>PDF, DOCX, PNG or JPG/JPEG. Maximum 10 MB.</p>
              </div>
              <Btn
                variant="ghost"
                size="sm"
                onClick={() => setEntryMode('choose')}
                disabled={extracting}
              >
                Change method
              </Btn>
            </div>
            <div
              className={`ingredient-document-dropzone ${dragActive ? 'is-dragging' : ''}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragActive(false)}
              onDrop={dropDocument}
            >
              <Upload size={28} aria-hidden="true" />
              <strong>
                {extracting ? 'Extracting document information…' : 'Drop your document here'}
              </strong>
              <span>
                {extracting
                  ? 'The file stays in memory and is discarded after extraction.'
                  : 'or choose one file from your device'}
              </span>
              {!extracting && (
                <label className="ingredient-document-picker">
                  Choose document
                  <input
                    aria-label="Choose supply document"
                    type="file"
                    accept=".pdf,.docx,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg"
                    onChange={(event) => void extractFile(event.target.files?.[0])}
                  />
                </label>
              )}
              {extracting && <span className="ingredient-document-progress" role="status" />}
            </div>
            <p className="ingredient-document-privacy">
              The document is used only to assist data entry. It is not registered, stored, sent to
              an external AI service or uploaded to IPFS.
            </p>
            <Btn variant="outline" full onClick={startManualEntry} disabled={extracting}>
              Enter information manually instead
            </Btn>
          </Card>
        )}

        {entryMode !== 'choose' && (entryMode === 'manual' || extraction) && (
          <StepProgress
            steps={
              extraction
                ? ['Upload document', 'Review extracted information', 'Review & register']
                : ['Ingredient information', 'Review & register']
            }
            current={extraction ? step + 1 : step}
          />
        )}

        {step === 0 && (entryMode === 'manual' || extraction) && (
          <Card>
            <div className="ingredient-form-heading">
              <div>
                <strong>
                  {extraction ? 'Review extracted information' : 'Ingredient information'}
                </strong>
                {extraction && (
                  <span>
                    {extraction.document.filename} · {(extraction.document.size / 1024).toFixed(1)}{' '}
                    KB
                  </span>
                )}
              </div>
              <Btn
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEntryMode('choose');
                  setExtraction(undefined);
                  setExtractionConfirmed(false);
                }}
              >
                Change method
              </Btn>
            </div>
            {extraction?.warnings.map((warning) => (
              <Alert key={warning} type="warning" message={warning} />
            ))}
            <div className="ingredient-registration-form">
              <fieldset className="ingredient-form-section">
                <legend>Basic ingredient information</legend>
                <div className="workspace-form-grid">
                  <ExtractionField field={extraction?.fields.ingredientName} required>
                    <Input
                      label="Ingredient name"
                      maxLength={160}
                      placeholder="Cocoa Powder"
                      value={name}
                      onChange={update(setName)}
                      required
                    />
                  </ExtractionField>
                  <ExtractionField field={extraction?.fields.batchReference} required>
                    <Input
                      label="Batch reference"
                      maxLength={120}
                      pattern="[A-Za-z0-9._:/-]+"
                      placeholder="COCOA-2026-001"
                      value={batchReference}
                      onChange={update(setBatchReference)}
                      required
                    />
                  </ExtractionField>
                </div>
                <ExtractionField field={extraction?.fields.category} required>
                  <SelectField
                    label="Category"
                    value={category}
                    onChange={update(setCategory)}
                    required
                    options={[
                      { value: '', label: 'Select category' },
                      { value: 'cocoa', label: 'Cocoa & Chocolate' },
                      { value: 'dairy', label: 'Dairy Products' },
                      { value: 'sugar', label: 'Sugar & Sweeteners' },
                      { value: 'grain', label: 'Grains & Flours' },
                      { value: 'other', label: 'Other' },
                    ]}
                  />
                </ExtractionField>
              </fieldset>

              <fieldset className="ingredient-form-section">
                <legend>Origin and dates</legend>
                <div className="workspace-form-grid">
                  <ExtractionField field={extraction?.fields.origin} required>
                    <Input
                      label="Country / location of origin"
                      maxLength={160}
                      placeholder="Ghana"
                      value={origin}
                      onChange={update(setOrigin)}
                      required
                    />
                  </ExtractionField>
                  <ExtractionField field={extraction?.fields.productionDate} required>
                    <Input
                      label="Production date"
                      max={new Date().toISOString().slice(0, 10)}
                      type="date"
                      value={producedAt}
                      onChange={update(setProducedAt)}
                      required
                    />
                  </ExtractionField>
                  <ExtractionField field={extraction?.fields.expiryDate} required>
                    <Input
                      label="Expiry date"
                      type="date"
                      value={expiresAt}
                      onChange={update(setExpiresAt)}
                      required
                    />
                  </ExtractionField>
                </div>
              </fieldset>

              <fieldset className="ingredient-form-section">
                <legend>Quantity and indicative price</legend>
                <div className="workspace-form-grid workspace-form-grid--quantity">
                  <ExtractionField field={extraction?.fields.quantity} required>
                    <Input
                      label="Quantity"
                      inputMode="numeric"
                      pattern="[1-9][0-9]{0,38}"
                      maxLength={39}
                      placeholder="500"
                      value={quantity}
                      onChange={update(setQuantity)}
                      required
                    />
                  </ExtractionField>
                  <ExtractionField field={extraction?.fields.unit} required>
                    <SelectField
                      label="Unit"
                      value={unit}
                      onChange={update(setUnit)}
                      required
                      options={[
                        { value: '', label: 'Select unit' },
                        { value: 'kg', label: 'kg' },
                        { value: 'g', label: 'g (integer grams; 1000 g = 1 kg)' },
                        { value: 'each', label: 'each (individual items)' },
                        { value: 'litre', label: 'litre' },
                        { value: 'unit', label: 'unit' },
                      ]}
                    />
                  </ExtractionField>
                  <ExtractionField field={extraction?.fields.price}>
                    <Input
                      label={`Price per ${unit || 'unit'} (optional)`}
                      value={price}
                      onChange={update(setPrice)}
                      type="number"
                      min="0"
                      step="0.01"
                    />
                  </ExtractionField>
                  <ExtractionField field={extraction?.fields.currency}>
                    <Input
                      label="Currency code"
                      value={currency}
                      onChange={(value) => update(setCurrency)(value.toUpperCase())}
                      maxLength={3}
                    />
                  </ExtractionField>
                </div>
              </fieldset>

              <fieldset className="ingredient-form-section">
                <legend>Credential claims</legend>
                <p>
                  These values become part of the signed Ingredient Credential and cannot be changed
                  through listing edits.
                </p>
                <ExtractionField field={extraction?.fields.allergenInformation}>
                  <Input
                    label="Allergen information"
                    maxLength={500}
                    placeholder="None"
                    value={allergen}
                    onChange={update(setAllergen)}
                  />
                </ExtractionField>
                <ExtractionField field={extraction?.fields.certifications}>
                  <Input
                    label="Certifications"
                    placeholder="Organic, Halal, Fair Trade"
                    value={certifications}
                    onChange={update(setCertifications)}
                    hint="Separate multiple certifications with commas"
                  />
                </ExtractionField>
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
              {extraction && (
                <div className="ingredient-extraction-confirmation">
                  <Alert
                    type="warning"
                    message="Extracted information is supplier-provided and has not been independently certified by TraceChain."
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={extractionConfirmed}
                      onChange={(event) => setExtractionConfirmed(event.target.checked)}
                    />
                    <span>
                      I have reviewed the extracted information and confirm that it is accurate.
                    </span>
                  </label>
                </div>
              )}
              <Btn
                onClick={() => {
                  if (!isFormComplete) setError(validationError || extractionReviewError);
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

        {step === 1 && (entryMode === 'manual' || extraction) && (
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

function ExtractionField({
  children,
  field,
  required = false,
}: {
  children: ReactNode;
  field?: ExtractedIngredientField;
  required?: boolean;
}) {
  if (!field) return children;
  const stateClass = field.confidence.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className={`ingredient-extracted-field is-${stateClass}`}>
      {children}
      <span className="ingredient-extracted-field__status">{field.confidence}</span>
      {required && field.confidence === 'Missing' && (
        <span className="ingredient-extracted-field__required">
          Required field not found. Enter a value before continuing.
        </span>
      )}
    </div>
  );
}
