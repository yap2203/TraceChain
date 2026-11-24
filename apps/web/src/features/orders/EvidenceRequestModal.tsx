import { useState, type ReactNode } from 'react';
import type { EvidenceClaimDefinition } from '@tracechain/shared';
import { EvidenceClaimSelector } from '../production-flow/EvidenceClaimSelector';
import { Alert, Btn, Input, Modal } from '../workspaces/shared/ui';

export function EvidenceRequestModal({
  title = 'Request company evidence',
  evidenceType,
  credentialType = 'Supplier Company Role Credential',
  requester,
  requesterRole,
  recipient,
  recipientRole,
  reference,
  catalogue,
  required,
  optional,
  purpose,
  deadline,
  contextDeadline,
  contextDeadlineLabel = 'custody offer',
  configuration,
  separationNote = 'Evidence sharing does not accept the custody offer or move stock.',
  busy = false,
  onChange,
  onClose,
  onSubmit,
}: {
  title?: string;
  evidenceType: string;
  credentialType?: string;
  requester: string;
  requesterRole?: string;
  recipient: string;
  recipientRole?: string;
  reference: string;
  catalogue: readonly EvidenceClaimDefinition[];
  required: string[];
  optional: string[];
  purpose: string;
  deadline: string;
  contextDeadline?: number;
  contextDeadlineLabel?: string;
  configuration?: ReactNode;
  separationNote?: string;
  busy?: boolean;
  onChange: (value: { required: string[]; optional: string[]; purpose: string; deadline: string }) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const [review, setReview] = useState(false);
  const [confirmLimit, setConfirmLimit] = useState(false);
  const selected = [...new Set([...required, ...optional])];
  const deadlineTime = Date.parse(deadline);
  const contextDeadlineTime = contextDeadline ? contextDeadline * 1_000 : undefined;
  const exceedsContextDeadline =
    Number.isFinite(deadlineTime) &&
    contextDeadlineTime !== undefined &&
    deadlineTime > contextDeadlineTime;
  const valid = purpose.trim().length > 0 && selected.length > 0 && Number.isFinite(deadlineTime) && deadlineTime > Date.now();
  const labels = new Map(catalogue.map((claim) => [claim.id, claim.label]));
  const reviewRequest = () => {
    if (exceedsContextDeadline) setConfirmLimit(true);
    else setReview(true);
  };
  const useContextDeadline = () => {
    onChange({
      required,
      optional,
      purpose,
      deadline: toDateTimeLocal(contextDeadlineTime!),
    });
    setConfirmLimit(false);
    setReview(true);
  };
  const footer = (
    <div className="evidence-request-modal__actions">
      <Btn
        variant="outline"
        onClick={
          confirmLimit ? () => setConfirmLimit(false) : review ? () => setReview(false) : onClose
        }
      >
        {confirmLimit ? 'Keep editing' : review ? 'Back to edit' : 'Cancel'}
      </Btn>
      {confirmLimit ? (
        <Btn onClick={useContextDeadline}>Use {contextDeadlineLabel} deadline</Btn>
      ) : review ? (
        <Btn disabled={busy || !valid} onClick={onSubmit}>
          {busy ? 'Submitting…' : 'Submit request'}
        </Btn>
      ) : (
        <Btn disabled={!valid} onClick={reviewRequest}>
          Review request
        </Btn>
      )}
    </div>
  );
  return (
    <Modal
      title={
        <div className="evidence-request-modal__title">
          <strong>{title}</strong>
          <span>{review ? 'Step 2 of 2 · Review and submit' : 'Step 1 of 2 · Configure request'}</span>
        </div>
      }
      width={920}
      className="evidence-request-dialog"
      footer={footer}
      onClose={onClose}
    >
      <div className="evidence-request-modal">
        <dl className="evidence-request-modal__context">
          <div><dt>Evidence requested</dt><dd>{evidenceType}</dd></div>
          <div><dt>Credential type</dt><dd>{credentialType}</dd></div>
          <div><dt>Requester</dt><dd>{requester}{requesterRole ? ` · ${requesterRole}` : ''}</dd></div>
          <div><dt>Recipient</dt><dd>{recipient}{recipientRole ? ` · ${recipientRole}` : ''}</dd></div>
          <div><dt>Related reference</dt><dd>{reference}</dd></div>
        </dl>
        {confirmLimit ? (
          <Alert
            type="warning"
            message={`The selected evidence deadline is after the ${contextDeadlineLabel} deadline (${new Date(contextDeadlineTime!).toLocaleString()}). Confirm that TraceChain should use the earlier ${contextDeadlineLabel} deadline, or keep editing.`}
          />
        ) : review ? (
          <section className="evidence-request-review" aria-label="Request preview">
            <div className="evidence-request-review__summary">
              <div><span>Purpose</span><strong>{purpose}</strong></div>
              <div><span>Presentation deadline</span><strong>{new Date(deadlineTime).toLocaleString()}</strong></div>
            </div>
            <div className="evidence-request-review__claims">
              <section>
                <h3>Required <span>{required.length}</span></h3>
                <ul>{required.map((claim) => <li key={claim}>{labels.get(claim) ?? claim}</li>)}</ul>
              </section>
              <section>
                <h3>Optional <span>{optional.length}</span></h3>
                <ul>{optional.map((claim) => <li key={claim}>{labels.get(claim) ?? claim}</li>)}</ul>
              </section>
            </div>
            <details className="evidence-automatic-fields">
              <summary>Automatically included for verification</summary>
              <p>Request ID, intended verifier, purpose, challenge, credential reference, related business reference, creation time and this exact deadline are bound to the signed proof.</p>
            </details>
          </section>
        ) : (
          <>
            <Input label="Purpose" value={purpose} maxLength={500} required onChange={(value) => onChange({ required, optional, purpose: value, deadline })} />
            <Input
              label="Presentation deadline"
              type="datetime-local"
              value={deadline}
              required
              error={deadline && deadlineTime <= Date.now() ? 'Choose a future deadline.' : undefined}
              onChange={(value) => {
                setConfirmLimit(false);
                onChange({ required, optional, purpose, deadline: value });
              }}
            />
            {configuration}
            <EvidenceClaimSelector catalogue={catalogue} required={required} optional={optional} onChange={(nextRequired, nextOptional) => onChange({ required: nextRequired, optional: nextOptional, purpose, deadline })} />
          </>
        )}
        {!selected.length && <Alert type="info" message="Select at least one credential field." />}
        <p className="evidence-request-modal__notice">{separationNote}</p>
      </div>
    </Modal>
  );
}

function toDateTimeLocal(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
