import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getAuthSession } from '../../../auth/auth.api';
import { useOperationalData } from '../../../blockchain/useOperationalData';
import { TransferQrDisplay } from '../../../custody-transfers';
import {
  listDistributorInventory,
  listRetailers,
  prepareDistributorTransfer,
  type DistributorInventoryProduct,
  type StakeholderRecipient,
} from '../../../production-flow/production-flow.api';
import { completePreparedWorkflow } from '../../../production-flow/production-flow.transaction';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  Input,
  SelectField,
  T,
  TechnicalDetails,
  Textarea,
} from '../../shared/ui';
import { chainDate, shortChainId, transferStatuses } from '../../shared/operational-format';
import { quantityError, futureDateError, textError } from '../../../validation/form-validation';

type Step = 'form' | 'review' | 'created';

export function DistributorTransferToRetailer({ onBack }: { onBack: () => void }) {
  const { data, error: operationalError, reload } = useOperationalData();
  const [step, setStep] = useState<Step>('form');
  const [inventory, setInventory] = useState<DistributorInventoryProduct[]>([]);
  const [retailers, setRetailers] = useState<StakeholderRecipient[]>([]);
  const [senderName, setSenderName] = useState('Verified Distributor');
  const [productBatchId, setProductBatchId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [quantity, setQuantity] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [shipmentReference, setShipmentReference] = useState('');
  const [handlingNotes, setHandlingNotes] = useState('');
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [transferId, setTransferId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submissionActive = useRef(false);

  const loadTransferOptions = useCallback(async () => {
    const [inventoryResult, retailerResult, session] = await Promise.all([
      listDistributorInventory(),
      listRetailers(),
      getAuthSession(),
    ]);
    setInventory(inventoryResult.products);
    setRetailers(retailerResult.retailers);
    if (session.authenticated && session.companyName) setSenderName(session.companyName);
  }, []);

  useEffect(() => {
    let active = true;
    void loadTransferOptions()
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Could not load transfer options.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadTransferOptions]);

  const product = inventory.find((item) => item.productBatchId === productBatchId);
  const retailer = retailers.find(
    (item) => item.walletAddress.toLowerCase() === recipient.toLowerCase(),
  );
  const quantityValid = useMemo(() => {
    try {
      return (
        Boolean(product) &&
        !quantityError(quantity) &&
        BigInt(quantity) > 0n &&
        BigInt(quantity) <= BigInt(product!.availableQuantity)
      );
    } catch {
      return false;
    }
  }, [product, quantity]);
  const canReview =
    quantityValid &&
    !!retailer &&
    !futureDateError(expectedAt, 'Expected arrival') &&
    !textError(shipmentReference, 'Shipment reference', 120) &&
    handlingNotes.length <= 1000;

  const submit = async () => {
    if (!canReview || submissionActive.current) return;
    submissionActive.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await completePreparedWorkflow(() =>
        prepareDistributorTransfer({
          expectedAt: new Date(`${expectedAt}T23:59:59`).toISOString(),
          handlingNotes,
          operationId,
          productBatchId,
          quantity,
          recipient,
          shipmentReference,
        }),
      );
      const confirmedTransferId =
        'transferId' in result && typeof result.transferId === 'string' ? result.transferId : '';
      if (!confirmedTransferId)
        throw new Error('The confirmed transfer did not include its on-chain transfer ID.');
      setTransferId(confirmedTransferId);
      setStep('created');
      await Promise.all([loadTransferOptions(), reload()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Transfer creation failed.');
    } finally {
      submissionActive.current = false;
      setBusy(false);
    }
  };

  const startAnother = () => {
    setStep('form');
    setProductBatchId('');
    setRecipient('');
    setQuantity('');
    setExpectedAt('');
    setShipmentReference('');
    setHandlingNotes('');
    setTransferId('');
    setOperationId(crypto.randomUUID());
  };

  const outgoingTransfers = data.transfers.filter((transfer) => transfer.direction === 'outgoing');
  const productLabel = product?.productName ?? product?.productReference ?? 'Product batch';

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          Transfer Product to Retailer
        </h2>
      </div>

      {(error || operationalError) && <Alert type="error" message={error || operationalError} />}

      {step === 'form' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
            gap: 20,
          }}
        >
          <Card>
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ fontWeight: 700, color: T.navy }}>Transfer details</div>
              <Alert
                type="info"
                message={`Sending as ${senderName}. MetaMask signs the transfer; TraceChain never signs for you.`}
              />
              <SelectField
                label="Available product inventory"
                value={productBatchId}
                onChange={setProductBatchId}
                required
                options={[
                  { value: '', label: loading ? 'Loading inventory…' : 'Select a product' },
                  ...inventory.map((item) => ({
                    value: item.productBatchId,
                    label: `${item.productName ?? item.productReference ?? shortChainId(item.productBatchId)} — ${item.availableQuantity} available`,
                  })),
                ]}
              />
              {product && (
                <div style={{ padding: 12, borderRadius: 8, background: T.surface2 }}>
                  <strong style={{ color: T.navy }}>{productLabel}</strong>
                  <div style={{ color: T.text2, fontSize: 12, marginTop: 4 }}>
                    {product.availableQuantity} available · {product.reservedQuantity} reserved
                  </div>
                </div>
              )}
              <SelectField
                label="Active Retailer"
                value={recipient}
                onChange={setRecipient}
                required
                options={[
                  { value: '', label: loading ? 'Loading Retailers…' : 'Select a Retailer' },
                  ...retailers.map((item) => ({
                    value: item.walletAddress,
                    label: `${item.companyName} — Retailer`,
                  })),
                ]}
              />
              <Input
                label="Transfer quantity"
                error={
                  quantity
                    ? quantityError(quantity, 'Transfer quantity', product?.availableQuantity)
                    : undefined
                }
                min="1"
                step="1"
                max={product?.availableQuantity}
                type="number"
                value={quantity}
                onChange={setQuantity}
                hint={product ? `Maximum ${product.availableQuantity}` : undefined}
                required
              />
              <Input
                label="Expected arrival"
                error={expectedAt ? futureDateError(expectedAt, 'Expected arrival') : undefined}
                type="date"
                value={expectedAt}
                onChange={setExpectedAt}
                required
              />
              <Input
                label="Shipment reference"
                maxLength={120}
                value={shipmentReference}
                onChange={setShipmentReference}
                placeholder="Your internal shipment reference"
                required
              />
              <Textarea
                label="Handling notes"
                maxLength={1000}
                value={handlingNotes}
                onChange={setHandlingNotes}
                placeholder="Optional handling instructions"
                rows={3}
              />
              <Btn full disabled={!canReview || loading} onClick={() => setStep('review')}>
                Review transfer
              </Btn>
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 700, color: T.navy, marginBottom: 14 }}>Transfer history</div>
            {!outgoingTransfers.length ? (
              <EmptyState
                icon="↗"
                title="No outgoing transfers"
                sub="Completed submissions appear here."
              />
            ) : (
              outgoingTransfers.map((transfer) => (
                <div
                  key={transfer.transferId}
                  style={{ padding: '11px 0', borderBottom: `1px solid ${T.border}` }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <strong style={{ color: T.navy, fontSize: 12 }}>
                      {transfer.recipientName ?? transfer.retailerName ?? 'Verified Retailer'}
                    </strong>
                    <Badge
                      label={transferStatuses[transfer.status] ?? 'Unknown'}
                      variant={transfer.status === 1 ? 'pending' : 'active'}
                    />
                  </div>
                  <div style={{ color: T.text2, fontSize: 11, marginTop: 4 }}>
                    {transfer.quantity} units · expected {chainDate(transfer.expectedAt)}
                  </div>
                  <TechnicalDetails
                    fields={[
                      { label: 'Transfer ID', value: transfer.transferId },
                      { label: 'Recipient wallet', value: transfer.recipient },
                    ]}
                  />
                </div>
              ))
            )}
          </Card>
        </div>
      )}

      {step === 'review' && product && retailer && (
        <Card style={{ maxWidth: 720 }}>
          <h3 style={{ color: T.navy, marginTop: 0 }}>Review transfer</h3>
          <dl style={{ display: 'grid', gap: 12 }}>
            {[
              ['Sender', senderName],
              ['Recipient', retailer.companyName],
              ['Product', productLabel],
              ['Quantity', `${quantity} units`],
              ['Expected arrival', expectedAt],
              ['Shipment reference', shipmentReference],
              ['Handling notes', handlingNotes || 'None'],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12 }}
              >
                <dt style={{ color: T.text3, fontSize: 12 }}>{label}</dt>
                <dd style={{ color: T.text, margin: 0, fontSize: 13 }}>{value}</dd>
              </div>
            ))}
          </dl>
          <Alert
            type="warning"
            message="The quantity is reserved after MetaMask confirms this transaction. The Retailer completes receipt separately."
          />
          <TechnicalDetails
            fields={[
              { label: 'Product batch ID', value: productBatchId },
              { label: 'Retailer wallet', value: recipient },
            ]}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Btn variant="ghost" onClick={() => setStep('form')} disabled={busy}>
              Back
            </Btn>
            <Btn full onClick={() => void submit()} disabled={busy}>
              {busy ? 'Waiting for MetaMask…' : 'Confirm with MetaMask'}
            </Btn>
          </div>
        </Card>
      )}

      {step === 'created' && transferId && (
        <Card style={{ maxWidth: 760 }}>
          <Alert
            type="success"
            message={`Transfer created for ${retailer?.companyName ?? 'the selected Retailer'} and verified on chain with Awaiting Receipt status.`}
          />
          <div style={{ marginTop: 18 }}>
            <TransferQrDisplay shipmentReference={shipmentReference} transferId={transferId} />
          </div>
          <TechnicalDetails
            fields={[
              { label: 'Transfer ID', value: transferId },
              { label: 'Product batch ID', value: productBatchId },
              { label: 'Retailer wallet', value: recipient },
            ]}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Btn variant="ghost" onClick={startAnother}>
              Create another transfer
            </Btn>
            <Btn onClick={onBack}>Done</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}
