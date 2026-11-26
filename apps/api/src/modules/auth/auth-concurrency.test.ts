import { describe, expect, it, vi } from 'vitest';
import { CompanyRole } from '@tracechain/shared';
import {
  AuthService,
  assertAuthorizationAvailable,
  mayUseCachedAuthorization,
  runWithAuthorizationFreshness,
} from './auth.service.js';
import { InMemoryNonceRepository, InMemorySessionRepository } from './auth.repository.js';
import type { OnChainAuthorizationSummary } from './auth.types.js';

describe('Fresh concurrent authorization checks', () => {
  it('coalesces concurrent checks but sees suspension on the next request', async () => {
    const sessions = new InMemorySessionRepository();
    const now = new Date();
    await sessions.save({
      id: 'session',
      address: '0x1111111111111111111111111111111111111111',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    let finish!: (summary: OnChainAuthorizationSummary) => void;
    const resolve = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<OnChainAuthorizationSummary>((done) => {
          finish = done;
        }),
      )
      .mockResolvedValue({ checkedAt: now, status: 'SUSPENDED' });
    const service = new AuthService({
      configuration: {
        chainId: 11155111,
        domain: 'localhost',
        uri: 'http://localhost',
        nonceTtlMs: 60_000,
        sessionTtlMs: 60_000,
      },
      nonceRepository: new InMemoryNonceRepository(),
      sessionRepository: sessions,
      authorizationResolver: { resolve },
    });
    const requests = [service.getSession('session'), service.requireSession('session')];
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    finish({ checkedAt: now, status: 'AUTHORIZED', role: CompanyRole.SUPPLIER });
    const [session] = await Promise.all(requests);
    expect(session).toMatchObject({ authorizationReady: true });
    expect(await service.getSession('session')).toMatchObject({
      authenticated: true,
      authorizationReady: false,
      authorizationStatus: 'SUSPENDED',
    });
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  describe('short authorization cache for read-only requests', () => {
    const address = '0x1111111111111111111111111111111111111111';
    async function cached(resolve: ReturnType<typeof vi.fn>) {
      const sessions = new InMemorySessionRepository();
      let time = Date.now();
      const clock = () => new Date(time);
      await sessions.save({
        id: 'session',
        address,
        createdAt: clock(),
        expiresAt: new Date(time + 3_600_000),
      });
      const service = new AuthService({
        authorizationCacheMs: 15_000,
        clock,
        configuration: {
          chainId: 11155111,
          domain: 'localhost',
          uri: 'http://localhost',
          nonceTtlMs: 60_000,
          sessionTtlMs: 3_600_000,
        },
        nonceRepository: new InMemoryNonceRepository(),
        sessionRepository: sessions,
        authorizationResolver: { resolve },
      });
      return { service, advance: (ms: number) => (time += ms) };
    }
    const authorized = { checkedAt: new Date(), status: 'AUTHORIZED', role: CompanyRole.SUPPLIER };

    it('reuses an authorized result for reads, and re-checks after it expires', async () => {
      const resolve = vi.fn().mockResolvedValue(authorized);
      const { service, advance } = await cached(resolve);
      await service.getSession('session');
      advance(14_000);
      await service.getSession('session');
      expect(resolve).toHaveBeenCalledTimes(1);
      advance(2_000);
      await service.getSession('session');
      expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('always checks the chain for actions, and a revocation stops later reads', async () => {
      const resolve = vi
        .fn()
        .mockResolvedValueOnce(authorized)
        .mockResolvedValue({ checkedAt: new Date(), status: 'REVOKED' });
      const { service } = await cached(resolve);
      await service.getSession('session');
      const action = await runWithAuthorizationFreshness(true, () =>
        service.requireSession('session'),
      );
      expect(action.onChainAuthorization?.status).toBe('REVOKED');
      expect(await service.getSession('session')).toMatchObject({ authorizationReady: false });
      expect(resolve).toHaveBeenCalledTimes(3);
    });

    it('allows the cache only for allow-listed page-list reads', () => {
      for (const path of [
        '/api/auth/session',
        '/api/orders',
        '/api/orders/custody-offers',
        '/api/orders/custody-offers/0xabc',
        '/api/orders/information-requests',
      ])
        expect(mayUseCachedAuthorization('GET', path)).toBe(true);
      for (const [method, path] of [
        ['POST', '/api/orders'],
        ['HEAD', '/api/orders'],
        ['GET', '/api/production-flow/evidence-requests/0x1/company-identity/material'],
        ['GET', '/api/production-flow/evidence-requests/0x1/review'],
        ['GET', '/api/custody-transfers/0x1/evidence'],
        ['GET', '/api/ingredient-batches/0x1/document'],
        ['GET', '/api/didcomm/mailbox'],
        ['GET', '/api/orders/recall/0x1'],
        ['GET', '/api/orders/branding/0x1/logo'],
      ])
        expect(mayUseCachedAuthorization(method, path)).toBe(false);
    });

    it('never lets an older read overwrite a newer live revocation', async () => {
      let finishOld!: (value: unknown) => void;
      const resolve = vi
        .fn()
        .mockResolvedValueOnce(authorized)
        .mockReturnValueOnce(new Promise((done) => (finishOld = done)))
        .mockResolvedValue({ checkedAt: new Date(), status: 'REVOKED' });
      const { service, advance } = await cached(resolve);
      await service.getSession('session');
      advance(16_000);
      const oldRead = service.getSession('session'); // starts before the revocation
      await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
      advance(1);
      await runWithAuthorizationFreshness(true, () => service.requireSession('session'));
      finishOld(authorized);
      await oldRead;
      expect(await service.getSession('session')).toMatchObject({ authorizationReady: false });
    });

    it('never caches unavailable results, and sign-out forgets the wallet', async () => {
      const resolve = vi
        .fn()
        .mockResolvedValueOnce({ checkedAt: new Date(), status: 'UNAVAILABLE' })
        .mockResolvedValue(authorized);
      const { service } = await cached(resolve);
      await service.getSession('session');
      await service.getSession('session');
      expect(resolve).toHaveBeenCalledTimes(2);
      service.forgetAuthorization(address);
      await service.getSession('session');
      expect(resolve).toHaveBeenCalledTimes(3);
    });
  });
  it('distinguishes unavailable chain checks from denied permission', () => {
    expect(() =>
      assertAuthorizationAvailable({
        authenticated: true,
        authorizationStatus: 'UNAVAILABLE',
      } as any),
    ).toThrow('blockchain provider');
    try {
      assertAuthorizationAvailable({ onChainAuthorization: { status: 'UNAVAILABLE' } } as any);
    } catch (error) {
      expect(error).toMatchObject({ status: 503, code: 'BLOCKCHAIN_AUTHORIZATION_UNAVAILABLE' });
    }
    expect(() =>
      assertAuthorizationAvailable({
        authenticated: true,
        authorizationStatus: 'SUSPENDED',
      } as any),
    ).not.toThrow();
  });
});
