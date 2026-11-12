// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Modal } from './Modal';

function ModalHarness({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  const close = () => {
    onClose();
    setOpen(false);
  };

  return (
    <div className="workspace-content">
      {open ? (
        <Modal title="Responsive dialog" onClose={close}>
          <p>Dialog content</p>
        </Modal>
      ) : null}
    </div>
  );
}

describe('Modal', () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
  });

  it('uses one body scroll region beneath a fixed header and restores page scrolling', () => {
    document.body.style.overflow = 'scroll';
    const { container } = render(<ModalHarness />);

    const dialog = screen.getByRole('dialog');
    const surface = dialog.querySelector('.workspace-dialog__surface');
    const header = dialog.querySelector('.workspace-dialog__header');
    const body = dialog.querySelector('.workspace-dialog__body');

    expect(document.body.style.overflow).toBe('hidden');
    expect(surface?.children).toHaveLength(2);
    expect(surface?.children[0]).toBe(header);
    expect(surface?.children[1]).toBe(body);
    expect(dialog.querySelectorAll('.workspace-dialog__body')).toHaveLength(1);
    expect(dialog.querySelectorAll('[data-modal-scroll-region="true"]')).toHaveLength(1);
    expect(container.querySelector('.workspace-shell')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('closes on Escape through the native dialog cancel event', () => {
    const onClose = vi.fn();
    render(<ModalHarness onClose={onClose} />);

    const dialog = screen.getByRole('dialog');
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
