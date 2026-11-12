import { useEffect, useId, useRef, type ReactNode } from 'react';
import { T } from './tokens';

export function Modal({
  title,
  children,
  onClose,
  width = 520,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    return () => {
      if (typeof element.close === 'function') element.close();
      else element.removeAttribute('open');
    };
  }, []);
  return (
    <dialog
      className="workspace-dialog"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={onClose}
      style={{ width, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 32px)' }}
    >
      <div
        style={{
          background: T.surface,
          borderRadius: 14,
          width: '100%',
          maxWidth: '100%',
          maxHeight: 'calc(100dvh - 32px)',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '18px 24px',
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <div id={titleId} style={{ fontWeight: 700, fontSize: 15, color: T.navy }}>
            {title}
          </div>
          <button
            aria-label="Close dialog"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: T.text2,
              fontSize: 18,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </dialog>
  );
}
