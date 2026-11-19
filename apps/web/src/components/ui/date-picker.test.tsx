// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Input } from './Input';
import { Input as WorkspaceInput } from '../../features/workspaces/shared/ui/FormFields';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(['date', 'datetime-local', 'time', 'month', 'week'])(
  'opens the %s picker when either shared input is clicked',
  (type) => {
    const show = vi.fn();
    render(
      <>
        <Input label="Public date" type={type} min="2026-01-01" />
        <WorkspaceInput label="Workspace date" type={type} value="" onChange={() => {}} />
      </>,
    );
    for (const label of ['Public date', 'Workspace date']) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      Object.defineProperty(input, 'showPicker', { configurable: true, value: show });
      fireEvent.click(input);
    }
    expect(show).toHaveBeenCalledTimes(2);
  },
);

it('preserves consumer click handling, native constraints and keyboard entry', () => {
  const changed = vi.fn(),
    clicked = vi.fn(),
    show = vi.fn();
  render(
    <Input
      label="Date"
      type="date"
      min="2026-01-01"
      max="2026-12-31"
      required
      onClick={clicked}
      onChange={changed}
    />,
  );
  const input = screen.getByLabelText(/Date/) as HTMLInputElement;
  Object.defineProperty(input, 'showPicker', { configurable: true, value: show });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '2026-11-19' } });
  expect(show).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledOnce();
  expect(input.value).toBe('2026-11-19');
  expect(input.min).toBe('2026-01-01');
  expect(input.max).toBe('2026-12-31');
  expect(input.required).toBe(true);
  fireEvent.click(input);
  expect(clicked).toHaveBeenCalledOnce();
  expect(show).toHaveBeenCalledOnce();
});

it('leaves read-only, disabled and ordinary text inputs alone', () => {
  const show = vi.fn();
  render(
    <>
      <Input label="Read only" type="date" readOnly />
      <Input label="Disabled" type="date" disabled />
      <Input label="Text" />
    </>,
  );
  for (const label of ['Read only', 'Disabled', 'Text']) {
    const input = screen.getByLabelText(label);
    Object.defineProperty(input, 'showPicker', { configurable: true, value: show });
    fireEvent.click(input);
  }
  expect(show).not.toHaveBeenCalled();
});

it('respects a cancelled click and tolerates unavailable or restricted native pickers', () => {
  const show = vi.fn();
  render(
    <>
      <Input label="Cancelled" type="date" onClick={(e) => e.preventDefault()} />
      <Input label="Fallback" type="date" />
    </>,
  );
  const cancelled = screen.getByLabelText('Cancelled');
  Object.defineProperty(cancelled, 'showPicker', { configurable: true, value: show });
  fireEvent.click(cancelled);
  expect(show).not.toHaveBeenCalled();
  const fallback = screen.getByLabelText('Fallback');
  Object.defineProperty(fallback, 'showPicker', { configurable: true, value: undefined });
  expect(() => fireEvent.click(fallback)).not.toThrow();
  Object.defineProperty(fallback, 'showPicker', {
    configurable: true,
    value: () => {
      throw new DOMException('Restricted', 'NotAllowedError');
    },
  });
  expect(() => fireEvent.click(fallback)).not.toThrow();
});
