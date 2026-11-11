import { useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';

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
import { uploadError } from '../validation/form-validation';
import { workspacePath } from '../workspaces/workspace-paths';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';

export function PresentationSigningSettingsLink({ role }: { role: WorkspaceRole }) {
  const inRouter = useInRouterContext();
  const to = `${workspacePath(role, 'mycredential')}#presentation-signing`;
  const text = 'Manage presentation signing in My company credential';
  // SPA navigation preserves the in-memory holder key while changing workspace pages.
  return inRouter ? <Link to={to}>{text}</Link> : <a href={to}>{text}</a>;
}

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
      const invalid = uploadError(selected, 1 * 1024 * 1024, /\.json$/i, ['application/json']);
      if (invalid) throw new Error(invalid);
      if (password.length < 10)
        throw new Error('Enter the original backup password (at least 10 characters).');
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
        <b>Presentation signature settings</b>
        <div style={{ fontSize: 12 }}>
          Create or restore the key used to sign approved credential presentations. This signing key
          stays in your browser. Keep an encrypted backup so you can restore it after a refresh.
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
