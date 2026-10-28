import { T, MONO } from '../../shared/ui';
import { type TimelineEvent } from './types';

export function RequestTimeline({ events }: { events: TimelineEvent[] }) {
  const dot: Record<string, string> = {
    sent: T.teal,
    received: T.green,
    verified: T.teal,
    accepted: T.green,
    rejected: T.red,
    cancelled: T.grey,
  };
  return (
    <div>
      {events.map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: dot[e.type] ?? T.grey,
                flexShrink: 0,
                marginTop: 4,
              }}
            />
            {i < events.length - 1 && (
              <div style={{ width: 1, flex: 1, background: T.border, marginTop: 4 }} />
            )}
          </div>
          <div style={{ flex: 1, paddingBottom: 4 }}>
            <div style={{ fontSize: 12.5, color: T.text }}>{e.event}</div>
            <div style={{ fontSize: 10.5, color: T.text3, marginTop: 2, fontFamily: MONO }}>
              {e.date}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
