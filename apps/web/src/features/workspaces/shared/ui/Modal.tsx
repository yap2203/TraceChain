import { useEffect, useId, useRef, type ReactNode } from 'react';
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
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (typeof element.close === 'function' && element.open) element.close();
      else element.removeAttribute('open');
    };
  }, []);
  return (
    <dialog
      className="workspace-dialog"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      style={{ width }}
    >
      <div className="workspace-dialog__surface">
        <header className="workspace-dialog__header">
          <div id={titleId} className="workspace-dialog__title">
            {title}
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="workspace-dialog__close"
          >
            ✕
          </button>
        </header>
        <div className="workspace-dialog__body" data-modal-scroll-region="true">
          {children}
        </div>
      </div>
    </dialog>
  );
}
