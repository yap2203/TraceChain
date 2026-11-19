import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ProductionFlowService } from './production-flow.service.js';
// Use the same valid image signature for the reference-gating unit tests; image parsing is covered separately.
const valid =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDfsAAAAASUVORK5CYII=';
it.each([
  'authorized',
  'not disclosed',
  'wrong hash',
  'wrong CID',
  'wrong entry',
  'expired',
  'supplier inactive',
  'verification failed',
])('gates recipient document access: %s', async (condition) => {
  const sha256 = createHash('sha256').update(Buffer.from(valid, 'base64')).digest('hex');
  const file = {
    id: 'document',
    cid: 'encrypted-cid',
    sha256,
    supplierWallet: 'supplier',
    certificationId: condition === 'wrong entry' ? 'another-entry' : 'entry',
    payload: { ciphertext: 'encrypted-file' },
  };
  const decrypt = vi
    .fn()
    .mockResolvedValue(
      JSON.stringify({ fileName: 'certificate.png', mimeType: 'image/png', data: valid }),
    );
  const service = new ProductionFlowService({
    clock: () => new Date(1000000),
    contentStore: { decrypt },
    ingredientRepository: { findAttachment: vi.fn().mockResolvedValue(file) },
    gateway: { isRoleAuthorized: vi.fn().mockResolvedValue(condition !== 'supplier inactive') },
  } as any);
  vi.spyOn(service, 'reviewEvidence').mockResolvedValue({
    sharedClaims:
      condition === 'not disclosed'
        ? {}
        : {
            certificationDocuments_entry: {
              certificationId: 'entry',
              documents: [
                {
                  id: 'document',
                  cid: condition === 'wrong CID' ? 'different' : file.cid,
                  sha256: condition === 'wrong hash' ? '0'.repeat(64) : sha256,
                },
              ],
            },
          },
  } as any);
  vi.spyOn(service as any, 'requireWorkflow').mockResolvedValue({ supplier: 'supplier' });
  vi.spyOn(service as any, 'requireChainRequest').mockResolvedValue({
    status: 2,
    presentationExpiresAt: condition === 'expired' ? 999 : 2000,
  });
  const verify = vi.spyOn(service as any, 'verifyPersistedPresentation');
  if (condition === 'verification failed')
    verify.mockRejectedValue(new Error('Signature verification failed.'));
  else verify.mockResolvedValue('credential');
  if (condition === 'authorized') {
    expect(await service.certificationDocument('session', 'request', 'document')).toEqual({
      fileName: 'certificate.png',
      mimeType: 'image/png',
      data: valid,
    });
    expect(verify).toHaveBeenCalledTimes(1);
  } else {
    await expect(
      service.certificationDocument('session', 'request', 'document'),
    ).rejects.toBeDefined();
    expect(decrypt).not.toHaveBeenCalled();
  }
});
