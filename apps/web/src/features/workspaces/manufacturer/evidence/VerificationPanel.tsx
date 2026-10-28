import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { T, Btn, Card, Alert } from '../../shared/ui';
import { type VerifyScenario, type CheckResult } from './types';
import { VERIFY_CHECKS } from './fixtures';

export function VerificationPanel({
  scenario,
  onAccept,
  onMissing,
  onReject,
  canAccept,
}: {
  scenario: VerifyScenario;
  onAccept: () => void;
  onMissing: () => void;
  onReject: () => void;
  canAccept: boolean;
}) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [checks, setChecks] = useState<CheckResult[]>(Array(6).fill('idle'));
  const [current, setCurrent] = useState(-1);

  const run = () => {
    setPhase('running');
    setChecks(Array(6).fill('idle'));
    setCurrent(0);
  };

  useEffect(() => {
    if (phase !== 'running' || current < 0) return;
    const t = setTimeout(() => {
      const pass: CheckResult =
        scenario === 'invalid'
          ? current < 2
            ? 'pass'
            : current === 2
              ? 'fail'
              : 'idle'
          : scenario === 'unavailable'
            ? current < 4
              ? 'pass'
              : current === 4
                ? 'fail'
                : 'idle'
            : scenario === 'incomplete'
              ? current < 5
                ? 'pass'
                : 'fail'
              : 'pass';
      setChecks((prev) => {
        const n = [...prev];
        n[current] = pass;
        return n;
      });
      if (pass === 'fail' || current === 5) {
        setPhase('done');
        setCurrent(-1);
      } else setCurrent((c) => c + 1);
    }, 600);
    return () => clearTimeout(t);
  }, [current, phase, scenario]);

  const outcome =
    scenario === 'success'
      ? 'passed'
      : scenario === 'incomplete'
        ? 'missing'
        : scenario === 'invalid'
          ? 'invalid'
          : 'unavailable';

  return (
    <Card>
      <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
        Verification
      </div>

      {phase === 'idle' && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 13, color: T.text2, marginBottom: 16 }}>
            Evidence has not been verified.
          </div>
          <Btn onClick={run}>Verify Evidence</Btn>
        </div>
      )}

      {(phase === 'running' || phase === 'done') && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          {VERIFY_CHECKS.map((label, i) => {
            const r = checks[i];
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: T.surface2,
                }}
              >
                <div style={{ flexShrink: 0 }}>
                  {r === 'idle' && (
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        border: `2px solid ${T.border2}`,
                      }}
                    />
                  )}
                  {r === 'pass' && <CheckCircle2 size={16} color={T.green} />}
                  {r === 'fail' && <XCircle size={16} color={T.red} />}
                  {r === 'pending' && (
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        border: `2px solid ${T.teal}`,
                        borderTopColor: 'transparent',
                        animation: 'workspace-spin 0.8s linear infinite',
                      }}
                    />
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: r === 'fail' ? T.red : r === 'pass' ? T.text : T.text3,
                  }}
                >
                  {label}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {phase === 'done' && (
        <div style={{ marginBottom: 16 }}>
          {outcome === 'passed' && (
            <Alert
              type="success"
              message="All required checks passed. Review the disclosed information before accepting it."
            />
          )}
          {outcome === 'missing' && (
            <Alert
              type="warning"
              message="The evidence is valid, but required information was not disclosed."
            />
          )}
          {outcome === 'invalid' && (
            <Alert
              type="error"
              message="The evidence failed verification. Review the failed checks."
            />
          )}
          {outcome === 'unavailable' && (
            <Alert
              type="warning"
              message="We could not complete verification. Try again or request the evidence again."
            />
          )}
        </div>
      )}

      {phase === 'done' && (outcome === 'passed' || outcome === 'missing') && (
        <div style={{ display: 'grid', gap: 8 }}>
          <Btn onClick={onAccept} full disabled={!canAccept}>
            Accept Ingredient Evidence
          </Btn>
          {!canAccept && (
            <div style={{ fontSize: 11, color: T.amber, textAlign: 'center' }}>
              Required information is missing — acceptance is not available.
            </div>
          )}
          <Btn onClick={onMissing} variant="secondary" full>
            Request Missing Information
          </Btn>
          <Btn onClick={onReject} variant="danger" full>
            Reject Evidence
          </Btn>
        </div>
      )}

      {phase === 'done' && (outcome === 'invalid' || outcome === 'unavailable') && (
        <div style={{ display: 'grid', gap: 8 }}>
          <Btn onClick={run} variant="secondary" full>
            Try Verification Again
          </Btn>
          <Btn onClick={onReject} variant="danger" full>
            Reject Evidence
          </Btn>
        </div>
      )}
    </Card>
  );
}
