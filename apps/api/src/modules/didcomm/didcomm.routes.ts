import { Router } from 'express';
import { z } from 'zod';
import type { DidCommService } from './didcomm.service.js';
import { DidCommError } from './didcomm.service.js';

export function createDidCommRouter(service: DidCommService, cookieName: string) {
  const router = Router();
  const run =
    (handler: (sessionId: string | undefined, body: unknown) => Promise<unknown>) =>
    async (request: any, response: any, next: any) => {
      try {
        response.setHeader('Cache-Control', 'no-store');
        response.json(await handler(request.cookies?.[cookieName], request.body));
      } catch (error) {
        if (error instanceof DidCommError) {
          response
            .status(error.status)
            .json({ error: { code: error.code, message: error.message } });
          return;
        }
        if (error instanceof z.ZodError) {
          response
            .status(400)
            .json({ error: { code: 'INVALID_REQUEST', message: error.issues[0]?.message } });
          return;
        }
        next(error);
      }
    };
  router.post(
    '/binding/challenge',
    run((session) => service.challenge(session)),
  );
  router.post(
    '/binding',
    run((session, body) =>
      service.bind(session, z.object({ proof: z.string().min(20).max(20_000) }).parse(body).proof),
    ),
  );
  router.get(
    '/directory',
    run((session) => service.directory(session)),
  );
  router.get(
    '/mailbox',
    run((session) => service.mailbox(session)),
  );
  return router;
}
