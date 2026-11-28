// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LoadingIndicator } from './LoadingIndicator';

afterEach(cleanup);

it('embeds only content rows in a titled card, with one hidden loading announcement', () => {
  const { container } = render(
    <LoadingIndicator embedded layout="table" rows={2} columns={6} label="Loading activity" />,
  );
  const status = screen.getByRole('status', { name: 'Loading activity' });
  expect(status.getAttribute('aria-busy')).toBe('true');
  expect(status.querySelector('.sr-only')?.textContent).toBe('Loading activity');
  expect(container.querySelector('.page-skeleton__heading')).toBeNull();
  expect(container.querySelector('.page-skeleton__item')).toBeNull();
  expect(container.querySelector('.page-skeleton__label')).toBeNull();
  const rows = container.querySelectorAll('.embedded-skeleton__row');
  expect(rows).toHaveLength(2);
  expect(rows[0]?.querySelectorAll('.page-skeleton__line')).toHaveLength(6);
});

it('uses a compact inline value skeleton without announcing a false count', () => {
  const { container } = render(<LoadingIndicator embedded layout="value" label="Loading orders" />);
  expect(screen.getByRole('status', { name: 'Loading orders' })).toBeTruthy();
  expect(container.querySelectorAll('.page-skeleton__line')).toHaveLength(1);
  expect(container.querySelector('.embedded-skeleton__row')).toBeNull();
  expect(screen.queryByText('0')).toBeNull();
});

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
