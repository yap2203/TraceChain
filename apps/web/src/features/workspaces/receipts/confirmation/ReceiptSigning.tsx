import { CheckCircle2 } from 'lucide-react';
import { T, Card, StepProgress } from '../../shared/ui';
import { RECEIPT_STEPS } from '../fixtures';

export function ReceiptSigning({
  showProgress,
  sigState,
}: {
  showProgress: boolean | undefined;
  sigState: 'idle' | 'waiting_sig' | 'submitted' | 'confirming' | 'done';
}) {
  return (
    <>
      <div style={{ maxWidth: 440, margin: '0 auto' }}>
        {showProgress && <StepProgress steps={RECEIPT_STEPS} current={3} />}
        <Card>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 20 }}>
            Signing Receipt
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {[
              { label: 'Waiting for wallet signature', state: 'waiting_sig' },
              { label: 'Transaction submitted', state: 'submitted' },
              { label: 'Waiting for blockchain confirmation', state: 'confirming' },
              { label: 'Receipt confirmed', state: 'done' },
            ].map((s, i) => {
              const states = ['idle', 'waiting_sig', 'submitted', 'confirming', 'done'];
              const si = states.indexOf(sigState);
              const ti = states.indexOf(s.state);
              const done = si > ti;
              const active = si === ti;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: done ? T.greenBg : active ? T.tealLight : T.surface2,
                  }}
                >
                  {done && <CheckCircle2 size={16} color={T.green} />}
                  {active && (
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        border: `2px solid ${T.teal}`,
                        borderTopColor: 'transparent',
                        animation: 'workspace-spin 0.8s linear infinite',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  {!done && !active && (
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        border: `2px solid ${T.border2}`,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span style={{ fontSize: 13, color: done ? T.green : active ? T.navy : T.text3 }}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 16, fontSize: 12, color: T.text2, textAlign: 'center' }}>
            Do not close this screen until confirmation is received.
          </div>
        </Card>
      </div>
    </>
  );
}
