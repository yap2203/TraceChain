import { T } from './tokens';

export function CustodyTimeline({
  steps,
}: {
  steps: {
    org: string;
    action: string;
    date: string;
    qty?: string;
    verified?: boolean;
    active?: boolean;
  }[];
}) {
  return (
    <div>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                flexShrink: 0,
                background: step.verified ? T.greenBg : step.active ? T.tealLight : T.surface2,
                border: `2px solid ${step.verified ? T.green : step.active ? T.teal : T.border2}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                color: step.verified ? T.green : step.active ? T.teal : T.text3,
              }}
            >
              {step.verified ? '✓' : step.active ? '●' : '○'}
            </div>
            {i < steps.length - 1 && (
              <div
                style={{
                  width: 2,
                  flex: 1,
                  background: step.verified ? T.green : T.border,
                  margin: '3px 0',
                  minHeight: 24,
                }}
              />
            )}
          </div>
          <div style={{ paddingBottom: 20, flex: 1, paddingTop: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: T.navy }}>{step.org}</div>
            <div style={{ fontSize: 12, color: T.text2, marginTop: 2 }}>{step.action}</div>
            {step.qty && (
              <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{step.qty}</div>
            )}
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{step.date}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
