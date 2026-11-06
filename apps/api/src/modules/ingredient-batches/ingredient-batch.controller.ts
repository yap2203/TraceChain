import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { AuthError } from '../auth/auth.service.js';
import { ingredientBatchRequestSchema } from './ingredient-batch.schema.js';
import { IngredientBatchApiError, IngredientBatchService } from './ingredient-batch.service.js';

export class IngredientBatchController {
  constructor(
    private readonly service: IngredientBatchService,
    private readonly sessionCookieName: string,
  ) {}

  prepare = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = ingredientBatchRequestSchema.parse(request.body);
      response.json(await this.service.prepare(this.session(request), input));
    } catch (error) {
      this.handle(error, response, next);
    }
  };

  list = async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.json(await this.service.list(this.session(request)));
    } catch (error) {
      this.handle(error, response, next);
    }
  };

  private session(request: Request) {
    return request.cookies?.[this.sessionCookieName] as string | undefined;
  }

  private handle(error: unknown, response: Response, next: NextFunction) {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: error.issues[0]?.message ?? 'Invalid request.' },
      });
      return;
    }
    if (error instanceof AuthError || error instanceof IngredientBatchApiError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    next(error);
  }
}
