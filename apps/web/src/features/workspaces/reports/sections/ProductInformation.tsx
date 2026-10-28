import { T, Card } from '../../shared/ui';

export function ProductInformation() {
  return (
    <>
      {/* 1. Product Information */}
      <Card>
        <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 16 }}>
          1. Product Information
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {[
            { label: 'Product Name', value: 'Milk Chocolate' },
            { label: 'Product Batch ID', value: 'CHOCOLATE-2026-050' },
            { label: 'Production Date', value: '2026-08-01' },
            { label: 'Expiry Date', value: '2027-02-01' },
            { label: 'Quantity Produced', value: '500 units' },
            { label: 'Report Reference', value: 'AUD-2026-CHOC-050' },
          ].map((item) => (
            <div
              key={item.label}
              style={{ padding: '10px 14px', background: T.surface2, borderRadius: 8 }}
            >
              <div style={{ fontSize: 11, color: T.text2, marginBottom: 3 }}>{item.label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.navy }}>{item.value}</div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
