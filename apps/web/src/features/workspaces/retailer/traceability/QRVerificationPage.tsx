import { useState } from 'react';
import { PackageCheck, Search, Camera } from 'lucide-react';
import {
  T,
  UI,
  MONO,
  Btn,
  Card,
  Badge,
  Table,
  TR,
  TD,
  HashChip,
  Alert,
  VerifyRow,
  CustodyTimeline,
} from '../../shared/ui';
import { PRODUCT_RECORDS } from '../../shared/custody-fixtures';

export function QRVerification({
  initialBatch,
  onBack,
}: {
  initialBatch?: string;
  onBack: () => void;
}) {
  type LookupState = 'idle' | 'searching' | 'found' | 'not_found' | 'error';
  const [lookupState, setLookupState] = useState<LookupState>(initialBatch ? 'found' : 'idle');
  const [manualId, setManualId] = useState(initialBatch ?? '');
  const [foundBatch, setFoundBatch] = useState(initialBatch ?? '');
  const [showTech, setShowTech] = useState(false);

  const search = () => {
    if (!manualId.trim()) return;
    setLookupState('searching');
    setTimeout(() => {
      if (PRODUCT_RECORDS[manualId.trim()]) {
        setFoundBatch(manualId.trim());
        setLookupState('found');
      } else setLookupState('not_found');
    }, 1200);
  };

  const product = PRODUCT_RECORDS[foundBatch];

  if (lookupState !== 'found' || !product) {
    return (
      <div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
          <Btn onClick={onBack} variant="ghost" size="sm">
            Back
          </Btn>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
            Scan & Verify Product
          </h2>
        </div>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 20 }}>
              Product Lookup
            </div>

            {/* QR camera area */}
            <div
              style={{
                border: `2px dashed ${T.border2}`,
                borderRadius: 12,
                padding: '32px 20px',
                textAlign: 'center',
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 12,
                  background: T.tealLight,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px',
                }}
              >
                <Camera size={26} color={T.teal} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.navy, marginBottom: 6 }}>
                Scan QR Code
              </div>
              <div style={{ fontSize: 12, color: T.text2, marginBottom: 16 }}>
                Point your camera at a TraceChain product QR code
              </div>
              <Btn variant="secondary" size="sm">
                Enable Camera
              </Btn>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1, height: 1, background: T.border }} />
              <span style={{ fontSize: 12, color: T.text3 }}>or enter manually</span>
              <div style={{ flex: 1, height: 1, background: T.border }} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: T.surface2,
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                }}
              >
                <Search size={14} color={T.text3} />
                <input
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && search()}
                  placeholder="Enter batch ID e.g. CHOCOLATE-2026-050"
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
              <Btn onClick={search} disabled={!manualId.trim()}>
                Search
              </Btn>
            </div>

            {lookupState === 'searching' && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '16px 0',
                  fontSize: 13,
                  color: T.text2,
                  marginTop: 14,
                }}
              >
                Searching blockchain records…
              </div>
            )}
            {lookupState === 'not_found' && (
              <Alert
                type="error"
                message={`No product record found for "${manualId}". Check the batch ID and try again.`}
              />
            )}
            {lookupState === 'error' && (
              <Alert
                type="warning"
                message="Unable to retrieve product records. Check your connection and try again."
              />
            )}

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, color: T.text3, marginBottom: 6 }}>
                Try a demo lookup:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.keys(PRODUCT_RECORDS).map((k) => (
                  <button
                    key={k}
                    onClick={() => {
                      setManualId(k);
                      setFoundBatch(k);
                      setLookupState('found');
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: `1px solid ${T.border}`,
                      background: T.surface2,
                      cursor: 'pointer',
                      fontFamily: MONO,
                      fontSize: 10,
                      color: T.teal,
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const overallLabel =
    product.status === 'verified'
      ? 'Traceability Checks Passed'
      : product.status === 'attention'
        ? 'Attention Required'
        : 'Verification Incomplete';
  const overallColor =
    product.status === 'verified' ? T.green : product.status === 'attention' ? T.amber : T.grey;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={() => setLookupState('idle')} variant="ghost" size="sm">
          New Scan
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          Product Traceability Verification
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 90,
                  height: 90,
                  background: `linear-gradient(135deg, #0A2240, #0C3060)`,
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <PackageCheck size={36} color={T.teal} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <div
                    style={{
                      padding: '4px 10px',
                      borderRadius: 20,
                      background: `${overallColor}20`,
                      border: `1px solid ${overallColor}40`,
                      fontSize: 11,
                      fontWeight: 700,
                      color: overallColor,
                    }}
                  >
                    {overallLabel}
                  </div>
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 700, color: T.navy, margin: '0 0 4px' }}>
                  {product.name}
                </h3>
                <div style={{ fontFamily: MONO, fontSize: 11, color: T.text2, marginBottom: 10 }}>
                  {product.batch}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[
                    { label: 'Manufacturer', value: product.manufacturer },
                    { label: 'Date Received', value: product.received },
                    { label: 'Expiry Date', value: product.expiry },
                    { label: 'Qty in Stock', value: `${product.qty} units` },
                  ].map((item) => (
                    <div key={item.label}>
                      <div style={{ fontSize: 10, color: T.text3, marginBottom: 1 }}>
                        {item.label}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: T.navy }}>
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Verification Summary
            </div>
            <div style={{ fontSize: 11, color: T.text3, marginBottom: 10 }}>
              Individual check results — these checks do not certify physical product quality.
            </div>
            <VerifyRow
              label="Company identity"
              result="All company identities verified"
              variant="verified"
            />
            <VerifyRow label="Credential status" result="All credentials active" variant="active" />
            <VerifyRow
              label="Product record"
              result={`${product.batch} found on blockchain`}
              variant="matched"
            />
            <VerifyRow
              label="Available integrity checks"
              result="Ingredient records unchanged"
              variant="matched"
            />
            <VerifyRow
              label="Recorded custody history"
              result={`${product.custodyStages} of 4 stages recorded`}
              variant="verified"
            />
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Ingredient Records
            </div>
            <Table headers={['Ingredient', 'Batch', 'Supplier', 'Credential', '']}>
              {product.ingredients.map((i) => (
                <TR key={i.batch}>
                  <TD bold>{i.name}</TD>
                  <TD mono muted>
                    {i.batch}
                  </TD>
                  <TD muted>{i.supplier}</TD>
                  <TD>
                    <Badge label="verified" variant="verified" />
                  </TD>
                  <TD>
                    <Btn variant="outline" size="xs">
                      Evidence
                    </Btn>
                  </TD>
                </TR>
              ))}
            </Table>
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Custody Timeline
            </div>
            <CustodyTimeline steps={product.custodyHistory} />
          </Card>

          <Card>
            <button
              onClick={() => setShowTech((v) => !v)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
                alignItems: 'center',
                fontFamily: UI,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 14, color: T.navy }}>
                Technical Details
              </span>
              <span style={{ color: T.teal, fontSize: 12 }}>{showTech ? 'Hide ▲' : 'Show ▼'}</span>
            </button>
            {showTech && (
              <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
                {[
                  { label: 'Product Batch ID', value: product.batch },
                  { label: 'Blockchain Tx Hash', value: '0x8f3a2b41c7e9d05f3a' },
                  { label: 'Manufacturer DID', value: 'did:ethr:0x7B82…44A1' },
                  { label: 'Distributor DID', value: 'did:ethr:0x5C91…19D4' },
                  { label: 'Retailer DID', value: 'did:ethr:0x2D18…73B2' },
                  { label: 'Block Number', value: '7,482,901' },
                  { label: 'Timestamp', value: '2026-08-09T09:14:33Z' },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      borderBottom: `1px solid ${T.border}`,
                    }}
                  >
                    <span style={{ fontSize: 11, color: T.text2 }}>{item.label}</span>
                    <HashChip value={item.value} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Btn variant="outline" full>
            Request Additional Evidence
          </Btn>
        </div>
      </div>
    </div>
  );
}
