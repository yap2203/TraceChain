import { useEffect, useRef, useSyncExternalStore } from 'react';
import { LoadingIndicator } from './LoadingIndicator';
import {
  subscribeTransactionProgress,
  transactionProgress,
} from '../../features/blockchain/transaction-progress';
import './transaction-progress.css';

export function TransactionProgress() {
  const stage = useSyncExternalStore(subscribeTransactionProgress, transactionProgress);
  const active = Boolean(stage);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!stage || !dialog.current) return;
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
    };
  }, [active]);
  if (!stage) return null;
  const label = stage === 'wallet' ? 'Confirm in MetaMask' : 'Confirming transaction';
  return (
    <dialog
      ref={dialog}
      className="transaction-progress"
      aria-label="Transaction in progress"
      aria-busy="true"
      onCancel={(event) => event.preventDefault()}
    >
      <div className="transaction-progress__content" role="status" aria-live="polite">
        <LoadingIndicator label={label} />
        <strong>{label}</strong>
        <p>
          {stage === 'wallet'
            ? 'Review the transaction in your wallet.'
            : 'Waiting for blockchain confirmation.'}
        </p>
      </div>
    </dialog>
  );
}
