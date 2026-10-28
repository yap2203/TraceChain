import { Layers, BadgeCheck, Inbox, Clock } from 'lucide-react';
import { T, Btn, Card, StatCard, Badge, Alert } from '../shared/ui';
import { BATCHES, REQUESTS } from './fixtures';

export function SupplierOverview({ onNav }: { onNav: (tab: string) => void }) {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <StatCard
          label="Active Ingredient Batches"
          value="3"
          color={T.green}
          icon={<Layers size={22} />}
        />
        <StatCard
          label="Credentials Issued"
          value="3"
          color={T.teal}
          icon={<BadgeCheck size={22} />}
        />
        <StatCard
          label="Pending Info Requests"
          value="1"
          color={T.amber}
          icon={<Inbox size={22} />}
          delta="Due 2026-08-15"
        />
        <StatCard label="Expiring Soon" value="0" color={T.grey} icon={<Clock size={22} />} />
      </div>

      {/* Pending requests alert */}
      <Alert
        type="warning"
        message="1 information request from CocoaCraft Manufacturing Sdn. Bhd. is due on 2026-08-15. Review and share the required evidence."
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Card>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy }}>
              My Ingredient Batches
            </div>
            <Btn onClick={() => onNav('batches')} variant="outline" size="sm">
              View All
            </Btn>
          </div>
          {BATCHES.map((b) => (
            <div
              key={b.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '11px 0',
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.navy }}>{b.name}</div>
                <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
                  {b.id} · {b.qty} · {b.origin}
                </div>
              </div>
              <Badge label={b.status} variant={b.status} />
            </div>
          ))}
          <div style={{ marginTop: 14 }}>
            <Btn onClick={() => onNav('batches-new')} full>
              + Register Ingredient Batch
            </Btn>
          </div>
        </Card>

        <Card>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy }}>Information Requests</div>
            <Btn onClick={() => onNav('requests')} variant="outline" size="sm">
              View All
            </Btn>
          </div>
          {REQUESTS.map((r) => (
            <div key={r.id} style={{ padding: '12px 0', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: T.navy }}>
                  {r.from.split(' ')[0]}
                </span>
                <Badge label={r.status} variant={r.status} />
              </div>
              <div style={{ fontSize: 11, color: T.text2 }}>
                {r.ingredient} · Due {r.due}
              </div>
              {r.status === 'pending' && (
                <div style={{ marginTop: 8 }}>
                  <Btn onClick={() => onNav('requests')} size="xs">
                    Respond Now
                  </Btn>
                </div>
              )}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
