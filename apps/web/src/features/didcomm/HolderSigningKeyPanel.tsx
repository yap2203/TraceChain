import { useRef, useState } from 'react';

import {
  createBindingProof,
  createMessagingAgent,
  exportRecoveryKit,
  getActiveMessagingAgent,
  importRecoveryKit,
  setActiveMessagingAgent,
} from './didcomm-agent';
import { didCommApi } from './didcomm.api';
import { Alert, Btn, Card } from '../workspaces/shared/ui';

/**
 * This key signs holder presentations. It is deliberately not used for DIDComm transport; the
 * backend now owns separate messaging keys. Existing recovery files remain compatible.
 */
export function HolderSigningKeyPanel({ expectedDid }: { expectedDid?: string }) {
  const [ready, setReady] = useState(() => !!getActiveMessagingAgent());
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const create = async () => {
    setError('');
    try {
      const holder = setActiveMessagingAgent(await createMessagingAgent());
      const challenge = await didCommApi.challenge();
      await didCommApi.bind(await createBindingProof(holder, challenge));
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the presentation key.');
    }
  };
  const restore = async (selected?: File) => {
    if (!selected) return;
    setError('');
    try {
      const holder = await importRecoveryKit(await selected.text(), password);
      if (expectedDid && holder.did !== expectedDid)
        throw new Error('This backup is not the presentation key bound to the credential.');
      setActiveMessagingAgent(holder);
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore the presentation key.');
    } finally {
      if (file.current) file.current.value = '';
    }
  };
  const backup = async () => {
    setError('');
    try {
      const holder = getActiveMessagingAgent();
      if (!holder) throw new Error('Create or restore the presentation key first.');
      const content = await exportRecoveryKit(holder, password);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      link.download = 'tracechain-presentation-key-backup.json';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the encrypted backup.');
    }
  };
  return (
    <Card>
      <div style={{ display: 'grid', gap: 8 }}>
        <b>Holder presentation signing key</b>
        <div style={{ fontSize: 12 }}>
          This browser key signs selective or company presentations. Secure DIDComm delivery is
          automatic and uses a different backend-managed company-agent key.
        </div>
        {error && <Alert type="error" message={error} />}
        <input
          aria-label="Presentation key backup password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Backup password (10+ characters)"
        />
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          aria-label="Restore presentation key backup"
          onChange={(event) => void restore(event.target.files?.[0])}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!ready && !expectedDid && <Btn onClick={() => void create()}>Create signing key</Btn>}
          {ready && (
            <Btn variant="outline" onClick={() => void backup()}>
              Download encrypted signing-key backup
            </Btn>
          )}
        </div>
      </div>
    </Card>
  );
}
