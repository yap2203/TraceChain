import { createHash } from 'node:crypto';
import {
  hashCompanyRoleCredential,
  hashIngredientCredential,
  readIngredientSdJwtClaims,
} from '@tracechain/ssi';
import type { CredentialContentStore } from './encrypted-credential.store.js';
export interface PinnedCredentialReference {
  cid: string;
  hash: string;
  wallet: string;
  kind: 'company' | 'ingredient';
}
export async function checkPinnedCredentials(
  store: CredentialContentStore,
  records: PinnedCredentialReference[],
) {
  if (!store.retrieveAndDecrypt) throw new Error('IPFS retrieval is not configured.');
  let checked = 0,
    skipped = 0;
  for (const record of records) {
    if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/.test(record.cid)) {
      skipped++;
      continue;
    }
    const payload = JSON.parse(await store.retrieveAndDecrypt(record.cid));
    const sd = record.kind === 'ingredient' && payload.credentialFormat === 'SD_JWT_VC';
    const credential = record.kind === 'company' ? payload : payload.credential;
    const hash = sd
      ? createHash('sha256').update(payload.sdJwt).digest('hex')
      : record.kind === 'company'
        ? hashCompanyRoleCredential(credential)
        : hashIngredientCredential(credential);
    const subject = sd
      ? (await readIngredientSdJwtClaims(payload.sdJwt)).supplierWallet
      : record.kind === 'company'
        ? credential.credentialSubject.walletAddress
        : credential.credentialSubject.supplierWallet;
    if (
      hash.toLowerCase() !== record.hash.replace(/^0x/, '').toLowerCase() ||
      String(subject).toLowerCase() !== record.wallet.toLowerCase()
    )
      throw new Error(
        'Pinned credential integrity or wallet binding did not match the recorded reference.',
      );
    checked++;
  }
  return { checked, skipped, status: checked ? 'PASSED' : 'NOT_TESTED' };
}
