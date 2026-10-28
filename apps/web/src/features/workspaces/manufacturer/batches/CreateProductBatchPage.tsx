import { useState } from 'react';
import {
  T,
  Btn,
  Card,
  Badge,
  Table,
  TR,
  TD,
  HashChip,
  Alert,
  TxModal,
  StepProgress,
  Input,
  SelectField,
} from '../../shared/ui';
import { INGREDIENT_CREDS } from '../fixtures';

export function CreateProductBatch({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [txState, setTx] = useState<'pending' | 'confirmed' | 'failed' | null>(null);

  const STEPS = [
    'Product Details',
    'Select Ingredients',
    'Review Ingredient Links',
    'Blockchain Info',
    'Confirm',
  ];
  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          Create Product Batch
        </h2>
      </div>
      <div style={{ maxWidth: 720 }}>
        <StepProgress steps={STEPS} current={step} />

        {step === 0 && (
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 20 }}>
              Product Details
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Input
                  label="Product Name"
                  placeholder="Milk Chocolate"
                  value="Milk Chocolate"
                  onChange={() => {}}
                  required
                />
                <Input
                  label="Product Batch Number"
                  placeholder="CHOCOLATE-2026-050"
                  value="CHOCOLATE-2026-050"
                  onChange={() => {}}
                  required
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <SelectField
                  label="Product Category"
                  value="chocolate"
                  onChange={() => {}}
                  options={[{ value: 'chocolate', label: 'Chocolate & Confectionery' }]}
                />
                <Input
                  label="Quantity Produced"
                  placeholder="500"
                  value="500"
                  onChange={() => {}}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Input
                  label="Production Date"
                  type="date"
                  value="2026-08-01"
                  onChange={() => {}}
                  required
                />
                <Input
                  label="Expiry Date"
                  type="date"
                  value="2027-02-01"
                  onChange={() => {}}
                  required
                />
              </div>
              <Btn onClick={() => setStep(1)} full>
                Continue
              </Btn>
            </div>
          </Card>
        )}

        {step === 1 && (
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 6 }}>
              Select Verified Ingredients
            </div>
            <div style={{ fontSize: 13, color: T.text2, marginBottom: 16 }}>
              Only active, verified ingredient credentials can be selected.
            </div>
            <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
              {INGREDIENT_CREDS.map((ic) => (
                <div
                  key={ic.id}
                  onClick={() => toggle(ic.id)}
                  style={{
                    padding: '14px 16px',
                    borderRadius: 10,
                    border: `2px solid ${selected.includes(ic.id) ? T.teal : T.border}`,
                    background: selected.includes(ic.id) ? T.tealLight : T.surface,
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: T.navy }}>{ic.name}</div>
                      <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
                        {ic.batch} · {ic.supplier}
                      </div>
                      <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>
                        Expires: {ic.expires}
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: 5,
                      }}
                    >
                      <Badge label="Verified" variant="verified" />
                      <Badge label="Active" variant="active" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={() => setStep(0)} variant="outline" style={{ flex: 1 }}>
                Back
              </Btn>
              <Btn onClick={() => setStep(2)} disabled={selected.length === 0} style={{ flex: 2 }}>
                Continue ({selected.length} selected)
              </Btn>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 16 }}>
              Review Ingredient Links
            </div>
            <Table headers={['Ingredient', 'Batch ID', 'Supplier', 'Credential Hash', 'Verified']}>
              {INGREDIENT_CREDS.filter((ic) => selected.includes(ic.id)).map((ic) => (
                <TR key={ic.id}>
                  <TD bold>{ic.name}</TD>
                  <TD mono muted>
                    {ic.batch}
                  </TD>
                  <TD muted>{ic.supplier.split(' ')[0]}</TD>
                  <TD>
                    <HashChip value={`0x${ic.id.replace(/-/g, '').slice(0, 20)}`} />
                  </TD>
                  <TD>
                    <Badge label="Verified" variant="verified" />
                  </TD>
                </TR>
              ))}
            </Table>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <Btn onClick={() => setStep(1)} variant="outline" style={{ flex: 1 }}>
                Back
              </Btn>
              <Btn onClick={() => setStep(3)} style={{ flex: 2 }}>
                Continue
              </Btn>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 16 }}>
              Blockchain Information
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ background: T.surface2, borderRadius: 10, padding: '16px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.navy, marginBottom: 10 }}>
                  Stored on Blockchain
                </div>
                {[
                  'Product batch ID: CHOCOLATE-2026-050',
                  'Product name: Milk Chocolate',
                  'Manufacturer reference: CocoaCraft',
                  'Public ingredient summary',
                  'Ingredient batch references',
                  'Credential hashes (3)',
                  'Creation timestamp',
                ].map((item) => (
                  <div
                    key={item}
                    style={{
                      fontSize: 12,
                      color: T.text2,
                      padding: '4px 0',
                      borderBottom: `1px solid ${T.border}`,
                    }}
                  >
                    ✓ {item}
                  </div>
                ))}
              </div>
              <div
                style={{ background: 'rgba(139,92,246,0.1)', borderRadius: 10, padding: '16px' }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: T.teal, marginBottom: 10 }}>
                  Stored in Credential Wallet
                </div>
                {[
                  'Complete Ingredient Credentials',
                  'Selectively disclosed claims',
                  'Private supporting documents',
                  'Internal QA data',
                ].map((item) => (
                  <div
                    key={item}
                    style={{
                      fontSize: 12,
                      color: T.teal,
                      padding: '4px 0',
                      borderBottom: `1px solid ${T.border}`,
                    }}
                  >
                    · {item}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <Btn onClick={() => setStep(2)} variant="outline" style={{ flex: 1 }}>
                Back
              </Btn>
              <Btn onClick={() => setStep(4)} style={{ flex: 2 }}>
                Continue
              </Btn>
            </div>
          </Card>
        )}

        {step === 4 && (
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 16 }}>
              Confirm Registration
            </div>
            <div
              style={{
                background: T.surface2,
                borderRadius: 10,
                padding: '16px',
                marginBottom: 16,
              }}
            >
              {[
                { label: 'Product', value: 'Milk Chocolate' },
                { label: 'Batch ID', value: 'CHOCOLATE-2026-050' },
                { label: 'Quantity', value: '500 units' },
                { label: 'Ingredients', value: `${selected.length} linked ingredient credentials` },
              ].map((row) => (
                <div
                  key={row.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 0',
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  <span style={{ fontSize: 12, color: T.text2 }}>{row.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.navy }}>{row.value}</span>
                </div>
              ))}
            </div>
            <Alert
              type="info"
              message="Registering this product batch will write an immutable record to the blockchain, linking all selected ingredient credential hashes."
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <Btn onClick={() => setStep(3)} variant="outline" style={{ flex: 1 }}>
                Back
              </Btn>
              <Btn
                onClick={() => {
                  setTx('pending');
                  setTimeout(() => setTx('confirmed'), 3500);
                }}
                style={{ flex: 2 }}
              >
                Confirm & Sign
              </Btn>
            </div>
          </Card>
        )}
      </div>
      <TxModal
        state={txState}
        title="Registering Product Batch"
        message="Product Batch CHOCOLATE-2026-050 registered successfully. Generate a QR code to track custody."
        onClose={() => {
          setTx(null);
          onBack();
        }}
      />
    </div>
  );
}
