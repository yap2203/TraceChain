import { useState } from 'react';

import {
  prepareEvidenceResponse,
  type ProductionEvidenceRequest,
} from '../../../production-flow/production-flow.api';
import { completePreparedWorkflow } from '../../../production-flow/production-flow.transaction';
import { Alert, Badge, Btn, Card, T } from '../../shared/ui';
import { chainDate, shortChainId } from '../../shared/operational-format';

export function SelectiveDisclosure({
  request,
  onBack,
}: {
  request: ProductionEvidenceRequest;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const respond = async () => {
    setBusy(true);
    setError('');
    try {
      await completePreparedWorkflow(() => prepareEvidenceResponse(request.requestId));
      onBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The evidence response failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Btn variant="ghost" size="sm" onClick={onBack}>
          Back
        </Btn>
        <h2 style={{ margin: 0, color: T.navy }}>Respond to Evidence Request</h2>
        <Badge label="Awaiting response" variant="pending" />
      </div>
      {error && <Alert type="error" message={error} />}
      <Card>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <b>Request</b> · {shortChainId(request.requestId)}
          </div>
          <div>
            <b>Manufacturer</b> · {shortChainId(request.requester)}
          </div>
          <div>
            <b>Ingredient batch</b> · {shortChainId(request.ingredientBatchId)}
          </div>
          <div>
            <b>Deadline</b> · {chainDate(request.dueAt)}
          </div>
          <Alert
            type="warning"
            message="This workflow presents the complete issued Ingredient Credential. JWT selective disclosure is not supported, so no claim is hidden or individually toggled."
          />
          <Alert
            type="info"
            message="The server retrieves the credential from its authorized encrypted repository, creates and verifies a challenge-bound Verifiable Presentation, encrypts it for off-chain storage, and returns only unsigned EvidenceRegistry calldata."
          />
          <Btn disabled={busy} onClick={() => void respond()}>
            {busy ? 'Creating and confirming…' : 'Present full credential with MetaMask'}
          </Btn>
        </div>
      </Card>
    </div>
  );
}
