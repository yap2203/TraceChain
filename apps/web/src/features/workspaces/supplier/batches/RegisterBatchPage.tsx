import './ingredient-creation.css';
import { useEffect, useRef, useState } from 'react';
import { type Country } from 'react-phone-number-input';
import flags from 'react-phone-number-input/flags';
import { FileSearch, Keyboard, Upload } from 'lucide-react';
import {
  normalizeIngredientQuantity,
  ingredientCountryCodes,
  type IngredientOrigin,
  type IngredientAllergen,
} from '@tracechain/shared';
import { BackNavigation } from '../../../../components/ui/BackNavigation';
import { reportError } from '../../../../components/ui/feedback';
import { Alert, Btn, Card, Input, SelectField, StepProgress } from '../../shared/ui';
import { RegistrationCountrySelect } from '../../../registration/RegistrationCountrySelect';
import {
  getIngredientDrafts,
  getCertificationDocument,
  extractIngredientDocument,
  prepareIngredientBatch,
  type IngredientDocumentExtraction,
  type IngredientBatchInput,
} from './ingredient-batch.api';
import { submitIngredientBatchTransaction } from './ingredient-batch-transaction';
import { imageFilePayload, uploadIngredientCatalogueImage } from '../../../orders/orders.api';
import {
  textError,
  referenceError,
  productionDateError,
} from '../../../validation/form-validation';
import {
  CertificationEditor,
  certificationError,
  certificationEntries,
  type CertificationDraft,
} from './CertificationEditor';
import { PresentationSigningSettingsLink } from '../../../didcomm/HolderSigningKeyPanel';
const names = new Intl.DisplayNames(['en'], { type: 'region' });
function OriginCountryFlag({ country, label }: { country?: Country; label: string }) {
  const Flag = country ? flags[country] : undefined;
  return Flag ? (
    <span className="block w-6 h-4 overflow-hidden rounded-sm [&>svg]:block [&>svg]:w-full [&>svg]:h-full">
      <Flag title={label} />
    </span>
  ) : (
    <span>{country ?? '—'}</span>
  );
}
const countries = ingredientCountryCodes
  .map((code) => ({ value: code as Country, label: names.of(code) ?? code }))
  .sort((a, b) => a.label.localeCompare(b.label));
