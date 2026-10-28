import { useState } from 'react';
import { T, MONO, Btn, Card, Badge, Alert, Modal, TxModal, ClaimRow } from '../../shared/ui';
import { REQUESTS } from '../fixtures';

export function SelectiveDisclosure({
  request,
  onBack,
}: {
  request: (typeof REQUESTS)[0];
  onBack: () => void;
}) {
  const ALL_CLAIMS = [
    {
      key: 'name',
      label: 'Ingredient Name',
      value: 'Cocoa Powder',
      sensitivity: 'public' as const,
      included: true,
    },
    {
      key: 'batch',
      label: 'Batch Number',
      value: 'COCOA-2026-001',
      sensitivity: 'public' as const,
      included: true,
    },
    {
      key: 'origin',
      label: 'Origin',
      value: 'Ghana',
      sensitivity: 'public' as const,
      included: true,
    },
    {
      key: 'produced',
      label: 'Production Date',
      value: '2026-04-15',
      sensitivity: 'restricted' as const,
      included: false,
    },
    {
      key: 'expires',
      label: 'Expiry Date',
      value: '2027-04-15',
      sensitivity: 'public' as const,
      included: true,
    },
    {
      key: 'allergen',
      label: 'Allergen Status',
      value: 'None',
      sensitivity: 'public' as const,
      included: true,
    },
    {
      key: 'cert',
      label: 'Certification Status',
      value: 'Organic, Fair Trade',
      sensitivity: 'restricted' as const,
      included: false,
    },
    {
      key: 'price',
      label: 'Purchase Price',
      value: 'MYR 12.50 / kg',
      sensitivity: 'confidential' as const,
      included: false,
    },
    {
      key: 'contract',
      label: 'Contract Number',
      value: 'CTR-2026-007',
      sensitivity: 'confidential' as const,
      included: false,
    },
  ];
  const [claims, setClaims] = useState(ALL_CLAIMS);
  const [showPreview, setShowPreview] = useState(false);
  const [txState, setTx] = useState<'pending' | 'confirmed' | 'failed' | null>(null);

  const toggle = (key: string) =>
    setClaims((prev) => prev.map((c) => (c.key === key ? { ...c, included: !c.included } : c)));
  const shared = claims.filter((c) => c.included);
  const hidden = claims.filter((c) => !c.included);

  const approve = () => {
    setShowPreview(false);
    setTx('pending');
    setTimeout(() => setTx('confirmed'), 3000);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          Respond to Evidence Request
        </h2>
        <Badge label="pending" variant="pending" />
      </div>

      {/* Request details */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Request Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              {[
                { label: 'Request ID', value: request.id },
                { label: 'Requester', value: request.from },
                { label: 'Ingredient', value: request.ingredient },
                { label: 'Due Date', value: request.due },
              ].map((row) => (
                <div
                  key={row.label}
                  style={{ padding: '10px 0', borderBottom: `1px solid ${T.border}` }}
                >
                  <div style={{ fontSize: 11, color: T.text2, marginBottom: 3 }}>{row.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: T.navy }}>{row.value}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Claims selection */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 6 }}>
              Select Claims to Share
            </div>
            <div style={{ fontSize: 12, color: T.text2, marginBottom: 14 }}>
              Toggle each claim to include or exclude it from the verifiable presentation.
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {claims.map((c) => (
                <ClaimRow
                  key={c.key}
                  label={c.label}
                  value={c.value}
                  sensitivity={c.sensitivity}
                  included={c.included}
                  onToggle={() => toggle(c.key)}
                />
              ))}
            </div>
          </Card>
        </div>

        {/* Summary sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Sharing Summary
            </div>
            <div
              style={{
                background: T.greenBg,
                borderRadius: 8,
                padding: '12px 14px',
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: T.green, marginBottom: 6 }}>
                Will be shared ({shared.length})
              </div>
              {shared.map((c) => (
                <div key={c.key} style={{ fontSize: 12, color: T.text, marginBottom: 3 }}>
                  ✓ {c.label}
                </div>
              ))}
            </div>
            <div style={{ background: T.redBg, borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.red, marginBottom: 6 }}>
                Will remain hidden ({hidden.length})
              </div>
              {hidden.map((c) => (
                <div key={c.key} style={{ fontSize: 12, color: T.text2, marginBottom: 3 }}>
                  ✕ {c.label}
                </div>
              ))}
            </div>
          </Card>

          <Alert
            type="info"
            message={`Only ${shared.length} of ${claims.length} credential claims will be disclosed.`}
          />

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Requester Identity
            </div>
            <div style={{ padding: '10px 14px', background: T.greenBg, borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.navy }}>
                CocoaCraft Manufacturing Sdn. Bhd.
              </div>
              <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>Manufacturer</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.teal, marginTop: 4 }}>
                did:ethr:0x7B82…44A1
              </div>
              <div style={{ marginTop: 6 }}>
                <Badge label="verified" variant="verified" />
              </div>
            </div>
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Btn onClick={() => setShowPreview(true)} full>
              Preview Presentation
            </Btn>
            <Btn onClick={approve} variant="secondary" full>
              Approve & Share
            </Btn>
            <Btn variant="danger" full>
              Reject Request
            </Btn>
          </div>
        </div>
      </div>

      {showPreview && (
        <Modal title="Presentation Preview" onClose={() => setShowPreview(false)} width={540}>
          <div style={{ display: 'grid', gap: 14 }}>
            <Alert
              type="info"
              message={`Only ${shared.length} of ${claims.length} credential claims will be disclosed. ${hidden.length} claims remain hidden.`}
            />
            <div style={{ background: T.surface2, borderRadius: 10, padding: '16px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.navy, marginBottom: 10 }}>
                Disclosed Claims
              </div>
              {shared.map((c) => (
                <div
                  key={c.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '6px 0',
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  <span style={{ fontSize: 12, color: T.text2 }}>{c.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: T.navy }}>{c.value}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: T.text2 }}>
              <strong>Presentation expiry:</strong> 48 hours from sharing
              <br />
              <strong>Recipient:</strong> {request.from}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={() => setShowPreview(false)} variant="outline" style={{ flex: 1 }}>
                Edit
              </Btn>
              <Btn onClick={approve} style={{ flex: 2 }}>
                Approve & Share
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      <TxModal
        state={txState}
        title="Creating Verifiable Presentation"
        message="Presentation created and shared with CocoaCraft Manufacturing Sdn. Bhd."
        onClose={() => {
          setTx(null);
          onBack();
        }}
      />
    </div>
  );
}
