import { CompanyRole, decodeTransferQrPayload, TransferQrError } from '@tracechain/shared';
import { AlertTriangle, LoaderCircle, ShieldCheck, Smartphone } from 'lucide-react';
import { useMemo } from 'react';

import { Brand } from '../../components/brand/Brand';
import { useWalletAuthentication } from '../auth/useWalletAuthentication';
import { TransferQrScanner } from './TransferQrScanner';
import { loadTransferQrConfiguration } from './transfer-qr';
import './receive-transfer.css';

export function safeReceiptReturnTo(value: string, publicAppUrl: string) {
  try {
    const origin = new URL(publicAppUrl).origin;
    const url = new URL(value, origin);
    decodeTransferQrPayload(url.href, { publicAppUrl });
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function isMobileBrowser(userAgent = navigator.userAgent) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

export function ReceiveTransferPage() {
  const auth = useWalletAuthentication();
  const validation = useMemo(() => {
    try {
      const configuration = loadTransferQrConfiguration();
      const currentUrl = window.location.href;
      const payload = decodeTransferQrPayload(currentUrl, {
        publicAppUrl: configuration.publicAppUrl,
      });
      if (payload.chainId !== configuration.chainId)
        return { error: 'This shipment link is for a different blockchain network.' };
      if (payload.custodyTransferAddress !== configuration.contractAddress)
        return { error: 'This shipment link belongs to a different TraceChain deployment.' };
      return { currentUrl };
    } catch (error) {
      return {
        error:
          error instanceof TransferQrError && error.code === 'PUBLIC_APP_ORIGIN_MISMATCH'
            ? 'This shipment link belongs to a different TraceChain deployment.'
            : 'This receipt-confirmation link is invalid or incomplete.',
      };
    }
  }, []);

  const allowedRole =
    auth.state.role === CompanyRole.DISTRIBUTOR || auth.state.role === CompanyRole.RETAILER;
  const authorized =
    auth.state.phase === 'authenticated' && auth.state.authorizationReady && allowedRole;
  const pending = ['restoring', 'connecting', 'mobile_connecting', 'signing', 'verifying'].includes(
    auth.state.phase,
  );

  return (
    <main className="receive-transfer-page">
      <header className="receive-transfer-header">
        <Brand />
      </header>
      <div className="receive-transfer-shell">
        <section className="receive-transfer-intro">
          <span className="receive-transfer-kicker">
            <ShieldCheck size={16} /> Secure recipient action
          </span>
          <h1>Shipment receipt confirmation</h1>
          <p>
            Review the verified shipment and record what your company received. Scanning this link
            never confirms a transfer.
          </p>
        </section>

        {validation.error ? (
          <section className="receive-transfer-state" role="alert">
            <AlertTriangle size={24} />
            <div>
              <h2>Link cannot be opened</h2>
              <p>{validation.error}</p>
            </div>
          </section>
        ) : pending ? (
          <section className="receive-transfer-state" aria-live="polite">
            <LoaderCircle className="receive-transfer-spinner" size={24} />
            <div>
              <h2>
                {auth.state.phase === 'restoring'
                  ? 'Restoring your session'
                  : 'Continue in MetaMask'}
              </h2>
              <p>{auth.state.message}</p>
            </div>
          </section>
        ) : auth.state.phase !== 'authenticated' ? (
          <section className="receive-transfer-login">
            <Smartphone size={28} />
            <h2>Sign in with MetaMask to continue</h2>
            <p>
              Only the intended receiving company can view and confirm this shipment. TraceChain
              will verify your wallet, role credential and on-chain permission.
            </p>
            <button
              className="transfer-qr-button"
              onClick={() => void (isMobileBrowser() ? auth.connectMobile() : auth.connect())}
              type="button"
            >
              {isMobileBrowser() ? 'Open MetaMask Mobile' : 'Connect MetaMask'}
            </button>
            {auth.state.phase === 'switch_required' && (
              <button
                className="transfer-qr-secondary"
                onClick={() => void auth.switchToTargetNetwork()}
                type="button"
              >
                Switch network
              </button>
            )}
            {auth.state.message && auth.state.phase !== 'idle' && (
              <p className="receive-transfer-feedback" role="alert">
                {auth.state.message}
              </p>
            )}
          </section>
        ) : !authorized ? (
          <section className="receive-transfer-state" role="alert">
            <AlertTriangle size={24} />
            <div>
              <h2>Recipient authorization required</h2>
              <p>
                This wallet does not have an active Distributor or Retailer credential and on-chain
                authorization for receipt confirmation.
              </p>
            </div>
          </section>
        ) : (
          <TransferQrScanner initialPayload={validation.currentUrl} />
        )}
      </div>
    </main>
  );
}
