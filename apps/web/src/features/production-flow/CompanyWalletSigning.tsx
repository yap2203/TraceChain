import { useState } from 'react';
import { Alert, Btn } from '../workspaces/shared/ui';
import { completePreparedWorkflow } from './production-flow.transaction';
import { prepareCompanyWalletBinding } from './production-flow.api';

export function CompanyWalletSigning() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <section aria-label="MetaMask presentation signing">
      <h3>Sign presentations with MetaMask</h3>
      <p>
        Your company wallet signs each approved disclosure. No separate signing key or recovery kit
        is needed for wallet-bound credentials.
      </p>
      <p>
        Enable cross-device company presentations once by publishing your issuer-authorized wallet
        attestation. This requires an unlocked issuer on first setup and a MetaMask transaction;
        later devices can retrieve it from encrypted IPFS.
      </p>
      {message && <Alert type="info" message={message} />}
      <Btn
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setMessage('');
          void completePreparedWorkflow(prepareCompanyWalletBinding)
            .then(() =>
              setMessage(
                'Company wallet attestation is registered. Use this MetaMask account on another device.',
              ),
            )
            .catch((error) => setMessage(error.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Checking wallet attestation…' : 'Enable cross-device presentations'}
      </Btn>
    </section>
  );
}
