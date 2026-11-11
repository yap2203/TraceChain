import type { VerifiablePresentation } from '@veramo/core';

import type { TraceChainAgent } from '../agent/tracechain-agent.js';
import type { IngredientCredential } from '../credentials/ingredient-credential.js';
import {
  hashIngredientCredential,
  verifyIngredientCredential,
} from '../credentials/ingredient-credential.service.js';

interface IngredientEvidenceBinding {
  batchId: string;
  challenge: string;
  credentialHash: string;
  credentialId: string;
  domain: string;
  expiresAt: string;
  issuedAt: string;
  purpose: string;
  requestId: string;
  requesterWallet: string;
  supplierWallet: string;
  verifierWallet: string;
  version: 1;
}

export interface CreateIngredientEvidencePresentationInput {
  batchId: string;
  challenge: string;
  credential: IngredientCredential;
  domain: string;
  expirationDate: Date;
  holderDid: string;
  issuedAt?: Date;
  purpose: string;
  requestId: string;
  supplierWallet: string;
  verifier: string;
}

export async function createIngredientEvidencePresentation(
  agent: TraceChainAgent,
  input: CreateIngredientEvidencePresentationInput,
) {
  const issuedAt = input.issuedAt ?? new Date();
  const binding: IngredientEvidenceBinding = {
    batchId: input.batchId,
    challenge: input.challenge,
    credentialHash: `0x${hashIngredientCredential(input.credential)}`,
    credentialId: input.credential.id,
    domain: input.domain,
    expiresAt: input.expirationDate.toISOString(),
    issuedAt: issuedAt.toISOString(),
    purpose: input.purpose,
    requestId: input.requestId,
    requesterWallet: input.verifier,
    supplierWallet: input.supplierWallet,
    verifierWallet: input.verifier,
    version: 1,
  };
  return agent.createVerifiablePresentation({
    challenge: input.challenge,
    domain: input.domain,
    presentation: {
      expirationDate: input.expirationDate.toISOString(),
      holder: input.holderDid,
      issuanceDate: issuedAt.toISOString(),
      tracechainEvidenceBinding: binding,
      type: ['VerifiablePresentation', 'TraceChainIngredientEvidencePresentation'],
      verifiableCredential: [input.credential],
    } as never,
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
    issuanceDate?: string;
    tracechainEvidenceBinding?: Partial<IngredientEvidenceBinding>;
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
  const binding = presentation.tracechainEvidenceBinding;
  const issuedAt = presentation.issuanceDate ? new Date(presentation.issuanceDate) : undefined;
  if (
    !presentation.expirationDate ||
    new Date(presentation.expirationDate).getTime() <= now.getTime()
  ) {
    return { reasons: ['PRESENTATION_EXPIRED'] as const, verified: false };
  }
  if (!issuedAt || Number.isNaN(issuedAt.getTime()) || issuedAt.getTime() > now.getTime()) {
    return { reasons: ['INVALID_PRESENTATION_ISSUED_AT'] as const, verified: false };
  }

  const credential = credentials[0] as IngredientCredential;
  const credentialHash = `0x${hashIngredientCredential(credential)}`;
  if (
    !binding ||
    binding.version !== 1 ||
    binding.requestId !== input.requestId ||
    !sameText(binding.batchId, input.batchId) ||
    binding.challenge !== input.challenge ||
    binding.domain !== input.domain ||
    binding.purpose !== input.purpose ||
    !sameText(binding.requesterWallet, input.verifier) ||
    !sameText(binding.verifierWallet, input.verifier) ||
    !sameText(binding.supplierWallet, input.supplierWallet) ||
    binding.credentialId !== credential.id ||
    !sameText(binding.credentialHash, credentialHash) ||
    binding.issuedAt !== presentation.issuanceDate ||
    binding.expiresAt !== presentation.expirationDate
  ) {
    return { reasons: ['PRESENTATION_CONTEXT_MISMATCH'] as const, verified: false };
  }

  try {
    const presentationVerification = await agent.verifyPresentation({
      challenge: input.challenge,
      domain: input.domain,
      presentation: presentationInput as VerifiablePresentation,
      policies: { now: now.getTime() / 1_000 },
    });
    if (!presentationVerification.verified) {
      return { reasons: ['INVALID_PRESENTATION_SIGNATURE'] as const, verified: false };
    }
  } catch {
    return { reasons: ['INVALID_PRESENTATION_SIGNATURE'] as const, verified: false };
  }

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

function sameText(value: unknown, expected: string) {
  return typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
}
