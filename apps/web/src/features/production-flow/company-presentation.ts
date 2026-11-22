import type { CompanyIdentityProofMaterial } from './production-flow.api';
import { createWalletPresentation } from './wallet-presentation';
import { submitProductionTransaction } from './production-flow.transaction';
import {
  getActiveMessagingAgent,
  createSelectiveCompanyIdentityPresentation,
  createCompanyIdentityPresentation,
} from '../didcomm/didcomm-agent';

/** Called only by an explicit sharing approval, after preview. */
export async function signCompanyPresentation(
  material: CompanyIdentityProofMaterial,
  claims: string[],
) {
  if (material.walletContext && material.sdJwt) {
    const presentation = await createWalletPresentation(
      material.sdJwt,
      claims,
      material.walletContext,
    );
    if (material.bindingTransaction)
      await submitProductionTransaction(material.bindingTransaction, material.walletContext.holder);
    return presentation;
  }
  const holder = getActiveMessagingAgent();
  if (!holder || holder.did !== material.holderDid)
    throw new Error(
      'This legacy presentation requires its original holder key, or an issuer-authorized replacement.',
    );
  return material.sdJwt
    ? createSelectiveCompanyIdentityPresentation(holder, material.sdJwt, {
        audience: material.audience,
        nonce: material.challenge,
        claims,
      })
    : createCompanyIdentityPresentation(holder, material);
}
