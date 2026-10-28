import { useState } from 'react';
import {
  T,
  MONO,
  Btn,
  Card,
  Badge,
  Alert,
  TxModal,
  Input,
  Textarea,
  SelectField,
  CustodyTimeline,
} from '../../shared/ui';

export function TransferToDistributor({ onBack }: { onBack: () => void }) {
  const [qty, setQty] = useState('');
  const [date, setDate] = useState('');
  const [ref, setRef] = useState('');
  const [txState, setTx] = useState<'pending' | 'confirmed' | 'failed' | null>(null);

  const send = () => {
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
          Transfer Product to Distributor
        </h2>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
        <Card>
          <div style={{ display: 'grid', gap: 14 }}>
            <SelectField
              label="Product Batch"
              value="CHOCOLATE-2026-050"
              onChange={() => {}}
              options={[
                {
                  value: 'CHOCOLATE-2026-050',
                  label: 'Milk Chocolate — CHOCOLATE-2026-050 (500 units available)',
                },
              ]}
            />
            <div style={{ background: T.tealLight, borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.teal, marginBottom: 4 }}>
                Receiving Distributor — Verified
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, color: T.navy }}>
                Swift Distribution Sdn. Bhd.
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.teal, marginTop: 4 }}>
                did:ethr:0x5C91…19D4
              </div>
              <div style={{ marginTop: 6 }}>
                <Badge label="active" variant="active" />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Input
                label="Transfer Quantity"
                placeholder="500"
                value={qty}
                onChange={setQty}
                required
              />
              <Input label="Dispatch Date" type="date" value={date} onChange={setDate} required />
            </div>
            <Input
              label="Shipment Reference"
              placeholder="SHIP-2026-088"
              value={ref}
              onChange={setRef}
            />
            <Textarea
              label="Notes"
              value=""
              onChange={() => {}}
              placeholder="Shipping instructions, handling requirements…"
              rows={2}
            />
            <Alert
              type="warning"
              message="This transfer will be recorded on the blockchain. The distributor must accept custody before the transfer is complete."
            />
            <Btn onClick={send} full disabled={!qty || !date}>
              Submit Transfer
            </Btn>
          </div>
        </Card>
        <Card>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
            Transfer Summary
          </div>
          <CustodyTimeline
            steps={[
              {
                org: 'CocoaCraft Manufacturing Sdn. Bhd.',
                action: 'Product Batch Created',
                date: '2026-08-01',
                qty: '500 units',
                verified: true,
              },
              {
                org: 'Swift Distribution Sdn. Bhd.',
                action: 'Awaiting custody acceptance',
                date: 'Pending',
                active: true,
              },
            ]}
          />
        </Card>
      </div>
      <TxModal
        state={txState}
        title="Submitting Transfer"
        message="Transfer submitted. Swift Distribution Sdn. Bhd. must accept custody to complete the handoff."
        onClose={() => {
          setTx(null);
          onBack();
        }}
      />
    </div>
  );
}