const categories = [
  { value: 'cocoa', label: 'Cocoa & Chocolate' },
  { value: 'dairy', label: 'Dairy Products' },
  { value: 'sugar', label: 'Sugar & Sweeteners' },
  { value: 'grain', label: 'Grains & Flours' },
  { value: 'other', label: 'Other' },
];
interface Props {
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
}: Props) {
  const [mode, setMode] = useState<'choose' | 'manual' | 'document'>('choose'),
    [step, setStep] = useState(0);
  const [operationId] = useState(() => crypto.randomUUID());
  const [drafts, setDrafts] = useState<{ batchId: string; input: IngredientBatchInput }[]>([]);
  const [draft, setDraft] = useState({
    name: '',
    reference: '',
    category: 'cocoa',
    quantity: '',
    unit: 'kg',
    produced: '',
    expiry: '',
    country: '',
    region: '',
    city: '',
    facility: '',
    address: '',
    allergenKind: '',
    allergenDetails: '',
    price: '',
    currency: 'MYR',
    priceBasis: 'kg',
  });
  const [entries, setEntries] = useState<CertificationDraft[]>([]),
    [legacyCerts, setLegacyCerts] = useState<string[]>([]),
    [legacyOrigin, setLegacyOrigin] = useState('');
  const [extraction, setExtraction] = useState<IngredientDocumentExtraction>(),
    [sourceFile, setSourceFile] = useState<File>(),
    [extracting, setExtracting] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [image, setImage] = useState<File>(),
    [imageUrl, setImageUrl] = useState(''),
    [imageNotice, setImageNotice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [started, setStarted] = useState(false),
    [complete, setComplete] = useState(false),
    [status, setStatus] = useState('');
  const [batchId, setBatchId] = useState('');
  const confirmedStages = useRef(new Set<string>());
  const form = useRef<HTMLDivElement>(null),
    lock = useRef(false),
    frozen = useRef<IngredientBatchInput | undefined>(undefined);
  useEffect(() => setReviewed(false), [entries]);
  useEffect(() => {
    if (!image) {
      setImageUrl('');
      return;
    }
    const url = URL.createObjectURL(image);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const update = (key: keyof typeof draft) => (value: string) => {
    setDraft((old) => ({ ...old, [key]: value }));
    setReviewed(false);
    setErrors((old) => ({ ...old, [key]: '' }));
  };
  const origin: IngredientOrigin = {
    countryCode: draft.country,
    countryName: names.of(draft.country || 'ZZ') ?? '',
    ...(draft.region ? { region: draft.region } : {}),
    ...(draft.city ? { city: draft.city } : {}),
    ...(draft.facility ? { facility: draft.facility } : {}),
    ...(draft.address ? { privateAddress: draft.address } : {}),
  };
  const allergen: IngredientAllergen = {
    kind: draft.allergenKind as IngredientAllergen['kind'],
    ...(['contains', 'mayContain'].includes(draft.allergenKind) && draft.allergenDetails
      ? { details: draft.allergenDetails }
      : {}),
  };
  let conversion: { quantity: string; unit: string } | undefined;
  try {
    conversion = normalizeIngredientQuantity(draft.quantity, draft.unit);
  } catch {}
  const input = (): IngredientBatchInput => ({
    operationId,
    ingredientName: draft.name.trim(),
    batchReference: draft.reference.trim(),
    category: draft.category,
    quantity: draft.quantity,
    unit: draft.unit,
    productionDate: draft.produced,
    expiryDate: draft.expiry,
    origin: origin.countryName,
    originDetails: origin,
    allergen,
    allergenInformation:
      allergen.kind === 'declaresNone'
        ? 'Supplier declares none'
        : allergen.kind === 'unknown'
          ? 'Unknown'
          : `${allergen.kind === 'mayContain' ? 'May contain' : 'Contains'}: ${draft.allergenDetails}`,
    certifications: legacyCerts,
    certificationEntries: certificationEntries(entries),
    ...(draft.price
      ? { price: draft.price, currency: draft.currency, priceBasis: draft.priceBasis }
      : {}),
  });
  const validate = (which: number) => {
    const next: Record<string, string> = {};
    const put = (key: string, message: string) => {
      if (message) next[key] = message;
    };
    if (which === 0) {
      put('name', textError(draft.name, 'Ingredient name', 160));
      put('reference', referenceError(draft.reference));
      put('category', textError(draft.category, 'Category', 80));
      try {
        normalizeIngredientQuantity(draft.quantity, draft.unit);
      } catch (cause) {
        put('quantity', (cause as Error).message);
      }
      put('expiry', productionDateError(draft.produced, draft.expiry));
      if (!draft.produced) put('produced', 'Production date is required.');
    }
    if (which === 1) {
      for (const [key, label, max] of [
        ['region', 'State / region', 160],
        ['city', 'City / district', 160],
        ['facility', 'Source facility', 200],
        ['address', 'Source address', 1000],
      ] as const) {
        if (draft[key]) put(key, textError(draft[key], label, max));
      }
      if (!countries.some((country) => country.value === draft.country))
        put('country', 'Select the country of origin.');
      if (!draft.allergenKind) put('allergenKind', 'Choose an allergen declaration.');
      if (['contains', 'mayContain'].includes(draft.allergenKind))
        put('allergenDetails', textError(draft.allergenDetails, 'Allergen details', 500));
      put('certifications', certificationError(entries));
    }
    if (which === 2) {
      if (draft.price && !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(draft.price))
        put('price', 'Enter a non-negative price with up to two decimal places.');
      if (draft.price && !/^[A-Z]{3}$/.test(draft.currency))
        put('currency', 'Enter a three-letter currency code.');
      if (
        draft.price &&
        !(
          ['kg', 'g'].includes(draft.unit)
            ? ['kg', 'g']
            : ['litre', 'mL'].includes(draft.unit)
              ? ['litre', 'mL']
              : ['each']
        ).includes(draft.priceBasis)
      )
        put('priceBasis', 'Choose a price basis compatible with this batch.');
      if (extraction && !reviewed)
        put('reviewed', 'Confirm that you reviewed the extracted information.');
    }
    return next;
  };
  const focusError = () =>
    requestAnimationFrame(() =>
      form.current
        ?.querySelector<HTMLElement>(
          '[aria-invalid="true"], [data-error="true"] button, [data-error="true"] input, [data-error="true"] select',
        )
        ?.focus(),
    );
  const next = () => {
    const found = validate(step);
    setErrors(found);
    if (Object.keys(found).length) {
      focusError();
      return;
    }
    setStep((value) => Math.min(value + 1, 2));
    setError('');
  };
  const extract = async (file?: File) => {
    if (!file || extracting) return;
    if (
      ![
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png',
        'image/jpeg',
      ].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setError('Choose a PDF, DOCX, PNG or JPEG up to 10 MB.');
      return;
    }
    setExtracting(true);
    setError('');
    setSourceFile(file);
    setReviewed(false);
    try {
      const result = await extractDocument(file);
      setExtraction(result);
      const f = result.fields;
      const matched = countries.find(
        (country) =>
          country.label.toLowerCase() === f.origin.value.toLowerCase() ||
          country.value === f.origin.value.toUpperCase(),
      );
      setLegacyOrigin(f.origin.value);
      setLegacyCerts(
        f.certifications.value
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      );
      setDraft((old) => ({
        ...old,
        name: f.ingredientName.value,
        reference: f.batchReference.value,
        category: f.category.value,
        quantity: f.quantity.value,
        unit: f.unit.value === 'unit' ? 'each' : f.unit.value,
        produced: f.productionDate.value,
        expiry: f.expiryDate.value,
        country: matched?.value ?? '',
        price: f.price.value,
        currency: f.currency.value || 'MYR',
        priceBasis: f.unit.value === 'unit' ? 'each' : f.unit.value,
        allergenDetails: f.allergenInformation.value,
      }));
      setStep(0);
    } catch (cause) {
      setError(
        reportError(cause, 'The document could not be processed. Enter values manually or retry.'),
      );
    } finally {
      setExtracting(false);
    }
  };
  const resume = async (record: { batchId: string; input: IngredientBatchInput }) => {
    setBusy(true);
    setError('');
    try {
      const saved = currentIngredientInput(record.input);
      const restored: CertificationDraft[] = [];
      for (const entry of saved.certificationEntries ?? []) {
        const files = [];
        for (const descriptor of entry.documents) {
          const stored = await getCertificationDocument(record.batchId, descriptor.id);
          const bytes = Uint8Array.from(atob(stored.data), (c) => c.charCodeAt(0));
          files.push({
            id: descriptor.id,
            file: new File([bytes], stored.fileName, { type: stored.mimeType }),
            document: descriptor,
            status: 'stored' as const,
            progress: 100,
          });
        }
        const { documents, ...fields } = entry;
        restored.push({ ...fields, files });
      }
      frozen.current = saved;
      setStarted(true);
      setMode('manual');
      setStep(2);
      setBatchId(record.batchId);
      setEntries(restored);
      setLegacyCerts(saved.certifications);
      setLegacyOrigin(saved.origin);
      setStatus(
        'Recovered the persisted registration. Resume checks the chain before any transaction. Optional images must be reselected later if they were not saved.',
      );
      const source = saved.originDetails;
      setDraft((old) => ({
        ...old,
        name: saved.ingredientName,
        reference: saved.batchReference,
        category: saved.category,
        quantity: saved.quantity,
        unit: saved.unit,
        produced: saved.productionDate.slice(0, 10),
        expiry: saved.expiryDate.slice(0, 10),
        country: source?.countryCode ?? '',
        region: source?.region ?? '',
        city: source?.city ?? '',
        facility: source?.facility ?? '',
        address: source?.privateAddress ?? '',
        allergenKind: saved.allergen?.kind ?? 'unknown',
        allergenDetails: saved.allergen?.details ?? '',
        price: saved.price ?? '',
        currency: saved.currency ?? 'MYR',
        priceBasis: saved.priceBasis ?? saved.unit,
      }));
    } catch (cause) {
      setError(
        reportError(
          cause,
          'The stored registration could not be retrieved. Retry; do not recreate its batch.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const register = async () => {
    if (lock.current || complete) return;
    if (!frozen.current) {
      for (let page = 0; page < 3; page++) {
        const found = validate(page);
        if (Object.keys(found).length) {
          setStep(page);
          setErrors(found);
          focusError();
          return;
        }
      }
      frozen.current = input();
    }
    lock.current = true;
    setBusy(true);
    setStarted(true);
    setError('');
    try {
      setStatus('Issuing and storing the encrypted Ingredient Credential...');
      let workflow = await prepareWorkflow(frozen.current);
      setBatchId(workflow.batchId);
      for (let count = 0; workflow.state !== 'COMPLETE'; count++) {
        if (count >= 2 || !workflow.transaction)
          throw new Error(
            'The server returned an incomplete workflow. Retry to read its current state.',
          );
        setStatus(
          workflow.state === 'CREDENTIAL_REGISTRATION_REQUIRED'
            ? 'Awaiting MetaMask: register the Ingredient Credential. Confirmation includes submission and mining.'
            : 'Awaiting MetaMask: register the ingredient batch. Confirmation includes submission and mining.',
        );
        if (confirmedStages.current.has(workflow.state))
          throw new Error(
            'This transaction already confirmed. The RPC read is stale; resume to reread state without registering again.',
          );
        const currentStage = workflow.state;
        await submitTransaction(workflow.transaction, workflow.supplierWallet, (stage) =>
          setStatus(
            stage === 'wallet'
              ? 'Awaiting your explicit MetaMask confirmation.'
              : stage === 'submitted'
                ? 'Transaction submitted. Waiting for blockchain confirmation...'
                : 'Transaction confirmed. Reading the resulting batch state...',
          ),
        );
        confirmedStages.current.add(currentStage);
        setStatus('Transaction confirmed. Reading the batch registration state...');
        workflow = await prepareWorkflow(frozen.current);
      }
      setComplete(true);
      setStatus('Ingredient batch confirmed and read back from the blockchain.');
      if (image) {
        try {
          setStatus('Batch confirmed. Uploading the optional listing image...');
          await uploadIngredientCatalogueImage(workflow.batchId, await imageFilePayload(image));
          setImageNotice('Optional listing image saved.');
        } catch (cause) {
          setError(
            `The batch is already registered. ${reportError(cause, 'Add the optional image later from batch details. Do not register again.')}`,
          );
        } finally {
          setStatus('Ingredient batch confirmed and read back from the blockchain.');
        }
      }
    } catch (cause) {
      setError(
        reportError(
          cause,
          'Registration could not finish. Retry to resume the same operation; keep the same batch reference.',
        ),
      );
      setStatus(
        'Registration paused. Your data and stable operation ID are retained. Retry reads the chain before preparing the next transaction.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const field = (key: keyof typeof draft, label: string, extra: Record<string, unknown> = {}) => (
    <Input
      label={label}
      value={draft[key]}
      onChange={(value: string) => update(key)(key === 'currency' ? value.toUpperCase() : value)}
      error={errors[key]}
      {...extra}
    />
  );
  return (
    <div className="ingredient-create" ref={form}>
      <BackNavigation onClick={onBack} disabled={busy}>
        Back to ingredient batches
      </BackNavigation>
      <h2>Create ingredient batch</h2>
      {error && <Alert type="error" message={error} />}
      {mode === 'choose' ? (
        <Card>
          <h3>How would you like to add the ingredient?</h3>
          <div className="ingredient-entry-options">
            <button
              type="button"
              className="ingredient-entry-option"
              aria-label="Upload supply document"
              onClick={() => setMode('document')}
            >
              <FileSearch />
              <strong>Upload supply document</strong>
              <span>Extract editable values from a document.</span>
            </button>
            <button
              type="button"
              className="ingredient-entry-option"
              aria-label="Enter information manually"
              onClick={() => setMode('manual')}
            >
              <Keyboard />
              <strong>Enter information manually</strong>
              <span>Complete three short steps.</span>
            </button>
          </div>
          <div className="action-row">
            <Btn
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void getIngredientDrafts()
                  .then((result) => setDrafts(result.workflows))
                  .catch((cause) =>
                    setError(reportError(cause, 'Stored registrations could not be loaded.')),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Resume a registration
            </Btn>
          </div>
          {drafts.map((record) => (
            <div key={record.batchId} className="action-row">
              <span>
                {record.input.ingredientName} ? {record.input.batchReference}
              </span>
              <Btn variant="outline" disabled={busy} onClick={() => void resume(record)}>
                Resume saved batch
              </Btn>
            </div>
          ))}
        </Card>
      ) : (
        <>
          {mode === 'document' && !extraction ? (
            <Card>
              <h3>Upload supply document</h3>
              <p>
                PDF, DOCX, PNG or JPEG; maximum 10 MB. Extraction does not store the file as
                certification evidence.
              </p>
              <label className="ingredient-document-dropzone">
                <Upload />
                <span role={extracting ? 'status' : undefined}>
                  {extracting
                    ? 'Extracting document information...'
                    : 'Choose or drop your supply document'}
                </span>
                <input
                  aria-label="Choose supply document"
                  type="file"
                  accept=".pdf,.docx,.png,.jpg,.jpeg"
                  disabled={extracting}
                  onChange={(event) => void extract(event.target.files?.[0])}
                />
              </label>
              <Btn variant="outline" disabled={extracting} onClick={() => setMode('manual')}>
                Enter information manually
              </Btn>
            </Card>
          ) : (
            <>
              <StepProgress
                steps={['Batch details', 'Origin and certifications', 'Listing and review']}
                current={step}
              />
              {extraction && (
                <Alert
                  type="info"
                  message={`Pre-filled from ${extraction.document.filename}. Review and edit all values. Extraction is not certification or attachment storage.`}
                />
              )}
              {extraction && (
                <details>
                  <summary>Review extracted information</summary>
                  <p>
                    Extracted values are Supplier-provided, not independently certified. Edit them
                    in the steps below.
                  </p>
                  <dl>
                    {Object.entries(extraction.fields).map(([name, field]) => (
                      <div key={name}>
                        <dt>
                          {name} ? {field.confidence}
                        </dt>
                        <dd>{field.value || 'Not found; enter this value if required.'}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
              {extraction?.warnings.map((warning) => (
                <Alert key={warning} type="warning" message={warning} />
              ))}
              <Card>
                {step === 0 && (
                  <fieldset disabled={busy || started} className="ingredient-create-fields">
                    <legend>Batch details</legend>
                    <div className="workspace-form-grid">
                      {field('name', 'Ingredient name', {
                        required: true,
                        maxLength: 160,
                        hint: extraction
                          ? `Extracted confidence: ${extraction.fields.ingredientName.confidence}`
                          : undefined,
                      })}
                      {field('reference', 'Supplier batch reference', {
                        required: true,
                        maxLength: 120,
                      })}
                      <div data-error={Boolean(errors.category)}>
                        <SelectField
                          label="Category"
                          required
                          value={draft.category}
                          onChange={update('category')}
                          options={[{ value: '', label: 'Select category' }, ...categories]}
                        />
                        {errors.category && (
                          <p role="alert" className="text-ws-red">
                            {errors.category}
                          </p>
                        )}
                      </div>
                      {field('quantity', 'Quantity', {
                        required: true,
                        inputMode: 'decimal',
                        maxLength: 43,
                        placeholder: 'e.g. 1.25',
                      })}
                      <SelectField
                        label="Unit"
                        required
                        value={draft.unit}
                        onChange={(value) => {
                          update('unit')(value);
                          update('priceBasis')(value);
                        }}
                        options={['kg', 'g', 'litre', 'mL', 'each'].map((value) => ({
                          value,
                          label: value,
                        }))}
                      />
                      {field('produced', 'Production date', {
                        type: 'date',
                        required: true,
                      })}
                      {field('expiry', 'Expiry date', { type: 'date', required: true })}
                    </div>
                  </fieldset>
                )}
                {step === 1 && (
                  <fieldset disabled={busy || started} className="ingredient-create-fields">
                    <legend>Origin and certifications</legend>
                    <p className="ingredient-help">
                      Origin describes where the ingredient was sourced. Current storage and
                      dispatch locations are managed through locations and shipments.
                    </p>
                    <div className="workspace-form-grid">
                      <div data-error={Boolean(errors.country)} className="ingredient-country">
                        <label>
                          Country of origin <span className="text-ws-red">*</span>
                        </label>
                        <RegistrationCountrySelect
                          variant="field"
                          aria-label="Country of origin"
                          value={(draft.country || undefined) as Country | undefined}
                          onChange={(country) => update('country')(country ?? '')}
                          options={countries}
                          iconComponent={OriginCountryFlag}
                        />
                        {errors.country && (
                          <p role="alert" className="text-ws-red">
                            {errors.country}
                          </p>
                        )}
                      </div>
                      {field('region', 'State / region / province (optional)', { maxLength: 160 })}
                      {field('city', 'City / district (optional)', { maxLength: 160 })}
                      {field('facility', 'Source facility / farm name or reference (optional)', {
                        maxLength: 200,
                      })}
                      {field('address', 'Detailed source address (private, optional)', {
                        maxLength: 1000,
                      })}
                    </div>
                    {legacyOrigin && (
                      <p>
                        Original extracted origin: {legacyOrigin}. Select the country explicitly if
                        this text cannot be mapped confidently.
                      </p>
                    )}
                    <h3>Allergen declaration</h3>
                    <div data-error={Boolean(errors.allergenKind)}>
                      <SelectField
                        label="Allergen declaration"
                        required
                        value={draft.allergenKind}
                        onChange={update('allergenKind')}
                        options={[
                          { value: '', label: 'Choose a declaration' },
                          { value: 'contains', label: 'Contains' },
                          { value: 'mayContain', label: 'May contain' },
                          { value: 'declaresNone', label: 'Supplier declares none' },
                          { value: 'unknown', label: 'Unknown' },
                        ]}
                      />
                      {errors.allergenKind && (
                        <p role="alert" className="text-ws-red">
                          {errors.allergenKind}
                        </p>
                      )}
                    </div>
                    {['contains', 'mayContain'].includes(draft.allergenKind) &&
                      field('allergenDetails', 'Allergen details', {
                        required: true,
                        maxLength: 500,
                      })}
                    <h3>Certifications (optional)</h3>
                    {legacyCerts.length > 0 && (
                      <p>
                        Legacy extracted certification text: {legacyCerts.join(', ')}. Issuer,
                        scope, references and dates were not established by extraction.
                      </p>
                    )}
                    <div data-error={Boolean(errors.certifications)}>
                      <CertificationEditor
                        entries={entries}
                        setEntries={setEntries}
                        operationId={operationId}
                        sourceFile={sourceFile}
                        showErrors={Boolean(errors.certifications)}
                        disabled={busy || started}
                      />
                      {errors.certifications && (
                        <p role="alert" className="text-ws-red">
                          {errors.certifications}
                        </p>
                      )}
                    </div>
                  </fieldset>
                )}
                {step === 2 && (
                  <div className="ingredient-create-review">
                    <h3>Optional listing details</h3>
                    <fieldset disabled={busy || started} className="workspace-form-grid">
                      {field('price', 'Indicative price (optional)', {
                        inputMode: 'decimal',
                        maxLength: 15,
                      })}
                      {draft.price && (
                        <>
                          {field('currency', 'Currency', { required: true, maxLength: 3 })}
                          <SelectField
                            label="Price basis"
                            value={draft.priceBasis}
                            onChange={update('priceBasis')}
                            options={(['kg', 'g'].includes(draft.unit)
                              ? ['kg', 'g']
                              : ['litre', 'mL'].includes(draft.unit)
                                ? ['litre', 'mL']
                                : ['each']
                            ).map((value) => ({ value, label: `Per ${value}` }))}
                          />
                          {errors.priceBasis && <p role="alert">{errors.priceBasis}</p>}
                        </>
                      )}
                      <label>
                        Ingredient image (optional)
                        <input
                          aria-label="Choose optional ingredient image"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (
                              file &&
                              (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
                                file.size > 2 * 1024 * 1024)
                            ) {
                              setError('Use a PNG, JPEG or WebP image up to 2 MB.');
                              return;
                            }
                            setImage(file);
                          }}
                        />
                        <small>
                          Supplier-provided listing image; PNG, JPEG or WebP, maximum 2 MB.
                        </small>
                      </label>
                    </fieldset>
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt="Ingredient image preview"
                        className="ingredient-create-image"
                      />
                    )}
                    <h3>Review signed batch information</h3>
                    <dl className="workspace-review-grid">
                      {[
                        ['Ingredient', draft.name],
                        ['Batch reference', draft.reference],
                        ['Category', draft.category],
                        ['Quantity entered', `${draft.quantity} ${draft.unit}`],
                        [
                          'Registered quantity',
                          frozen.current && !frozen.current.originDetails
                            ? `${frozen.current.quantity} ${frozen.current.unit}`
                            : conversion
                              ? `${conversion.quantity} ${conversion.unit}`
                              : 'Invalid quantity',
                        ],
                        ['Production date', draft.produced],
                        ['Expiry date', draft.expiry],
                        ['Country / legacy origin', origin.countryName || legacyOrigin],
                        ['State / region', draft.region],
                        ['City / district', draft.city],
                        ['Source facility', draft.facility],
                        ['Private source address', draft.address],
                        [
                          'Allergen declaration',
                          frozen.current?.allergenInformation ?? input().allergenInformation,
                        ],
                        [
                          'Indicative price',
                          draft.price
                            ? `${draft.currency} ${draft.price} per ${draft.priceBasis}`
                            : 'Not supplied',
                        ],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{value || 'Unavailable'}</dd>
                        </div>
                      ))}
                    </dl>
                    {legacyCerts.length > 0 && (
                      <p>
                        Legacy certification text: {legacyCerts.join(', ')}. Issuer, reference,
                        dates and scope are unavailable unless separately supplied.
                      </p>
                    )}
                    <CertificationEditor
                      entries={entries}
                      setEntries={setEntries}
                      operationId={operationId}
                      readOnly
                    />
                    {extraction && (
                      <label data-error={Boolean(errors.reviewed)}>
                        <input
                          type="checkbox"
                          checked={reviewed}
                          disabled={started}
                          onChange={(event) => setReviewed(event.target.checked)}
                        />{' '}
                        I have reviewed every extracted value and confirm that the information is
                        accurate.
                      </label>
                    )}
                    {errors.reviewed && (
                      <p role="alert" className="text-ws-red">
                        {errors.reviewed}
                      </p>
                    )}
                    <p className="ingredient-help">
                      Batch identity, canonical quantity/unit, dates, origin, allergen declaration,
                      certification entries and document hashes/references become signed claims.
                      Private details and documents are encrypted off-chain. Price, currency, price
                      basis and image are separate listing metadata. A Supplier signature does not
                      verify a certification authority.
                    </p>
                    <PresentationSigningSettingsLink role="supplier" />
                    {started && <p role="status">{status}</p>}
                    {started && !complete && (
                      <p>
                        Signed details are locked after registration begins. Retry resumes this same
                        operation; changes to signed claims require replacement/reissuance.
                      </p>
                    )}
                    {complete && (
                      <Alert
                        type="success"
                        message="The ingredient batch was confirmed and read back from the blockchain."
                      />
                    )}
                    {imageNotice && <Alert type="success" message={imageNotice} />}
                    {batchId && (
                      <details>
                        <summary>Registration reference</summary>
                        <code>{batchId}</code>
                      </details>
                    )}
                  </div>
                )}
                <div className="action-row ingredient-create-actions">
                  {step > 0 && !complete && (
                    <Btn
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setErrors({});
                        setStep((value) => value - 1);
                      }}
                    >
                      Back
                    </Btn>
                  )}
                  {step < 2 ? (
                    <Btn disabled={busy} onClick={next}>
                      Continue
                    </Btn>
                  ) : (
                    <Btn
                      disabled={busy}
                      onClick={complete ? (onCompleted ?? onBack) : () => void register()}
                    >
                      {complete
                        ? 'View ingredient batches'
                        : busy
                          ? 'Processing registration...'
                          : started
                            ? 'Resume registration'
                            : 'Register with MetaMask'}
                    </Btn>
                  )}
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function currentIngredientInput(input: IngredientBatchInput): IngredientBatchInput {
  const current = { ...input } as IngredientBatchInput & Record<string, unknown>;
  delete current.qualityTests;
  delete current.internalQualityRemarks;
  delete current.productionDateMeaning;
  if (!current.originDetails) return current;
  const originDetails = { ...current.originDetails } as IngredientOrigin & Record<string, unknown>;
  delete originDetails.processingCountry;
  delete originDetails.processingLocation;
  return { ...current, originDetails };
}
