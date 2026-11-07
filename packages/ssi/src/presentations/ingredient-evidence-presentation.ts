import type { VerifiablePresentation } from '@veramo/core';

import type { TraceChainAgent } from '../agent/tracechain-agent.js';
import type { IngredientCredential } from '../credentials/ingredient-credential.js';
import { verifyIngredientCredential } from '../credentials/ingredient-credential.service.js';

export interface CreateIngredientEvidencePresentationInput {
  batchId: string;
  challenge: string;
  credential: IngredientCredential;
  domain: string;
  expirationDate: Date;
  holderDid: string;
  purpose: string;
  requestId: string;
  verifier: string;
}

export async function createIngredientEvidencePresentation(
  agent: TraceChainAgent,
  input: CreateIngredientEvidencePresentationInput,
) {
  return agent.createVerifiablePresentation({
    challenge: input.challenge,
    presentation: {
      expirationDate: input.expirationDate.toISOString(),
      holder: input.holderDid,
      type: ['VerifiablePresentation', 'TraceChainIngredientEvidencePresentation'],
      verifiableCredential: [input.credential],
    },
    proofFormat: 'jwt',
  });
}

export async function verifyIngredientEvidencePresentation(
  agent: TraceChainAgent,
  presentationInput: unknown,
  input: {
    batchId: string;
    challenge: string;
    domain: string;
    expectedIssuerDid: string;
    now?: Date;
    purpose: string;
    requestId: string;
    supplierWallet: string;
    verifier: string;
  },
) {
  const presentation = presentationInput as Partial<VerifiablePresentation> & {
    expirationDate?: string;
  };
  const credentials = presentation?.verifiableCredential;
  if (
    !presentation ||
    presentation.holder !== input.expectedIssuerDid ||
    !Array.isArray(credentials) ||
    credentials.length !== 1
  ) {
    return { reasons: ['MALFORMED_PRESENTATION'] as const, verified: false };
  }
  const now = input.now ?? new Date();
  if (
    !presentation.expirationDate ||
    new Date(presentation.expirationDate).getTime() <= now.getTime()
  ) {
    return { reasons: ['PRESENTATION_EXPIRED'] as const, verified: false };
  }

  try {
    const presentationVerification = await agent.verifyPresentation({
      challenge: input.challenge,
      presentation: presentationInput as VerifiablePresentation,
      policies: { now: now.getTime() / 1_000 },
    });
    if (!presentationVerification.verified) {
      return { reasons: ['INVALID_PRESENTATION_SIGNATURE'] as const, verified: false };
    }
  } catch {
    return { reasons: ['INVALID_PRESENTATION_SIGNATURE'] as const, verified: false };
  }

  const credential = credentials[0] as IngredientCredential;
  const credentialVerification = await verifyIngredientCredential(
    agent,
    credential,
    input.supplierWallet,
    input.expectedIssuerDid,
    now,
  );
  if (!credentialVerification.verified) {
    return {
      reasons: credentialVerification.reasons,
      verified: false as const,
    };
  }

  return {
    credential,
    credentialHash: credentialVerification.credentialHash,
    reasons: [] as string[],
    verified: true as const,
  };
}
