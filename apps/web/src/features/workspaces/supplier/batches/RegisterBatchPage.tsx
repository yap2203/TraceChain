import { useRef, useState } from 'react';

import { Alert, Btn, Card, Input, SelectField, StepProgress, T } from '../../shared/ui';
import {
  prepareIngredientBatch,
  type IngredientBatchInput,
  type IngredientBatchWorkflow,
} from './ingredient-batch.api';
import { submitIngredientBatchTransaction } from './ingredient-batch-transaction';
import { HolderSigningKeyPanel } from '../../../didcomm/HolderSigningKeyPanel';

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
  const [unit, setUnit] = useState('kg');
  const [allergen, setAllergen] = useState('');
  const [certifications, setCertifications] = useState('');
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
  });

  const isFormComplete = Boolean(
    name.trim() &&
    batchReference.trim() &&
    origin.trim() &&
    producedAt &&
    expiresAt &&
    /^[1-9]\d*$/.test(quantity),
  );

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
    if (activeSubmission.current) return;
    activeSubmission.current = true;
    setBusy(true);
    setError('');
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
        <StepProgress steps={['Ingredient information', 'Review & register']} current={step} />

        {step === 0 && (
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 20 }}>
              Ingredient information
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              <div className="workspace-form-grid">
                <Input
                  label="Ingredient name"
                  placeholder="Cocoa Powder"
                  value={name}
                  onChange={setName}
                  required
                />
                <Input
                  label="Batch reference"
                  placeholder="COCOA-2026-001"
                  value={batchReference}
                  onChange={setBatchReference}
                  required
                />
              </div>
              <div className="workspace-form-grid">
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
                <Input
                  label="Country / location of origin"
                  placeholder="Ghana"
                  value={origin}
                  onChange={setOrigin}
                  required
                />
              </div>
              <div className="workspace-form-grid">
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
              <div className="workspace-form-grid workspace-form-grid--quantity">
                <Input
                  label="Quantity"
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
                    { value: 'g', label: 'g' },
                    { value: 'litre', label: 'litre' },
                    { value: 'unit', label: 'unit' },
                  ]}
                />
              </div>
              <Input
                label="Allergen information"
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
              <Btn onClick={() => setStep(1)} full disabled={!isFormComplete}>
                Continue to review
              </Btn>
            </div>
          </Card>
        )}

        {step === 1 && (
          <div style={{ display: 'grid', gap: 16 }}>
            <HolderSigningKeyPanel />
            <Card>
              <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 16 }}>
                Review batch
              </div>
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

            {error && <Alert type="error" message={error} />}
            {complete && (
              <Alert
                type="success"
                message="The Ingredient Credential and ingredient batch are registered and verified on-chain."
              />
            )}

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
