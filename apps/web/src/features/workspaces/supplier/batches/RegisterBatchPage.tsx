import { useState } from 'react';
import {
  T,
  Btn,
  Card,
  Alert,
  TxModal,
  StepProgress,
  Input,
  SelectField,
  ClaimRow,
} from '../../shared/ui';

export function RegisterBatch({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [batchNum, setBatch] = useState('');
  const [category, setCat] = useState('cocoa');
  const [origin, setOrigin] = useState('');
  const [produced, setProd] = useState('');
  const [expires, setExpires] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('kg');
  const [allergen, setAllergen] = useState('');
  const [cert, setCert] = useState('');
  const [txState, setTx] = useState<'pending' | 'confirmed' | 'failed' | null>(null);

  type DiscLevel = 'public' | 'restricted' | 'confidential';
  const [disclosure, setDisclosure] = useState<Record<string, DiscLevel>>({
    name: 'public',
    batchNum: 'public',
    origin: 'public',
    produced: 'public',
    expires: 'public',
    qty: 'restricted',
    allergen: 'public',
    cert: 'public',
    quality: 'confidential',
    price: 'confidential',
  });
  const toggleDisc = (key: string) => {
    const order: DiscLevel[] = ['public', 'restricted', 'confidential'];
    const cur = disclosure[key];
    const next = order[(order.indexOf(cur) + 1) % 3];
    setDisclosure((d) => ({ ...d, [key]: next }));
  };

  const STEPS = ['Ingredient Info', 'Review & Issue'];

  const confirm = () => {
    setTx('pending');
    setTimeout(() => setTx('confirmed'), 3000);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          Register Ingredient Batch
        </h2>
      </div>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <StepProgress steps={STEPS} current={step} />

        {step === 0 && (
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 20 }}>
              Ingredient Information
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Input
                  label="Ingredient Name"
                  placeholder="Cocoa Powder"
                  value={name}
                  onChange={setName}
                  required
                />
                <Input
                  label="Batch Number"
                  placeholder="COCOA-2026-001"
                  value={batchNum}
                  onChange={setBatch}
                  required
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <SelectField
                  label="Category"
                  value={category}
                  onChange={setCat}
                  options={[
                    { value: 'cocoa', label: 'Cocoa & Chocolate' },
                    { value: 'dairy', label: 'Dairy Products' },
                    { value: 'sugar', label: 'Sugar & Sweeteners' },
                    { value: 'grain', label: 'Grains & Flours' },
                    { value: 'other', label: 'Other' },
                  ]}
                />
                <Input
                  label="Country / Location of Origin"
                  placeholder="Ghana"
                  value={origin}
                  onChange={setOrigin}
                  required
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Input
                  label="Production Date"
                  type="date"
                  value={produced}
                  onChange={setProd}
                  required
                />
                <Input
                  label="Expiry Date"
                  type="date"
                  value={expires}
                  onChange={setExpires}
                  required
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
                <Input label="Quantity" placeholder="500" value={qty} onChange={setQty} required />
                <SelectField
                  label="Unit"
                  value={unit}
                  onChange={setUnit}
                  options={[
                    { value: 'kg', label: 'Kilograms (kg)' },
                    { value: 'L', label: 'Litres (L)' },
                    { value: 'units', label: 'Units' },
                  ]}
                />
              </div>
              <Input
                label="Allergen Information"
                placeholder="None / Dairy / Nuts / Gluten…"
                value={allergen}
                onChange={setAllergen}
              />
              <Input
                label="Certifications"
                placeholder="Organic, Halal, Fair Trade, ISO 22000…"
                value={cert}
                onChange={setCert}
                hint="Enter all applicable certifications separated by commas"
              />

              <Btn onClick={() => setStep(1)} full disabled={!name || !batchNum || !origin}>
                Continue to Review
              </Btn>
            </div>
          </Card>
        )}

        {step === 1 && (
          <div style={{ display: 'grid', gap: 16 }}>
            <Card>
              <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 6 }}>
                Review & Set Disclosure Levels
              </div>
              <div style={{ fontSize: 13, color: T.text2, marginBottom: 16 }}>
                Choose which information will be shared publicly, restricted to verified parties, or
                kept confidential.
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {[
                  { key: 'name', label: 'Ingredient Name', value: name || 'Cocoa Powder' },
                  { key: 'batchNum', label: 'Batch Number', value: batchNum || 'COCOA-2026-001' },
                  { key: 'origin', label: 'Origin', value: origin || 'Ghana' },
                  { key: 'produced', label: 'Production Date', value: produced || '2026-04-15' },
                  { key: 'expires', label: 'Expiry Date', value: expires || '2027-04-15' },
                  { key: 'qty', label: 'Quantity', value: `${qty || '500'} ${unit}` },
                  { key: 'allergen', label: 'Allergen Information', value: allergen || 'None' },
                  { key: 'cert', label: 'Certifications', value: cert || 'Organic, Fair Trade' },
                  {
                    key: 'quality',
                    label: 'Quality Test Results',
                    value: 'Internal QA Report — Batch A1',
                  },
                  { key: 'price', label: 'Purchase Price', value: 'MYR 12.50 / kg' },
                ].map((item) => (
                  <ClaimRow
                    key={item.key}
                    label={item.label}
                    value={item.value}
                    sensitivity={disclosure[item.key] as any}
                    included={disclosure[item.key] !== 'confidential'}
                    onToggle={() => toggleDisc(item.key)}
                  />
                ))}
              </div>
            </Card>

            <Alert
              type="info"
              message="Confidential information will never be shared with other parties. Only the cryptographic hash will be recorded on the blockchain."
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={() => setStep(0)} variant="outline" style={{ flex: 1 }}>
                Back
              </Btn>
              <Btn onClick={confirm} style={{ flex: 2 }}>
                Issue Ingredient Credential
              </Btn>
            </div>
          </div>
        )}
      </div>

      <TxModal
        state={txState}
        title="Issuing Ingredient Credential"
        message="Ingredient Credential issued successfully. The cryptographic hash has been recorded on the blockchain."
        onClose={() => {
          setTx(null);
          onBack();
        }}
      />
    </div>
  );
}
