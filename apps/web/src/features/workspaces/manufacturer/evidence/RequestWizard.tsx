import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { T, UI, MONO, Btn, Card, Badge, Alert, StepProgress } from '../../shared/ui';
import { type ClaimReq, type EvidenceRequest } from './types';
import { SUPPLIERS, ALL_CLAIMS } from './fixtures';

export function RequestWizard({
  onBack,
  onSent,
}: {
  onBack: () => void;
  onSent: (req: EvidenceRequest) => void;
}) {
  const [step, setStep] = useState(0);
  const [suppId, setSuppId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [selectedClaims, setSelectedClaims] = useState<Record<string, ClaimReq | 'none'>>(() =>
    Object.fromEntries(ALL_CLAIMS.map((c) => [c.name, 'none'])),
  );
  const [reason, setReason] = useState('');
  const [dueDate, setDueDate] = useState('2026-09-07');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const supp = SUPPLIERS.find((s) => s.id === suppId);
  const batch = supp?.batches.find((b) => b.id === batchId);
  const chosenClaims = Object.entries(selectedClaims).filter(([, v]) => v !== 'none') as [
    string,
    ClaimReq,
  ][];

  const toggleClaim = (name: string) =>
    setSelectedClaims((prev) => ({
      ...prev,
      [name]: prev[name] === 'none' ? 'required' : prev[name] === 'required' ? 'optional' : 'none',
    }));

  const canSend = reason.trim().length > 0 && chosenClaims.length > 0 && dueDate.trim().length > 0;

  const send = () => {
    setSending(true);
    setTimeout(() => {
      const newReq: EvidenceRequest = {
        id: `REQ-2026-0${34 + Math.floor(Math.random() * 10)}`,
        supplier: supp!.name,
        supplierDid: supp!.batches[0] ? SUPPLIERS[0].did : '',
        ingredient: batch!.name,
        batch: batchId,
        requestDate: '2026-09-07',
        dueDate,
        status: 'awaiting',
        overdue: false,
        reason,
        claims: chosenClaims.map(([name, req]) => ({ name, req })),
        timeline: [
          {
            date:
              '2026-09-07 ' +
              new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            event: `Evidence request sent to ${supp!.name}`,
            type: 'sent',
          },
        ],
      };
      setSending(false);
      setSent(true);
      setTimeout(() => onSent(newReq), 1400);
    }, 1800);
  };

  const STEPS = ['Select Supplier & Batch', 'Select Information Required', 'Review & Send'];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          Request Ingredient Evidence
        </h2>
      </div>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <StepProgress steps={STEPS} current={step} />

        {/* Step 1 */}
        {step === 0 && (
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 16 }}>
              Select Supplier and Ingredient Batch
            </div>
            {SUPPLIERS.map((s) => (
              <div
                key={s.id}
                onClick={() => {
                  setSuppId(s.id);
                  setBatchId('');
                }}
                style={{
                  padding: 16,
                  borderRadius: 10,
                  marginBottom: 10,
                  cursor: 'pointer',
                  border: `2px solid ${suppId === s.id ? T.teal : T.border}`,
                  background: suppId === s.id ? T.tealLight : T.surface,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: T.text }}>{s.name}</div>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.teal, marginTop: 2 }}>
                      {s.did}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: T.text3, marginBottom: 3 }}>
                      Role Credential
                    </div>
                    <Badge label={s.credStatus} variant={s.credStatus} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, fontSize: 11, color: T.green }}>
                  <CheckCircle2 size={12} style={{ marginTop: 1 }} />
                  Supplier identity verified · DID resolved
                </div>
              </div>
            ))}

            {suppId && supp && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.navy, marginBottom: 8 }}>
                  Select Ingredient Batch
                </div>
                {supp.batches.map((b) => (
                  <div
                    key={b.id}
                    onClick={() => setBatchId(b.id)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      borderRadius: 8,
                      marginBottom: 6,
                      cursor: 'pointer',
                      border: `1.5px solid ${batchId === b.id ? T.teal : T.border}`,
                      background: batchId === b.id ? T.tealLight : T.surface2,
                    }}
                  >
                    <div style={{ fontSize: 13, color: T.text }}>{b.name}</div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: T.text2 }}>{b.id}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 20 }}>
              <Btn onClick={() => setStep(1)} full disabled={!suppId || !batchId}>
                Continue
              </Btn>
            </div>
          </Card>
        )}

        {/* Step 2 */}
        {step === 1 && (
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 6 }}>
              Select Information Required
            </div>
            <div style={{ fontSize: 13, color: T.text2, marginBottom: 16, lineHeight: 1.6 }}>
              Required information must be provided before you can accept this evidence. The
              supplier decides which information to share. Click once to mark Required, again for
              Optional, again to deselect.
            </div>
            <div style={{ display: 'grid', gap: 6, marginBottom: 20 }}>
              {ALL_CLAIMS.map((c) => {
                const sel = selectedClaims[c.name];
                return (
                  <div
                    key={c.name}
                    onClick={() => toggleClaim(c.name)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'all 0.12s',
                      border: `1.5px solid ${sel !== 'none' ? T.teal : T.border}`,
                      background: sel !== 'none' ? T.tealLight : T.surface2,
                    }}
                  >
                    <span style={{ fontSize: 13, color: T.text }}>{c.name}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 5,
                        background:
                          sel === 'required' ? T.amber : sel === 'optional' ? T.tealMid : T.surface,
                        color:
                          sel === 'required' ? T.navyDark : sel === 'optional' ? T.teal : T.text3,
                      }}
                    >
                      {sel === 'none'
                        ? 'Not selected'
                        : sel === 'required'
                          ? 'Required'
                          : 'Optional'}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={() => setStep(0)} variant="ghost">
                Back
              </Btn>
              <Btn onClick={() => setStep(2)} full disabled={chosenClaims.length === 0}>
                Continue
              </Btn>
            </div>
          </Card>
        )}

        {/* Step 3 */}
        {step === 2 && (
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 16 }}>
              Review and Send
            </div>
            <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
              {[
                { label: 'Requesting Manufacturer', value: 'CocoaCraft Manufacturing Sdn. Bhd.' },
                { label: 'Receiving Supplier', value: supp?.name ?? '' },
                { label: 'Ingredient', value: batch?.name ?? '' },
                { label: 'Batch Reference', value: batchId },
              ].map((r) => (
                <div
                  key={r.label}
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: '8px 0',
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  <div style={{ fontSize: 12, color: T.text3, width: 180, flexShrink: 0 }}>
                    {r.label}
                  </div>
                  <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>{r.value}</div>
                </div>
              ))}

              <div style={{ padding: '8px 0' }}>
                <div style={{ fontSize: 12, color: T.text3, marginBottom: 8 }}>Required Claims</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {chosenClaims
                    .filter(([, r]) => r === 'required')
                    .map(([n]) => (
                      <span
                        key={n}
                        style={{
                          fontSize: 11,
                          padding: '3px 9px',
                          borderRadius: 12,
                          background: T.amberBg,
                          border: `1px solid color-mix(in srgb, ${T.amber} 19%, transparent)`,
                          color: T.amber,
                        }}
                      >
                        {n}
                      </span>
                    ))}
                  {chosenClaims.filter(([, r]) => r === 'required').length === 0 && (
                    <span style={{ fontSize: 12, color: T.text3 }}>None selected</span>
                  )}
                </div>
              </div>
              <div style={{ padding: '8px 0' }}>
                <div style={{ fontSize: 12, color: T.text3, marginBottom: 8 }}>Optional Claims</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {chosenClaims
                    .filter(([, r]) => r === 'optional')
                    .map(([n]) => (
                      <span
                        key={n}
                        style={{
                          fontSize: 11,
                          padding: '3px 9px',
                          borderRadius: 12,
                          background: T.tealLight,
                          border: `1px solid color-mix(in srgb, ${T.teal} 19%, transparent)`,
                          color: T.teal,
                        }}
                      >
                        {n}
                      </span>
                    ))}
                  {chosenClaims.filter(([, r]) => r === 'optional').length === 0 && (
                    <span style={{ fontSize: 12, color: T.text3 }}>None</span>
                  )}
                </div>
              </div>
            </div>

            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}
            >
              <div>
                <div style={{ fontSize: 12, color: T.text2, fontWeight: 500, marginBottom: 6 }}>
                  Reason for Request <span style={{ color: T.red }}>*</span>
                </div>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain why you need this evidence…"
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: `1px solid ${T.border}`,
                    background: T.surface2,
                    color: T.text,
                    fontSize: 12,
                    fontFamily: UI,
                    resize: 'vertical',
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: T.text2, fontWeight: 500, marginBottom: 6 }}>
                  Response Due Date <span style={{ color: T.red }}>*</span>
                </div>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: `1px solid ${T.border}`,
                    background: T.surface2,
                    color: T.text,
                    fontSize: 12,
                    fontFamily: UI,
                  }}
                />
              </div>
            </div>

            {sent && <Alert type="success" message={`Evidence request sent to ${supp?.name}.`} />}
            {sending && !sent && (
              <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 13, color: T.text2 }}>
                Sending evidence request…
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <Btn onClick={() => setStep(1)} variant="ghost" disabled={sending}>
                Back
              </Btn>
              <Btn onClick={send} full disabled={!canSend || sending || sent}>
                Send Evidence Request
              </Btn>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
