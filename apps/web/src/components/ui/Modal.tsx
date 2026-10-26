import { useEffect, type ReactNode } from 'react';

import { AppIcon } from '../icons/AppIcon';

interface ModalProps {
  children: ReactNode;
  footer?: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  title: string;
}

export function Modal({ children, footer, isOpen, onClose, title }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="modal-title"
        aria-modal="true"
        className="modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="modal__header">
          <h2 id="modal-title">{title}</h2>
          <button
            aria-label="Close dialog"
            className="modal__close"
            onClick={onClose}
            type="button"
          >
            <AppIcon name="close" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </section>
    </div>
  );
}
