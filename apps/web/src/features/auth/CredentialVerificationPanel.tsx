import { useRef, useState, type ChangeEvent } from 'react';

import type { CompanyRole } from '@tracechain/shared';

import type { CredentialVerificationState } from './useWalletAuthentication';

const MAX_CREDENTIAL_FILE_SIZE = 240 * 1024;

const reasonLabels: Record<string, string> = {
  EXPIRED: 'The credential has expired.',
  INACTIVE_STATUS: 'The credential is not active.',
  INVALID_SIGNATURE: 'The credential signature is invalid.',
  MALFORMED_CREDENTIAL: 'The file is not a valid Company Role Credential.',
  NOT_YET_VALID: 'The credential is not valid yet.',
  UNSUPPORTED_ROLE: 'The credential contains an unsupported role.',
  UNTRUSTED_ISSUER: 'The credential was not issued by the trusted TraceChain authority.',
  WRONG_WALLET: 'The credential does not belong to the signed-in wallet.',
};

export function CredentialVerificationPanel({
  credentialId,
  credentialState,
  onPresent,
  role,
}: {
  credentialId?: string;
  credentialState: CredentialVerificationState;
  onPresent: (credential: Record<string, unknown>) => Promise<void>;
  role?: CompanyRole;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState('');
  const busy = credentialState.phase === 'reading' || credentialState.phase === 'verifying';

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setFileError('');
    if (!file) return;

    try {
      if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
        throw new Error('Choose a JSON credential file.');
      }
      if (file.size > MAX_CREDENTIAL_FILE_SIZE) {
        throw new Error('The credential file must be smaller than 240 KiB.');
      }
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The credential file must contain one JSON object.');
      }
      await onPresent(parsed as Record<string, unknown>);
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : 'The credential file could not be read.',
      );
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  return (
    <section className="credential-verification-panel" aria-labelledby="credential-title">
      <div>
        <span>Company access</span>
        <h3 id="credential-title">Verify role credential</h3>
      </div>
      <p>Select the JSON credential provided by the TraceChain authority.</p>
      <label className={`credential-file-button${busy ? ' is-disabled' : ''}`}>
        {busy ? 'Verifying credential…' : 'Choose credential file'}
        <input
          ref={input}
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => void handleFile(event)}
          type="file"
        />
      </label>
      {(fileError || credentialState.phase === 'error') && (
        <div className="credential-result credential-result--error" role="alert">
          <strong>Verification unsuccessful</strong>
          <p>{fileError || credentialState.message}</p>
          {credentialState.reasons.length > 0 && (
            <ul>
              {credentialState.reasons.map((reason) => (
                <li key={reason}>{reasonLabels[reason] ?? reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {credentialState.phase === 'success' && (
        <div className="credential-result credential-result--success" role="status">
          <strong>{role ?? 'Company role'} verified locally</strong>
          <p>{credentialState.message}</p>
          {credentialId && <small>Credential: {credentialId}</small>}
        </div>
      )}
    </section>
  );
}
