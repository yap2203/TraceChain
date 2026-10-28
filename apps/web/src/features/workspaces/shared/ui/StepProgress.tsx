import { T } from './tokens';

export function StepProgress({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 32 }}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: done ? T.green : active ? T.teal : T.surface,
                  border: `2px solid ${done ? T.green : active ? T.teal : T.border2}`,
                  fontSize: 12,
                  fontWeight: 700,
                  color: done || active ? '#fff' : T.text3,
                  flexShrink: 0,
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: active ? T.teal : done ? T.green : T.text3,
                  fontWeight: active ? 600 : 400,
                  textAlign: 'center',
                  maxWidth: 80,
                }}
              >
                {label}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: done ? T.green : T.border,
                  margin: '0 4px',
                  marginBottom: 18,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
