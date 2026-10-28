import { T } from './tokens';
import { Btn } from './Button';
import { Card } from './Card';
import { Modal } from './Modal';

export function TxModal({
  state,
  title,
  message,
  onClose,
}: {
  state: 'pending' | 'confirmed' | 'failed' | null;
  title: string;
  message?: string;
  onClose: () => void;
}) {
  if (!state) return null;
  return (
    <Modal title="Simulated transaction" onClose={onClose} width={460}>
      <Card style={{ textAlign: 'center' }} padding="20px">
        {state === 'pending' && (
          <>
            <div
              style={{
                fontSize: 40,
                marginBottom: 16,
                animation: 'workspace-spin 1.5s linear infinite',
                display: 'inline-block',
              }}
            >
              ⟳
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, color: T.navy, marginBottom: 8 }}>
              {title}
            </div>
            <div style={{ fontSize: 13, color: T.text2 }}>Previewing the confirmation state…</div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>
              This may take a few seconds
            </div>
          </>
        )}
        {state === 'confirmed' && (
          <>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: T.greenBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: 24,
              }}
            >
              ✓
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, color: T.green, marginBottom: 8 }}>
              Simulation complete
            </div>
            <div style={{ fontSize: 13, color: T.text2, marginBottom: 20 }}>{message}</div>
            <Btn onClick={onClose} size="sm">
              Done
            </Btn>
          </>
        )}
        {state === 'failed' && (
          <>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: T.redBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: 24,
                color: T.red,
              }}
            >
              ✕
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, color: T.red, marginBottom: 8 }}>
              Transaction Failed
            </div>
            <div style={{ fontSize: 13, color: T.text2, marginBottom: 20 }}>
              {message ?? 'An error occurred. Please try again.'}
            </div>
            <Btn onClick={onClose} variant="danger" size="sm">
              Close
            </Btn>
          </>
        )}
      </Card>
      <p style={{ color: T.text2, marginTop: 12 }}>
        Sample result only. Nothing was signed or saved.
      </p>
    </Modal>
  );
}
