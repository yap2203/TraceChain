import { useState } from 'react';
import { ScanLine } from 'lucide-react';
import { T, MONO, Btn, Card, Badge, Table, TR, TD, Modal, CustodyTimeline } from '../../shared/ui';
import { PRODUCT_BATCHES, BATCH_INGREDIENTS } from '../fixtures';

export function ProductBatchDetail({
  batchId,
  onBack,
  onTransfer,
}: {
  batchId: string;
  onBack: () => void;
  onTransfer: () => void;
}) {
  const product = PRODUCT_BATCHES.find((p) => p.id === batchId);
  const [showQR, setShowQR] = useState(false);
  const ingredients = BATCH_INGREDIENTS[batchId] ?? [];

  if (!product) return <div style={{ padding: 24, color: T.text2 }}>Batch not found.</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back to Batches
        </Btn>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 17, color: T.navy }}>{product.name}</span>
            <Badge label={product.status} variant={product.status} />
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.text2, marginTop: 2 }}>
            {product.id}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={() => setShowQR(true)} variant="secondary">
            Generate QR Code
          </Btn>
          <Btn onClick={onTransfer}>Transfer Product</Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Product Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              {[
                { label: 'Product Name', value: product.name },
                { label: 'Batch ID', value: product.id },
                { label: 'Production Date', value: product.produced },
                { label: 'Qty Produced', value: `${product.qty} units` },
                { label: 'Current Custodian', value: product.custodian },
                { label: 'Status', value: product.status },
              ].map((r) => (
                <div
                  key={r.label}
                  style={{ padding: '10px 0', borderBottom: `1px solid ${T.border}` }}
                >
                  <div style={{ fontSize: 11, color: T.text2, marginBottom: 3 }}>{r.label}</div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: T.navy,
                      fontFamily: r.label === 'Batch ID' ? MONO : undefined,
                    }}
                  >
                    {r.value}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Linked Ingredient Credentials
            </div>
            <Table headers={['Ingredient', 'Batch', 'Supplier', 'Credential ID', 'Verified']}>
              {ingredients.map((i) => (
                <TR key={i.credId}>
                  <TD bold>{i.name}</TD>
                  <TD mono muted>
                    {i.batch}
                  </TD>
                  <TD muted>{i.supplier}</TD>
                  <TD mono muted>
                    {i.credId}
                  </TD>
                  <TD>
                    <Badge label="Verified" variant="verified" />
                  </TD>
                </TR>
              ))}
            </Table>
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Transfer History
            </div>
            {product.custodian !== 'CocoaCraft Manufacturing' ? (
              <Table headers={['Transfer Ref', 'To', 'Qty', 'Date', 'Status']}>
                <TR>
                  <TD mono muted>
                    SHIP-2026-088
                  </TD>
                  <TD>Swift Distribution Sdn. Bhd.</TD>
                  <TD>500 units</TD>
                  <TD muted>2026-08-05</TD>
                  <TD>
                    <Badge label="accepted" variant="accepted" />
                  </TD>
                </TR>
              </Table>
            ) : (
              <div style={{ fontSize: 13, color: T.text3, padding: '12px 0' }}>
                No transfers yet.
              </div>
            )}
          </Card>
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              QR Code
            </div>
            <div
              style={{
                width: '100%',
                aspectRatio: '1',
                background: T.surface2,
                borderRadius: 10,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1px solid ${T.border}`,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  width: 100,
                  height: 100,
                  background: T.navyDark,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 8,
                }}
              >
                <ScanLine size={48} color={T.teal} />
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.text2 }}>{product.id}</div>
            </div>
            <div style={{ fontSize: 11, color: T.text3, marginBottom: 12 }}>
              The QR code contains a public product lookup reference. It does not contain private
              credential data.
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <Btn onClick={() => setShowQR(true)} full>
                Generate QR Code
              </Btn>
              <Btn variant="outline" full>
                Download QR Code
              </Btn>
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Custody Timeline
            </div>
            <CustodyTimeline
              steps={[
                {
                  org: 'CocoaCraft Manufacturing Sdn. Bhd.',
                  action: 'Product batch created',
                  date: product.produced,
                  qty: `${product.qty} units`,
                  verified: true,
                },
                ...(product.custodian !== 'CocoaCraft Manufacturing'
                  ? [
                      {
                        org: 'Swift Distribution Sdn. Bhd.',
                        action: 'Accepted custody',
                        date: '2026-08-09',
                        qty: '490 units',
                        verified: true,
                      },
                    ]
                  : [
                      {
                        org: 'Distributor',
                        action: 'Pending transfer',
                        date: '—',
                        verified: false,
                      },
                    ]),
              ]}
            />
          </Card>
        </div>
      </div>

      {showQR && (
        <Modal title="Product QR Code — CHOCOLATE-2026-050" onClose={() => setShowQR(false)}>
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div
              style={{
                width: 160,
                height: 160,
                background: T.navyDark,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}
            >
              <ScanLine size={80} color={T.teal} />
            </div>
            <div style={{ fontFamily: MONO, fontSize: 12, color: T.text2, marginBottom: 8 }}>
              {product.id}
            </div>
            <div style={{ fontSize: 12, color: T.text3, marginBottom: 20 }}>
              This QR code links to the public product record. Private credentials and ingredient
              details are not included.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <Btn variant="secondary">Download PNG</Btn>
              <Btn>Print QR Code</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
