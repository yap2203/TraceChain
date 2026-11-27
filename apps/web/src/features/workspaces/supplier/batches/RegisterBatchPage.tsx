import './ingredient-creation.css';
import { useEffect, useRef, useState } from 'react';
import { type Country } from 'react-phone-number-input';
import flags from 'react-phone-number-input/flags';
import { ArrowLeft, ArrowRight, FileSearch, Keyboard, LoaderCircle, Upload } from 'lucide-react';
import {
  normalizeIngredientQuantity,
  ingredientCountryCodes,
  type IngredientOrigin,
  type IngredientAllergen,
} from '@tracechain/shared';
import { BackNavigation } from '../../../../components/ui/BackNavigation';
import { reportError } from '../../../../components/ui/feedback';
import {
  Alert,
  Badge,
  Btn,
  Card,
  Input,
  RadioGroup,
  SelectField,
  StepProgress,
  Textarea,
} from '../../shared/ui';
import { RegistrationCountrySelect } from '../../../registration/RegistrationCountrySelect';
import {
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
  /** Called with the new batch ID once registration is confirmed. */
  onCompleted?: (batchId: string) => void;
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
    [imageError, setImageError] = useState(''),
    [imageUrl, setImageUrl] = useState(''),
    [imageNotice, setImageNotice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [started, setStarted] = useState(false),
    [complete, setComplete] = useState(false),
    [status, setStatus] = useState(''),
    // Set when a review section's Edit opened an earlier step; Continue then returns to review.
    [fromReview, setFromReview] = useState(false);
  const [batchId, setBatchId] = useState('');
  const confirmedStages = useRef(new Set<string>());
  const form = useRef<HTMLDivElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
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
    certificationEntries: certificationEntries(entries, draft.reference.trim()),
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
    editStep(fromReview ? 2 : Math.min(step + 1, 2));
    setFromReview(false);
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
    let confirmationPending = false;
    let sent = false;
    try {
      setStatus('Preparing registration…');
      let workflow = await prepareWorkflow(frozen.current);
      setBatchId(workflow.batchId);
      for (let count = 0; workflow.state !== 'COMPLETE'; count++) {
        if (count >= 2 || !workflow.transaction)
          throw new Error(
            'The server returned an incomplete workflow. Retry to read its current state.',
          );
        setStatus(
          workflow.state === 'CREDENTIAL_REGISTRATION_REQUIRED'
            ? 'Confirm the credential transaction in MetaMask.'
            : 'Confirm the batch transaction in MetaMask.',
        );
        if (confirmedStages.current.has(workflow.state))
          throw new Error(
            'This transaction already confirmed, but the blockchain read is behind. Choose Retry registration to read it again; nothing is registered twice.',
          );
        const currentStage = workflow.state;
        await submitTransaction(workflow.transaction, workflow.supplierWallet, (stage) => {
          confirmationPending = stage === 'submitted';
          if (stage === 'submitted') sent = true;
          if (stage !== 'wallet')
            setStatus(
              stage === 'submitted'
                ? 'Waiting for blockchain confirmation…'
                : 'Confirmed. Checking the result…',
            );
        });
        confirmationPending = false;
        confirmedStages.current.add(currentStage);
        workflow = await prepareWorkflow(frozen.current);
      }
      setComplete(true);
      let imageFailed = false;
      if (image) {
        try {
          setStatus('Saving the listing image…');
          await uploadIngredientCatalogueImage(workflow.batchId, await imageFilePayload(image));
          setImageNotice('Optional listing image saved.');
        } catch (cause) {
          imageFailed = true;
          setError(
            `The batch is already registered. ${reportError(cause, 'Add the optional image later from batch details. Do not register again.')}`,
          );
        }
      }
      setStatus('');
      // Done: go straight to the new record, unless the image error needs reading first.
      if (!imageFailed) onCompleted?.(workflow.batchId);
    } catch (cause) {
      // Nothing reached the chain in this attempt (server refused or MetaMask cancelled):
      // unlock the form so entries can be corrected. After any transaction, it stays locked.
      if (!sent && confirmedStages.current.size === 0) {
        setStarted(false);
        frozen.current = undefined;
      }
      if ((cause as { code?: string }).code === 'WORKFLOW_CONFLICT') {
        const message = `Batch reference "${draft.reference.trim()}" is already used by another registration. Use a different batch reference, or find that batch in My ingredients if it was already registered.`;
        setError(message);
        setStatus('');
        setStep(0);
        setErrors({ reference: message });
        focusError();
        return;
      }
      setError(
        reportError(
          cause,
          'Registration could not finish. Your entries are kept; choose Retry registration.',
        ),
      );
      setStatus(
        confirmationPending && !/revert/i.test(cause instanceof Error ? cause.message : '')
          ? 'Transaction sent, but its confirmation is not known yet. Retry registration checks the chain first and will not register twice.'
          : '',
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
  const editStep = (page: number) => {
    setErrors({});
    setStep(page);
    requestAnimationFrame(() =>
      form.current?.querySelector<HTMLElement>('legend, #listing-heading')?.focus(),
    );
  };
  // Step indicator navigation: back freely; forward only through steps that pass the same checks as Continue.
  const goToStep = (target: number) => {
    if (busy || started || target === step) return;
    if (target > step)
      for (let page = step; page < target; page++) {
        const found = validate(page);
        if (Object.keys(found).length) {
          setStep(page);
          setErrors(found);
          focusError();
          return;
        }
      }
    setFromReview(false);
    editStep(target);
  };
  const reviewValue = (label: string, value: string) => (
    <div key={label}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  return (
    <div className="ingredient-create" ref={form}>
      <BackNavigation onClick={onBack} disabled={busy}>
        My ingredients
      </BackNavigation>
      <header className="ingredient-create-header">
        <h2>Register ingredient batch</h2>
        <p>Record a new batch on chain. You confirm it in MetaMask at the last step.</p>
      </header>
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
                onSelect={goToStep}
                disabled={busy || started}
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
                          {name} · {field.confidence}
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
                    <legend className="sr-only" tabIndex={-1}>
                      Batch details
                    </legend>
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
                      <div className="ingredient-quantity-fields">
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
                      </div>
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
                    <legend className="sr-only" tabIndex={-1}>
                      Origin and certifications
                    </legend>
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
                      <div className="is-full">
                        <Textarea
                          label="Detailed source address (private, optional)"
                          value={draft.address}
                          onChange={update('address')}
                          maxLength={1000}
                          rows={2}
                          error={errors.address}
                          hint="Private: stored encrypted and shared only if you choose to disclose it."
                        />
                      </div>
                    </div>
                    {legacyOrigin && (
                      <p>
                        Original extracted origin: {legacyOrigin}. Select the country explicitly if
                        this text cannot be mapped confidently.
                      </p>
                    )}
                    <h3 className="ingredient-form-divider">Allergen declaration</h3>
                    <div data-error={Boolean(errors.allergenKind)}>
                      <RadioGroup
                        label="Allergen declaration"
                        required
                        value={draft.allergenKind}
                        onChange={update('allergenKind')}
                        error={errors.allergenKind}
                        options={[
                          { value: 'contains', label: 'Contains' },
                          { value: 'mayContain', label: 'May contain' },
                          { value: 'declaresNone', label: 'Supplier declares none' },
                          { value: 'unknown', label: 'Unknown' },
                        ]}
                      />
                    </div>
                    {['contains', 'mayContain'].includes(draft.allergenKind) && (
                      <div className="ingredient-allergen-details">
                        <Textarea
                          label="Allergen details"
                          required
                          value={draft.allergenDetails}
                          onChange={update('allergenDetails')}
                          maxLength={500}
                          rows={2}
                          error={errors.allergenDetails}
                          hint="Required for Contains and May contain, e.g. milk, soy, tree nuts."
                        />
                      </div>
                    )}
                    <h3 className="ingredient-form-divider">Certifications (optional)</h3>
                    {legacyCerts.length > 0 && (
                      <p>
                        Legacy extracted certification text: {legacyCerts.join(', ')}. Issuer,
                        scope, references and dates were not established by extraction.
                      </p>
                    )}
                    <div data-error={Boolean(errors.certifications)}>
                      <CertificationEditor
                        batchReference={draft.reference}
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
                    <section
                      className="ingredient-review-section"
                      aria-labelledby="batch-review-heading"
                    >
                      <header className="ingredient-review-heading">
                        <h3 id="batch-review-heading">Batch details</h3>
                        <Btn
                          variant="ghost"
                          size="sm"
                          disabled={busy || started}
                          onClick={() => {
                            setFromReview(true);
                            editStep(0);
                          }}
                        >
                          Edit batch details
                        </Btn>
                      </header>
                      <dl className="workspace-review-grid">
                        {[
                          ['Ingredient', draft.name],
                          ['Batch reference', draft.reference],
                          [
                            'Category',
                            categories.find((item) => item.value === draft.category)?.label ??
                              draft.category,
                          ],
                          ['Production date', formatReviewDate(draft.produced)],
                          ['Expiry date', formatReviewDate(draft.expiry)],
                        ].map(([label, value]) => reviewValue(label, value || 'Unavailable'))}
                        <div>
                          <dt>Quantity</dt>
                          <dd>
                            {draft.quantity} {draft.unit}
                            <small className="ingredient-quantity-note">
                              Registered as{' '}
                              {formatQuantity(
                                frozen.current && !frozen.current.originDetails
                                  ? frozen.current.quantity
                                  : (conversion?.quantity ?? ''),
                              )}{' '}
                              {frozen.current && !frozen.current.originDetails
                                ? frozen.current.unit
                                : conversion?.unit}
                            </small>
                          </dd>
                        </div>
                      </dl>
                    </section>
                    <section
                      className="ingredient-review-section"
                      aria-labelledby="origin-review-heading"
                    >
                      <header className="ingredient-review-heading">
                        <h3 id="origin-review-heading">Origin and allergens</h3>
                        <Btn
                          variant="ghost"
                          size="sm"
                          disabled={busy || started}
                          onClick={() => {
                            setFromReview(true);
                            editStep(1);
                          }}
                        >
                          Edit origin and certifications
                        </Btn>
                      </header>
                      <dl className="workspace-review-grid">
                        {reviewValue(
                          draft.country ? 'Country of origin' : 'Origin (previously supplied text)',
                          draft.country ? origin.countryName : legacyOrigin || 'Unavailable',
                        )}
                        {draft.region && reviewValue('State / region', draft.region)}
                        {draft.city && reviewValue('City / district', draft.city)}
                        {draft.facility && reviewValue('Source facility', draft.facility)}
                        {draft.address && reviewValue('Private source address', draft.address)}
                      </dl>
                      <div className="ingredient-allergen-summary">
                        <span>Allergen declaration</span>
                        {(frozen.current?.allergen?.kind ?? allergen.kind) === 'unknown' ? (
                          <Badge label="Unknown" variant="pending" />
                        ) : (
                          <strong>
                            {frozen.current?.allergenInformation ?? input().allergenInformation}
                          </strong>
                        )}
                      </div>
                    </section>
                    <section
                      className="ingredient-review-section"
                      aria-labelledby="certifications-review-heading"
                    >
                      <h3 id="certifications-review-heading">Certifications</h3>
                      {legacyCerts.length > 0 && (
                        <p>
                          Legacy certification text: {legacyCerts.join(', ')}. Issuer, reference,
                          dates and scope are unavailable unless separately supplied.
                        </p>
                      )}
                      <CertificationEditor
                        batchReference={draft.reference}
                        entries={entries}
                        setEntries={setEntries}
                        operationId={operationId}
                        readOnly
                      />
                    </section>
                    <section
                      className="ingredient-review-section"
                      aria-labelledby="listing-heading"
                    >
                      <header className="ingredient-review-heading">
                        <div>
                          <h3 id="listing-heading" tabIndex={-1}>
                            Optional listing details
                          </h3>
                          <p className="ingredient-help">
                            Add a price or photo, or skip this section.
                          </p>
                        </div>
                        <span className="ingredient-optional-badge">Optional</span>
                      </header>
                      <fieldset disabled={busy || started} className="ingredient-listing-fields">
                        <div className="workspace-form-grid ingredient-price-fields">
                          {field('price', 'Indicative price (optional)', {
                            inputMode: 'decimal',
                            maxLength: 15,
                            hint: 'If you add a price, currency and price basis are required.',
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
                        </div>
                        <div className="ingredient-listing-upload">
                          <label htmlFor="ingredient-listing-image">
                            Ingredient image (optional)
                          </label>
                          <input
                            ref={imageInput}
                            id="ingredient-listing-image"
                            className="sr-only"
                            tabIndex={-1}
                            aria-label="Choose optional ingredient image"
                            aria-invalid={Boolean(imageError)}
                            aria-describedby="ingredient-image-rules ingredient-image-error"
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = '';
                              if (!file) return;
                              if (
                                file &&
                                (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
                                  file.size > 2 * 1024 * 1024)
                              ) {
                                setImageError('Use a PNG, JPEG or WebP image up to 2 MB.');
                                return;
                              }
                              setImageError('');
                              setImage(file);
                            }}
                          />
                          {image && imageUrl ? (
                            <div className="ingredient-image-selection">
                              <img
                                src={imageUrl}
                                alt="Ingredient image preview"
                                className="ingredient-create-image"
                              />
                              <div className="ingredient-image-file">
                                <strong>{image.name}</strong>
                                <small className="ingredient-help">
                                  {(image.size / 1024).toFixed(1)} KB
                                </small>
                                <div className="ingredient-image-actions">
                                  <Btn
                                    variant="outline"
                                    size="sm"
                                    onClick={() => imageInput.current?.click()}
                                  >
                                    Replace image
                                  </Btn>
                                  <Btn
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setImage(undefined);
                                      setImageError('');
                                    }}
                                  >
                                    Remove image
                                  </Btn>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <Btn
                              variant="outline"
                              icon={<Upload size={16} aria-hidden="true" />}
                              onClick={() => imageInput.current?.click()}
                            >
                              Choose image
                            </Btn>
                          )}
                          <small id="ingredient-image-rules" className="ingredient-help">
                            PNG, JPEG or WebP · Up to 2 MB · Supplier-provided listing photo.
                          </small>
                          <span
                            id="ingredient-image-error"
                            className="text-ws-red"
                            role={imageError ? 'alert' : undefined}
                          >
                            {imageError}
                          </span>
                        </div>
                      </fieldset>
                    </section>
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
                    {status && (
                      <div
                        className="ingredient-registration-status"
                        role="status"
                        aria-live="polite"
                      >
                        {busy && (
                          <LoaderCircle
                            size={18}
                            className="animate-spin shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <span>{status}</span>
                      </div>
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
                {step === 2 && !complete && (
                  <section
                    className="ingredient-confirm"
                    aria-labelledby="ingredient-confirm-title"
                  >
                    <h3 id="ingredient-confirm-title">Before you register</h3>
                    <p className="ingredient-confirm__summary">
                      <strong>{draft.name || 'Ingredient'}</strong> · batch {draft.reference} ·{' '}
                      {draft.quantity} {draft.unit} · expires {formatReviewDate(draft.expiry)} ·{' '}
                      {entries.length} {entries.length === 1 ? 'certification' : 'certifications'}
                    </p>
                    <ul>
                      <li>
                        Batch details, origin, allergens and certifications are signed and cannot be
                        edited later. Price, photo and description can.
                      </li>
                      <li>
                        MetaMask asks you to confirm up to two transactions. Private details and
                        documents stay encrypted off-chain.
                      </li>
                      <li>Certifications stay marked as supplier-provided, not verified.</li>
                    </ul>
                  </section>
                )}
                <div className="ingredient-create-actions">
                  {!complete && (
                    <Btn
                      variant="outline"
                      icon={<ArrowLeft size={16} aria-hidden="true" />}
                      disabled={busy}
                      onClick={() => {
                        setErrors({});
                        if (step > 0) editStep(step - 1);
                        else setMode('choose');
                      }}
                    >
                      Back
                    </Btn>
                  )}
                  {step < 2 ? (
                    <Btn disabled={busy} onClick={next}>
                      {fromReview ? 'Save and return to review' : 'Continue'}{' '}
                      <ArrowRight size={16} aria-hidden="true" />
                    </Btn>
                  ) : (
                    <Btn
                      disabled={busy}
                      onClick={
                        complete
                          ? () => (onCompleted ? onCompleted(batchId) : onBack())
                          : () => void register()
                      }
                    >
                      {complete
                        ? 'View ingredient batches'
                        : busy
                          ? 'Registering…'
                          : started
                            ? 'Retry registration'
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

function formatReviewDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value || 'Unavailable'
    : new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date);
}

function formatQuantity(value: string) {
  // Keep the exact decimal string; Number can round large registered quantities.
  const [whole, fraction] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`;
}
