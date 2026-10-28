import { Package, TrendingUp, CheckCircle, ArrowUpRight } from 'lucide-react';
import { T, Btn, Card, StatCard, Badge } from '../shared/ui';
import { INGREDIENT_CREDS, PRODUCT_BATCHES } from './fixtures';

export function ManufacturerOverview({ onNav }: { onNav: (tab: string) => void }) {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <StatCard label="Product Batches" value="2" color={T.navy} icon={<Package size={22} />} />
        <StatCard
          label="Created This Month"
          value="1"
          color={T.teal}
          icon={<TrendingUp size={22} />}
          delta="+1 from last month"
        />
        <StatCard
          label="Verified Ingredients"
          value="3"
          color={T.green}
          icon={<CheckCircle size={22} />}
        />
        <StatCard
          label="Pending Transfers"
          value="0"
          color={T.grey}
          icon={<ArrowUpRight size={22} />}
        />
      </div>

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
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy }}>Product Batches</div>
            <Btn onClick={() => onNav('products')} variant="outline" size="sm">
              View All
            </Btn>
          </div>
          {PRODUCT_BATCHES.map((p) => (
            <div key={p.id} style={{ padding: '12px 0', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.navy }}>{p.name}</span>
                <Badge label={p.status} variant={p.status} />
              </div>
              <div style={{ fontSize: 11, color: T.text2 }}>
                {p.id} · {p.qty} units · {p.ingredients} ingredients
              </div>
            </div>
          ))}
          <div style={{ marginTop: 14 }}>
            <Btn onClick={() => onNav('products-new')} full>
              + Create Product Batch
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
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy }}>
              Verified Ingredient Credentials
            </div>
            <Btn onClick={() => onNav('evidence')} variant="outline" size="sm">
              View All
            </Btn>
          </div>
          {INGREDIENT_CREDS.map((ic) => (
            <div
              key={ic.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.navy }}>{ic.name}</div>
                <div style={{ fontSize: 11, color: T.text2 }}>
                  {ic.batch} · {ic.supplier.split(' ')[0]}
                </div>
              </div>
              <Badge label="Verified" variant="verified" />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
