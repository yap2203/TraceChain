import { describe, expect, it, vi } from 'vitest';
import { CompanyRole } from '@tracechain/shared';
import { AuthService, assertAuthorizationAvailable } from './auth.service.js';
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
