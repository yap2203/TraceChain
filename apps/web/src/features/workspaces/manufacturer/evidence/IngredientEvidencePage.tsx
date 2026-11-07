import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, FileCheck } from 'lucide-react';

import {
  listEvidenceRequests,
  listProductionIngredients,
  prepareEvidenceAcceptance,
  prepareEvidenceRequest,
  type ProductionEvidenceRequest,
  type ProductionIngredient,
} from '../../../production-flow/production-flow.api';
import { completePreparedWorkflow } from '../../../production-flow/production-flow.transaction';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  Input,
  SectionTitle,
  StatCard,
  T,
  Table,
  TD,
  TR,
} from '../../shared/ui';
import { chainDate, shortChainId } from '../../shared/operational-format';

const statuses = [
  'Unknown',
  'Awaiting response',
  'Evidence received',
  'Accepted',
  'Declined',
  'Rejected',
  'Cancelled',
];

export function IngredientEvidence({ onNav: _onNav }: { onNav: (target: string) => void }) {
  const [ingredients, setIngredients] = useState<ProductionIngredient[]>([]);
  const [requests, setRequests] = useState<ProductionEvidenceRequest[]>([]);
  const [batchId, setBatchId] = useState('');
  const [reason, setReason] = useState('Product ingredient traceability verification');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    const [ingredientResult, requestResult] = await Promise.all([
      listProductionIngredients(),
      listEvidenceRequests(),
    ]);
    setIngredients(ingredientResult.batches);
    setRequests(requestResult.requests);
  };
  useEffect(() => {
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : 'Could not load evidence records.'),
    );
  }, []);

  const requestEvidence = async () => {
    setBusy('request');
    setError('');
    setNotice('');
    try {
      const operationId = crypto.randomUUID();
      await completePreparedWorkflow(() =>
        prepareEvidenceRequest({
          batchId,
          claims: [
            'Full Ingredient Credential',
            'Ingredient batch identity',
            'Credential validity',
          ],
          dueAt: new Date(`${dueAt}T23:59:59`).toISOString(),
          operationId,
          reason,
        }),
      );
      setNotice('The evidence request is confirmed on chain.');
      setBatchId('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request failed.');
    } finally {
      setBusy('');
    }
  };

  const accept = async (requestId: string) => {
    setBusy(requestId);
    setError('');
    setNotice('');
    try {
      await completePreparedWorkflow(() => prepareEvidenceAcceptance(requestId));
      setNotice('The cryptographically verified evidence is accepted for this Manufacturer.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Evidence acceptance failed.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <SectionTitle
        title="Ingredient Evidence"
        sub="Real EvidenceRegistry requests and challenge-bound Supplier presentations"
      />
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 14 }}>
        <StatCard
          label="Awaiting Supplier"
          value={requests.filter((item) => item.status === 1).length}
          color={T.amber}
          icon={<Clock size={20} />}
        />
        <StatCard
          label="Ready for Review"
          value={requests.filter((item) => item.status === 2).length}
          color={T.teal}
          icon={<FileCheck size={20} />}
        />
        <StatCard
          label="Accepted"
          value={requests.filter((item) => item.status === 3).length}
          color={T.green}
          icon={<CheckCircle2 size={20} />}
        />
      </div>
      <Card>
        <div style={{ fontWeight: 700, color: T.navy, marginBottom: 12 }}>
          Request evidence for an active Supplier batch
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={{ fontSize: 12, color: T.text2 }}>
            Ingredient batch
            <select
              value={batchId}
              onChange={(event) => setBatchId(event.target.value)}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 6,
                padding: 10,
                border: `1px solid ${T.border}`,
                borderRadius: 8,
              }}
            >
              <option value="">Select a real on-chain batch</option>
              {ingredients
                .filter((item) => !item.accepted)
                .map((item) => (
                  <option key={item.batchId} value={item.batchId}>
                    {item.supplierName ?? 'Verified Supplier'} · {shortChainId(item.batchId)} ·{' '}
                    {item.availableQuantity} available
                  </option>
                ))}
            </select>
          </label>
          <Input label="Reason" value={reason} onChange={setReason} required />
          <Input label="Response deadline" type="date" value={dueAt} onChange={setDueAt} required />
          <Alert
            type="info"
            message="The request details and random challenge are encrypted before upload. Only their hashes and encrypted content reference are recorded on chain."
          />
          <Btn
            disabled={!batchId || !reason.trim() || !dueAt || Boolean(busy)}
            onClick={() => void requestEvidence()}
          >
            {busy === 'request' ? 'Confirming…' : 'Request evidence with MetaMask'}
          </Btn>
        </div>
      </Card>
      {requests.length === 0 ? (
        <EmptyState
          icon={<FileCheck size={42} />}
          title="No real evidence requests"
          sub="Select an active Supplier ingredient batch to begin."
        />
      ) : (
        <Card padding="0">
          <Table headers={['Supplier', 'Due', 'Status', '']}>
            {requests.map((request) => (
              <TR key={request.requestId}>
                <TD>{request.supplierName ?? 'Verified Supplier'}</TD>
                <TD muted>{chainDate(request.dueAt)}</TD>
                <TD>
                  <Badge
                    label={statuses[request.status] ?? 'Unknown'}
                    variant={
                      request.status === 3
                        ? 'active'
                        : request.status === 2
                          ? 'verified'
                          : 'pending'
                    }
                  />
                </TD>
                <TD>
                  {request.status === 2 && (
                    <Btn
                      size="xs"
                      disabled={Boolean(busy)}
                      onClick={() => void accept(request.requestId)}
                    >
                      {busy === request.requestId ? 'Verifying…' : 'Verify & accept'}
                    </Btn>
                  )}
                </TD>
              </TR>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
