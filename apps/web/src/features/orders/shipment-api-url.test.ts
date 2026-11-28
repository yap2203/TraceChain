// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});
it.each([
  [undefined, 'http://localhost:3000/api'],
  ['https://api.example/', 'https://api.example/api'],
  ['http://localhost:3000', 'http://localhost:3000/api'],
  ['', '/api'],
  ['/', '/api'],
  ['/gateway/', '/gateway/api'],
])('constructs receipt and login API requests for configuration %s', async (base, prefix) => {
  vi.resetModules();
  vi.stubEnv('VITE_API_BASE_URL', base);
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ authenticated: false, orders: [] })),
  );
  vi.stubGlobal('fetch', fetch);
  const auth = await import('../auth/auth.api');
  const orders = await import('./orders.api');
  await auth.getAuthSession();
  await orders.getOrders();
  expect(fetch.mock.calls[0][0]).toBe(`${prefix}/auth/session`);
  expect(fetch.mock.calls[1][0]).toBe(`${prefix}/orders`);
  expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
  expect(fetch.mock.calls[1][1]).toMatchObject({ credentials: 'include' });
});
