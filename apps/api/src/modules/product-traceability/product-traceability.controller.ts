import type { NextFunction, Request, Response } from 'express';

import {
  ProductTraceabilityApiError,
  ProductTraceabilityService,
} from './product-traceability.service.js';

export class ProductTraceabilityController {
  constructor(
    private readonly service: ProductTraceabilityService,
    private readonly sessionCookieName: string,
  ) {}

  resolve = async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.json(
        await this.service.resolve(
          request.cookies?.[this.sessionCookieName] as string | undefined,
          request.body,
        ),
      );
    } catch (error) {
      if (error instanceof ProductTraceabilityApiError) {
        response.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      next(error);
    }
  };
}
