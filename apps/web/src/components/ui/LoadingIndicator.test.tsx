// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LoadingIndicator } from './LoadingIndicator';

afterEach(cleanup);

it.each(['cards', 'table', 'detail', 'form'] as const)(
  'uses an accessible %s skeleton without empty or zero states',
  (layout) => {
    const { container } = render(<LoadingIndicator page layout={layout} label="Loading records" />);
    expect(screen.getByRole('status', { name: 'Loading records' }).getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(container.querySelector(`.page-skeleton--${layout}`)).toBeTruthy();
    expect(container.querySelectorAll('.page-skeleton__item').length).toBeGreaterThan(0);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText(/No records/)).toBeNull();
  },
);

it('retains inline and session-screen spinners for short actions and session restoration', () => {
  const { container, rerender } = render(<LoadingIndicator size="small" label="Signing" />);
  expect(container.querySelector('.loading-indicator--small')).toBeTruthy();
  rerender(<LoadingIndicator fullScreen label="Checking session" />);
  expect(screen.getByRole('status', { name: 'Checking session' })).toBeTruthy();
  expect(container.querySelector('.loading-indicator--screen')).toBeTruthy();
  expect(container.querySelector('.page-skeleton')).toBeNull();
});
