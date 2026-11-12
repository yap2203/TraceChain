import { Router } from 'express';
import multer, { MulterError } from 'multer';

import { MAX_DOCUMENT_SIZE } from './document-extraction.schema.js';
import type { DocumentExtractionController } from './document-extraction.controller.js';

export function createDocumentExtractionRouter(controller: DocumentExtractionController) {
  const router = Router();
  const upload = multer({
    limits: { fields: 0, fileSize: MAX_DOCUMENT_SIZE, files: 1 },
    storage: multer.memoryStorage(),
  });
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.post('/extract-document', (request, response, next) => {
    upload.single('document')(request, response, (error: unknown) => {
      if (error instanceof MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          response.status(413).json({
            error: {
              code: 'DOCUMENT_TOO_LARGE',
              message: 'Documents must not exceed 10 MB.',
            },
          });
          return;
        }
        response.status(400).json({
          error: { code: 'INVALID_DOCUMENT_UPLOAD', message: 'Upload exactly one document.' },
        });
        return;
      }
      if (error) {
        next(error);
        return;
      }
      void controller.extract(request, response, next);
    });
  });
  return router;
}
