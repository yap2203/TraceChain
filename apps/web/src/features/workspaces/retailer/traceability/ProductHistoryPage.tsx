import { useState } from 'react';
import { CheckCircle, History, Package, Clock, Search } from 'lucide-react';
import { T, UI, Btn, Card, StatCard, Badge, Table, TR, TD } from '../../shared/ui';
import { HISTORY_LIST } from './fixtures';

export function ProductHistory({ onView }: { onView: (batch: string) => void }) {
  const [search, setSearch] = useState('');
  const filtered = HISTORY_LIST.filter((p) => {
    const q = search.toLowerCase();
    return (
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.batch.toLowerCase().includes(q) ||
      p.manufacturer.toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.navy, margin: '0 0 4px' }}>
            Product History
          </h1>
          <p style={{ fontSize: 13, color: T.text2, margin: 0 }}>
            All products received with full traceability records.
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 12px',
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            width: 260,
          }}
        >
          <Search size={14} color={T.text3} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product or batch…"
            style={{
              border: 'none',
              background: 'none',
              color: T.text,
              fontSize: 13,
              outline: 'none',
              flex: 1,
              fontFamily: UI,
            }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <StatCard label="Total Products" value="3" color={T.navy} icon={<History size={22} />} />
        <StatCard
          label="Verified"
          value="3"
          color={T.green}
          icon={<CheckCircle size={22} />}
          delta="All credentials valid"
        />
        <StatCard
          label="Total Units Received"
          value="1,090"
          color={T.teal}
          icon={<Package size={22} />}
        />
        <StatCard label="Expiring in 90 days" value="0" color={T.grey} icon={<Clock size={22} />} />
      </div>

      <Card padding="0">
        <Table
          headers={[
            'Batch ID',
            'Product Name',
            'Manufacturer',
            'Date Received',
            'Qty',
            'Expiry',
            'Custody',
            'Ingredients',
            'Status',
            '',
          ]}
        >
          {filtered.map((p) => (
            <TR key={p.batch} onClick={() => onView(p.batch)}>
              <TD mono muted>
                {p.batch}
              </TD>
              <TD bold>{p.name}</TD>
              <TD muted>{p.manufacturer}</TD>
              <TD muted>{p.received}</TD>
              <TD>{p.qty} units</TD>
              <TD muted>{p.expiry}</TD>
              <TD>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: i < p.custodyStages ? T.teal : T.border,
                        }}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: 11, color: T.text2 }}>{p.custodyStages}/4</span>
                </div>
              </TD>
              <TD>
                <Badge label={`${p.ingredientCreds} verified`} variant="verified" />
              </TD>
              <TD>
                <Badge label={p.status} variant={p.status} />
              </TD>
              <TD>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn onClick={() => onView(p.batch)} variant="outline" size="xs">
                    History
                  </Btn>
                  <Btn onClick={() => onView(p.batch)} variant="secondary" size="xs">
                    Verify
                  </Btn>
                </div>
              </TD>
            </TR>
          ))}
        </Table>
      </Card>
    </div>
  );
}
