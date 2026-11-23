// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { CatalogueImage } from './CatalogueMedia';
import { fetchCatalogueMedia, getOrders } from './orders.api';
import { resetAuthRequestScope } from '../auth/auth-request-scope';

afterEach(() => {
  resetAuthRequestScope();
  cleanup();
  vi.unstubAllGlobals();
});

it('waits for viewport proximity before downloading a catalogue image', async () => {
  let notify!: (entries: Array<{ isIntersecting: boolean }>) => void;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof notify) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  render(<CatalogueImage path="/catalogue/ingredients/lazy/image" alt="Lazy ingredient" />);
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => notify([{ isIntersecting: true }]));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('Image could not be loaded')).toBeTruthy();
});

it('never shares an in-flight order response with a different wallet session', async () => {
  let finish!: (value: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ actor: 'new-company', orders: [] })));
  vi.stubGlobal('fetch', fetch);
  const first = getOrders('order-list').catch((error) => error);
  resetAuthRequestScope();
  const second = getOrders('order-list');
  finish(new Response(JSON.stringify({ actor: 'old-company', orders: [] })));
  expect((await first).message).toContain('wallet session changed');
  expect((await second).actor).toBe('new-company');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('deduplicates concurrent authenticated reads of the same ingredient image', async () => {
  let finish: ((response: Response) => void) | undefined;
  const response = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetchMock = vi.fn(() => response);
  vi.stubGlobal('fetch', fetchMock);

  const first = fetchCatalogueMedia('/catalogue/ingredients/batch/image');
  const second = fetchCatalogueMedia('/catalogue/ingredients/batch/image');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  finish?.(new Response(new Blob(['image'], { type: 'image/png' }), { status: 200 }));
  expect(await first).toBe(await second);
});

it('deduplicates only concurrent workspace-state reads', async () => {
  let finish: ((response: Response) => void) | undefined;
  const response = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const body = JSON.stringify({
    actor: '0x1',
    role: 'DISTRIBUTOR',
    catalogue: [],
    orders: [],
    locations: [],
  });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => response)
    .mockImplementation(() =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  vi.stubGlobal('fetch', fetchMock);

  const first = getOrders();
  const second = getOrders();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  finish?.(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
  expect(await first).toBe(await second);

  await getOrders();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('distinguishes no image from an authorization failure', async () => {
  const view = render(<CatalogueImage alt="Cocoa" category="Cocoa" />);
  expect(screen.getByRole('img').getAttribute('data-media-state')).toBe('missing');
  expect(screen.getByText('No image provided')).toBeTruthy();
  view.unmount();

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
  render(
    <CatalogueImage alt="Cocoa" category="Cocoa" path="/catalogue/ingredients/private/image" />,
  );
  expect(await screen.findByText('Image access unavailable')).toBeTruthy();
  expect(screen.getByRole('img').getAttribute('data-media-state')).toBe('denied');
});
