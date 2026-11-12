import type { NextFunction, Request, Response } from 'express';

import { AuthError } from '../auth/auth.service.js';
import { IngredientBatchApiError } from '../ingredient-batches/ingredient-batch.service.js';
import {
  DocumentExtractionApiError,
  DocumentExtractionService,
} from './document-extraction.service.js';

export class DocumentExtractionController {
  constructor(
    private readonly service: DocumentExtractionService,
    private readonly sessionCookieName: string,
  ) {}

  extract = async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.file) {
        response.status(400).json({
          error: { code: 'DOCUMENT_REQUIRED', message: 'Choose one document to extract.' },
        });
        return;
      }
      response.json(
        await this.service.extract(
          request.cookies?.[this.sessionCookieName] as string | undefined,
          {
            buffer: request.file.buffer,
            mimeType: request.file.mimetype,
            originalName: request.file.originalname,
            size: request.file.size,
          },
        ),
      );
    } catch (error) {
      if (
        error instanceof AuthError ||
        error instanceof IngredientBatchApiError ||
        error instanceof DocumentExtractionApiError
      ) {
        response.status(error.status).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }
      next(error);
    }
  };
}
