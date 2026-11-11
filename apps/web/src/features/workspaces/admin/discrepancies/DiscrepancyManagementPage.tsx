import { FileDown, RefreshCw, Scale } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  getCustodyDiscrepancies,
  prepareDiscrepancyResolution,
} from '../../../custody-transfers/custody-transfer.api';
import type { AdminCustodyDiscrepancy } from '../../../custody-transfers/custody-transfer.types';
import { submitProductionTransaction } from '../../../production-flow/production-flow.transaction';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  T,
  TechnicalDetails,
  Textarea,
} from '../../shared/ui';

export default function DiscrepancyManagementPage() {
  const [items, setItems] = useState<AdminCustodyDiscrepancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await getCustodyDiscrepancies());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Discrepancies could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (item: AdminCustodyDiscrepancy, acceptActual: boolean) => {
    const reason = reasons[item.transferId]?.trim();
    if (reason && reason.length > 4000) {
      setError('Reason must be 4000 characters or fewer.');
      return;
    }
    if (!reason || busyId) return;
    setBusyId(item.transferId);
    setError('');
    try {
      const prepared = await prepareDiscrepancyResolution({
        acceptActual,
        reason,
        transferId: item.transferId,
      });
      await submitProductionTransaction(prepared.transaction, prepared.actorWallet);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The discrepancy decision failed.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ color: T.teal, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>
            CUSTODY OPERATIONS
          </div>
          <h2 style={{ margin: '5px 0 4px', color: T.navy, fontSize: 22 }}>
            Receipt discrepancies
          </h2>
          <p style={{ margin: 0, color: T.text2, fontSize: 13 }}>
            Review recipient-reported shortages and excess quantities before deciding the on-chain
            outcome.
          </p>
        </div>
        <Btn icon={<RefreshCw size={14} />} onClick={() => void load()} variant="outline">
          Refresh
        </Btn>
      </div>

      <Alert
        message="Accepting the actual quantity reopens the transfer for a separate recipient confirmation. Cancelling releases the sender's reserved inventory."
        type="info"
      />
      {error && <Alert message={error} type="error" />}

      {!loading && items.length === 0 ? (
        <EmptyState
          icon={<Scale size={42} />}
          sub="Shortage and excess reports will appear here after they are recorded on-chain."
          title="No receipt discrepancies"
        />
      ) : (
        items.map((item) => {
          const evidence = item.privateDetails?.evidence ?? [];
          const isBusy = busyId === item.transferId;
          const status = item.resolved
            ? item.status === 1
              ? 'Accepted — recipient confirmation pending'
              : 'Cancelled — sender reservation released by contract'
            : 'Administrator review required';
          return (
            <Card key={item.transferId} style={{ padding: 20 }}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ color: T.text2, fontSize: 11 }}>{item.productReference}</div>
                  <h3 style={{ margin: '3px 0 0', color: T.text, fontSize: 16 }}>
                    {item.productName}
                  </h3>
                  <div style={{ marginTop: 5, color: T.text2, fontSize: 12 }}>
                    {item.senderName ?? 'Sender'} → {item.recipientName ?? 'Recipient'}
                  </div>
                </div>
                <Badge
                  label={status}
                  variant={item.resolved ? (item.status === 1 ? 'pending' : 'rejected') : 'pending'}
                />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: 10,
                  marginTop: 18,
                }}
              >
                <Metric label="Expected" value={item.expectedQuantity} />
                <Metric label="Reported actual" value={item.actualQuantity} />
                <Metric label="Difference" value={difference(item)} />
                <Metric label="Type" value={item.discrepancyType} />
              </div>

              {item.privateDetails?.notes && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 12,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    color: T.text,
                    fontSize: 12,
                  }}
                >
                  <strong>Recipient notes</strong>
                  <p style={{ margin: '5px 0 0', color: T.text2 }}>{item.privateDetails.notes}</p>
                </div>
              )}

              {evidence.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {evidence.map((file, index) => (
                    <Btn
                      icon={<FileDown size={13} />}
                      key={`${file.mediaType}-${index}`}
                      onClick={() => downloadEvidence(file.dataBase64, file.mediaType, index)}
                      size="sm"
                      variant="outline"
                    >
                      Evidence {index + 1}
                    </Btn>
                  ))}
                </div>
              )}

              {!item.resolved && (
                <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
                  <Textarea
                    label="Decision reason"
                    onChange={(value) =>
                      setReasons((current) => ({ ...current, [item.transferId]: value }))
                    }
                    placeholder="Explain the decision. Only its cryptographic hash is written on-chain."
                    rows={3}
                    value={reasons[item.transferId] ?? ''}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <Btn
                      disabled={isBusy || !(reasons[item.transferId] ?? '').trim()}
                      onClick={() => void resolve(item, true)}
                    >
                      {isBusy ? 'Waiting for MetaMask…' : 'Accept actual quantity'}
                    </Btn>
                    <Btn
                      disabled={isBusy || !(reasons[item.transferId] ?? '').trim()}
                      onClick={() => void resolve(item, false)}
                      variant="danger"
                    >
                      Cancel transfer
                    </Btn>
                  </div>
                </div>
              )}

              <TechnicalDetails
                fields={[
                  { label: 'Transfer ID', value: item.technical.transferId },
                  { label: 'Details hash', value: item.technical.detailsHash },
                  { label: 'Encrypted evidence CID', value: item.technical.evidenceCid },
                  { label: 'Sender wallet', value: item.technical.senderWallet },
                  { label: 'Recipient wallet', value: item.technical.recipientWallet },
                ]}
              />
            </Card>
          );
        })
      )}

      {loading && <div style={{ color: T.text2, fontSize: 13 }}>Loading discrepancies…</div>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 12, borderRadius: 8, background: T.surface2 }}>
      <div style={{ color: T.text2, fontSize: 10, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 5, color: T.text, fontSize: 15, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function difference(item: AdminCustodyDiscrepancy) {
  const value = BigInt(item.actualQuantity) - BigInt(item.expectedQuantity);
  return value > 0n ? `+${value}` : value.toString();
}

function downloadEvidence(dataBase64: string, mediaType: string, index: number) {
  const binary = atob(dataBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `tracechain-receipt-evidence-${index + 1}.${extension(mediaType)}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function extension(mediaType: string) {
  return mediaType === 'application/pdf'
    ? 'pdf'
    : mediaType === 'image/jpeg'
      ? 'jpg'
      : mediaType === 'image/webp'
        ? 'webp'
        : 'png';
}
