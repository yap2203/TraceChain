import {
  COMPANY_IDENTITY_DECLINED_TYPE,
  COMPANY_IDENTITY_PRESENTATION_TYPE,
  COMPANY_IDENTITY_REQUEST_TYPE,
  didCommApi,
  EVIDENCE_PRESENTATION_TYPE,
  EVIDENCE_REQUEST_TYPE,
} from '../didcomm/didcomm.api';
import { getEvidenceDetails, type EvidenceDetails } from './production-flow.api';

const expiry = (maximum?: number) =>
  new Date(
    Math.min(maximum ?? Number.POSITIVE_INFINITY, Date.now() + 24 * 60 * 60_000),
  ).toISOString();

/** DIDComm encryption and routing are performed by company agents hosted by the API. */
export async function sendEvidenceRequestMessage(details: EvidenceDetails) {
  return didCommApi.send({
    body: {
      batchId: details.batchId,
      claims: details.claims,
      dueAt: details.dueAt,
      purpose: details.reason,
      requestId: details.requestId,
    },
    businessReference: details.requestId,
    expiresAt: expiry(details.dueAt * 1_000),
    ingredientBatchReference: details.batchId,
    messageType: EVIDENCE_REQUEST_TYPE,
    recipientWallet: details.supplier,
    threadId: details.requestId,
  });
}

export async function sendEvidencePresentationMessage(details: EvidenceDetails) {
  if (!details.presentation) throw new Error('The signed Ingredient presentation is unavailable.');
  return didCommApi.send({
    body: {
      batchId: details.batchId,
      claims: details.claims,
      presentation: details.presentation,
      purpose: details.reason,
      requestId: details.requestId,
    },
    businessReference: details.requestId,
    expiresAt: expiry(details.presentationExpiresAt * 1_000),
    ingredientBatchReference: details.batchId,
    messageType: EVIDENCE_PRESENTATION_TYPE,
    recipientWallet: details.requester,
    threadId: details.requestId,
  });
}

export async function sendCompanyIdentityRequestMessage(details: EvidenceDetails) {
  return didCommApi.send({
    body: {
      purpose: 'Confirm requester company identity before restricted ingredient disclosure',
      requestId: details.requestId,
      requestedClaims: ['Company Role Credential'],
    },
    businessReference: details.requestId,
    expiresAt: expiry(Date.now() + 15 * 60_000),
    ingredientBatchReference: details.batchId,
    messageType: COMPANY_IDENTITY_REQUEST_TYPE,
    recipientWallet: details.requester,
    threadId: details.requestId,
  });
}

export async function sendCompanyIdentityPresentationMessage(
  requestId: string,
  presentation: string,
) {
  const details = await getEvidenceDetails(requestId);
  return didCommApi.send({
    body: { presentation, purpose: 'Company identity proof', requestId },
    businessReference: requestId,
    expiresAt: expiry(Date.now() + 15 * 60_000),
    messageType: COMPANY_IDENTITY_PRESENTATION_TYPE,
    recipientWallet: details.supplier,
    threadId: requestId,
  });
}

export async function sendCompanyIdentityDeclineMessage(requestId: string) {
  const details = await getEvidenceDetails(requestId);
  return didCommApi.send({
    body: { purpose: 'Company identity proof declined', requestId },
    businessReference: requestId,
    expiresAt: expiry(Date.now() + 15 * 60_000),
    messageType: COMPANY_IDENTITY_DECLINED_TYPE,
    recipientWallet: details.supplier,
    threadId: requestId,
  });
}
