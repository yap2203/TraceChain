import { PackageCheck, Layers, ArrowUpRight, CheckCircle } from 'lucide-react';
import { T, Btn, Card, StatCard, Badge, Alert } from '../shared/ui';
import { INCOMING_SHIPMENTS, DIST_INVENTORY } from '../shared/custody-fixtures';

export function DistributorOverview({ onNav }: { onNav: (tab: string) => void }) {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <StatCard
          label="Incoming Shipments"
          value="1"
          color={T.amber}
          icon={<PackageCheck size={22} />}
          delta="1 awaiting acceptance"
        />
        <StatCard
          label="Custody Inventory"
          value="2"
          color={T.navy}
          icon={<Layers size={22} />}
          delta="890 units available"
        />
        <StatCard
          label="Pending Transfers"
          value="1"
          color={T.grey}
          icon={<ArrowUpRight size={22} />}
        />
        <StatCard
          label="Completed Transfers"
          value="1"
          color={T.green}
          icon={<CheckCircle size={22} />}
          delta="This month"
        />
      </div>
      <Alert
        type="info"
        message="1 incoming shipment from CocoaCraft Manufacturing Sdn. Bhd. is awaiting your acceptance — Milk Chocolate CHOCOLATE-2026-050, 500 units."
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
            <Btn onClick={() => onNav('incoming')} variant="outline" size="sm">
              View All
            </Btn>
          </div>
          {INCOMING_SHIPMENTS.map((s) => (
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
                <Btn onClick={() => onNav('incoming')} size="xs">
                  Accept Shipment
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
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy }}>Custody Inventory</div>
            <Btn onClick={() => onNav('inventory')} variant="outline" size="sm">
              View All
            </Btn>
          </div>
          {DIST_INVENTORY.map((item) => (
            <div
              key={item.batch}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '11px 0',
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.navy }}>{item.name}</div>
                <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
                  {item.batch} · {item.available} units available
                </div>
              </div>
              <Btn onClick={() => onNav('transfers')} size="xs" variant="outline">
                Transfer
              </Btn>
            </div>
          ))}
          <div style={{ marginTop: 14 }}>
            <Btn onClick={() => onNav('transfers')} variant="secondary" full>
              Transfer to Retailer
            </Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}
