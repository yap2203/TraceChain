import { CheckCircle, Store, ClipboardList, Package } from 'lucide-react';
import { T, Btn, Card, StatCard, Badge, Alert } from '../shared/ui';
import { RETAIL_SHIPMENTS } from '../shared/custody-fixtures';

export function RetailerOverview({ onNav }: { onNav: (tab: string) => void }) {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <StatCard
          label="Incoming Shipments"
          value="1"
          color={T.amber}
          icon={<Package size={22} />}
          delta="1 to receive"
        />
        <StatCard
          label="Products in Stock"
          value="490"
          color={T.navy}
          icon={<Store size={22} />}
          delta="1 product type"
        />
        <StatCard
          label="Evidence Requests"
          value="1"
          color={T.grey}
          icon={<ClipboardList size={22} />}
        />
        <StatCard
          label="Verified Products"
          value="3"
          color={T.green}
          icon={<CheckCircle size={22} />}
        />
      </div>
      <Alert
        type="info"
        message="1 incoming shipment from Swift Distribution Sdn. Bhd. is ready for receipt — Milk Chocolate CHOCOLATE-2026-050, 490 units."
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
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy }}>Incoming Shipments</div>
            <Btn onClick={() => onNav('receive')} variant="outline" size="sm">
              View All
            </Btn>
          </div>
          {RETAIL_SHIPMENTS.map((s) => (
            <div key={s.id} style={{ padding: '12px 0', borderBottom: `1px solid ${T.border}` }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: T.navy }}>{s.product}</span>
                <Badge label="Awaiting Acceptance" variant="transfer-pending" />
              </div>
              <div style={{ fontSize: 11, color: T.text2 }}>
                {s.batch} · {s.qty} units · {s.sender.split(' ')[0]}
              </div>
              <div style={{ marginTop: 8 }}>
                <Btn onClick={() => onNav('receive')} size="xs">
                  Receive Now
                </Btn>
              </div>
            </div>
          ))}
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
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy }}>Quick Actions</div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <Btn onClick={() => onNav('scan')} variant="secondary" full>
              Scan & Verify QR
            </Btn>
            <Btn onClick={() => onNav('history')} variant="outline" full>
              Product History
            </Btn>
            <Btn onClick={() => onNav('evidence')} variant="outline" full>
              Evidence Requests
            </Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}
