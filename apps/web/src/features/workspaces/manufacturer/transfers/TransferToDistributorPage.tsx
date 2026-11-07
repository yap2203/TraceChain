import { useEffect, useState } from 'react';

import { useOperationalData } from '../../../blockchain/useOperationalData';
import { TransferQrDisplay } from '../../../custody-transfers';
import {
  listDistributors,
  prepareTransfer,
  type StakeholderRecipient,
} from '../../../production-flow/production-flow.api';
import { completePreparedWorkflow } from '../../../production-flow/production-flow.transaction';
import { Alert, Btn, Card, Input, T } from '../../shared/ui';
import { shortChainId } from '../../shared/operational-format';

export function TransferToDistributor({ onBack }: { onBack: () => void }) {
  const { data, error: readError } = useOperationalData();
  const [distributors, setDistributors] = useState<StakeholderRecipient[]>([]);
  const [productBatchId, setProductBatchId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [quantity, setQuantity] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [shipmentReference, setShipmentReference] = useState('');
  const [transferId, setTransferId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void listDistributors()
      .then((result) => setDistributors(result.distributors))
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Could not load Distributors.'),
      );
  }, []);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await completePreparedWorkflow(() =>
        prepareTransfer({
          expectedAt: new Date(`${expectedAt}T23:59:59`).toISOString(),
          productBatchId,
          quantity,
          recipient,
          shipmentReference,
        }),
      );
      setTransferId(
        'transferId' in result && typeof result.transferId === 'string' ? result.transferId : '',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Transfer creation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back
        </Btn>
        <h2 style={{ margin: 0, color: T.navy }}>Transfer Product to Distributor</h2>
      </div>
      {(error || readError) && <Alert type="error" message={error || readError} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 20 }}>
        <Card>
          <div style={{ display: 'grid', gap: 14 }}>
            <label style={{ fontSize: 12, color: T.text2 }}>
              Product batch
              <select
                value={productBatchId}
                onChange={(event) => setProductBatchId(event.target.value)}
                style={{ display: 'block', width: '100%', padding: 10, marginTop: 6 }}
              >
                <option value="">Select a real product</option>
                {data.productBatches
                  .filter((product) => product.status === 1)
                  .map((product) => (
                    <option key={product.batchId} value={product.batchId}>
                      {shortChainId(product.batchId)} · {product.totalQuantity} total
                    </option>
                  ))}
              </select>
            </label>
            <label style={{ fontSize: 12, color: T.text2 }}>
              Active Distributor
              <select
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                style={{ display: 'block', width: '100%', padding: 10, marginTop: 6 }}
              >
                <option value="">Select a Distributor</option>
                {distributors.map((distributor) => (
                  <option key={distributor.walletAddress} value={distributor.walletAddress}>
                    {distributor.companyName} — Distributor
                  </option>
                ))}
              </select>
            </label>
            <Input label="Transfer quantity" value={quantity} onChange={setQuantity} required />
            <Input
              label="Expected arrival"
              type="date"
              value={expectedAt}
              onChange={setExpectedAt}
              required
            />
            <Input
              label="Shipment reference"
              value={shipmentReference}
              onChange={setShipmentReference}
              required
            />
            <Alert
              type="warning"
              message="The backend validates the current Manufacturer role, product transferability, recipient role, and inventory before returning unsigned createTransfer calldata. MetaMask remains the only signer."
            />
            <Btn
              full
              disabled={
                busy ||
                !productBatchId ||
                !recipient ||
                !quantity ||
                !expectedAt ||
                !shipmentReference ||
                Boolean(transferId)
              }
              onClick={() => void submit()}
            >
              {busy ? 'Confirming transfer…' : 'Create transfer with MetaMask'}
            </Btn>
          </div>
        </Card>
        <Card>
          {transferId ? (
            <>
              <Alert
                type="success"
                message="Transfer confirmed with Awaiting Receipt status. Share this QR with the intended Distributor."
              />
              <div style={{ marginTop: 14 }}>
                <TransferQrDisplay transferId={transferId} />
              </div>
            </>
          ) : (
            <div style={{ color: T.text2, fontSize: 13 }}>
              The QR appears only after a real createTransfer transaction is mined and the API
              verifies its Awaiting Receipt record.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
