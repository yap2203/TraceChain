import type { IDIDCommMessage } from '@veramo/did-comm';

import {
  didCommApi,
  COMPANY_IDENTITY_PRESENTATION_TYPE,
  COMPANY_IDENTITY_DECLINED_TYPE,
  COMPANY_IDENTITY_REQUEST_TYPE,
  EVIDENCE_PRESENTATION_TYPE,
  EVIDENCE_REQUEST_TYPE,
  type MessagingIdentity,
} from '../didcomm/didcomm.api';
import { getActiveMessagingAgent, packMessage } from '../didcomm/didcomm-agent';
import type { EvidenceDetails } from './production-flow.api';

function participant(directory: MessagingIdentity[], wallet: string) {
  return directory.find((item) => item.wallet.toLowerCase() === wallet.toLowerCase());
}

export async function sendCompanyIdentityRequestMessage(details: EvidenceDetails) {
  const holder = getActiveMessagingAgent();
  if (!holder)
    throw new Error('Restore the Supplier participant key before requesting identity proof.');
  const [{ identity, envelopes }, directory] = await Promise.all([
    didCommApi.mailbox(),
    didCommApi.directory(),
  ]);
  if (!identity || identity.did !== holder.did)
    throw new Error('The active key does not match the Supplier identity.');
  const recipient = participant(directory, details.requester);
  const original = envelopes.find(
    (item) =>
      item.businessReference.toLowerCase() === details.requestId.toLowerCase() &&
      item.toDid === holder.did &&
      item.messageType === EVIDENCE_REQUEST_TYPE,
  );
  if (!recipient || !original)
    throw new Error('The linked encrypted evidence-request thread is unavailable.');
  const id = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 15 * 60_000);
  const message: IDIDCommMessage = {
    id,
    type: COMPANY_IDENTITY_REQUEST_TYPE,
    from: holder.did,
    to: [recipient.did],
    thid: original.threadId,
    pthid: original.id,
    created_time: Math.floor(now.getTime() / 1000),
    expires_time: Math.floor(expires.getTime() / 1000),
    body: {
      businessReference: details.requestId,
      requestId: details.requestId,
      purpose: 'Confirm requester company identity before restricted ingredient disclosure',
      requestedClaims: ['Company Role Credential'],
      senderCompany: identity.companyName,
      recipientCompany: recipient.companyName,
    },
  };
  await didCommApi.relay({
    businessReference: details.requestId,
    createdAt: now.toISOString(),
    envelope: await packMessage(holder, message),
    expiresAt: expires.toISOString(),
    fromDid: holder.did,
    id,
    ingredientBatchReference: details.batchId,
    messageType: COMPANY_IDENTITY_REQUEST_TYPE,
    parentThreadId: original.id,
    threadId: original.threadId,
    toDid: recipient.did,
  });
}

export async function sendCompanyIdentityPresentationMessage(
  requestId: string,
  presentation: string,
) {
  const holder = getActiveMessagingAgent();
  if (!holder) throw new Error('Restore the requester participant key before presenting identity.');
  const [{ identity, envelopes }, directory] = await Promise.all([
    didCommApi.mailbox(),
    didCommApi.directory(),
  ]);
  if (!identity || identity.did !== holder.did)
    throw new Error('The active key does not match this company identity.');
  const identityRequest = envelopes.find(
    (item) =>
      item.businessReference.toLowerCase() === requestId.toLowerCase() &&
      item.toDid === holder.did &&
      item.messageType === COMPANY_IDENTITY_REQUEST_TYPE,
  );
  if (!identityRequest) throw new Error('The encrypted identity-proof request is unavailable.');
  const recipient = directory.find((item) => item.did === identityRequest.fromDid);
  if (!recipient) throw new Error('The requesting Supplier is no longer authorized.');
  const id = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 15 * 60_000);
  const message: IDIDCommMessage = {
    id,
    type: COMPANY_IDENTITY_PRESENTATION_TYPE,
    from: holder.did,
    to: [recipient.did],
    thid: identityRequest.threadId,
    pthid: identityRequest.id,
    created_time: Math.floor(now.getTime() / 1000),
    expires_time: Math.floor(expires.getTime() / 1000),
    body: {
      businessReference: requestId,
      requestId,
      presentation,
      purpose: 'Company identity proof',
      requestedClaims: ['Company Role Credential'],
      senderCompany: identity.companyName,
      recipientCompany: recipient.companyName,
    },
  };
  await didCommApi.relay({
    businessReference: requestId,
    createdAt: now.toISOString(),
    envelope: await packMessage(holder, message),
    expiresAt: expires.toISOString(),
    fromDid: holder.did,
    id,
    messageType: COMPANY_IDENTITY_PRESENTATION_TYPE,
    parentThreadId: identityRequest.id,
    threadId: identityRequest.threadId,
    toDid: recipient.did,
  });
}

export async function sendCompanyIdentityDeclineMessage(requestId: string) {
  const holder = getActiveMessagingAgent();
  if (!holder) throw new Error('Restore the requester participant key before declining identity.');
  const [{ identity, envelopes }, directory] = await Promise.all([
    didCommApi.mailbox(),
    didCommApi.directory(),
  ]);
  if (!identity || identity.did !== holder.did)
    throw new Error('The active key does not match this company identity.');
  const identityRequest = envelopes.find(
    (item) =>
      item.businessReference.toLowerCase() === requestId.toLowerCase() &&
      item.toDid === holder.did &&
      item.messageType === COMPANY_IDENTITY_REQUEST_TYPE,
  );
  if (!identityRequest) throw new Error('The encrypted identity-proof request is unavailable.');
  const recipient = directory.find((item) => item.did === identityRequest.fromDid);
  if (!recipient) throw new Error('The requesting Supplier is no longer authorized.');
  const id = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 15 * 60_000);
  const message: IDIDCommMessage = {
    id,
    type: COMPANY_IDENTITY_DECLINED_TYPE,
    from: holder.did,
    to: [recipient.did],
    thid: identityRequest.threadId,
    pthid: identityRequest.id,
    created_time: Math.floor(now.getTime() / 1000),
    expires_time: Math.floor(expires.getTime() / 1000),
    body: {
      businessReference: requestId,
      requestId,
      purpose: 'Company identity proof declined',
      senderCompany: identity.companyName,
      recipientCompany: recipient.companyName,
    },
  };
  await didCommApi.relay({
    businessReference: requestId,
    createdAt: now.toISOString(),
    envelope: await packMessage(holder, message),
    expiresAt: expires.toISOString(),
    fromDid: holder.did,
    id,
    messageType: COMPANY_IDENTITY_DECLINED_TYPE,
    parentThreadId: identityRequest.id,
    threadId: identityRequest.threadId,
    toDid: recipient.did,
  });
}

export async function sendEvidenceRequestMessage(details: EvidenceDetails) {
  const holder = getActiveMessagingAgent();
  if (!holder)
    throw new Error(
      'The request is recorded on chain, but its encrypted notification is pending. Restore your messaging key under Secure messages and retry delivery.',
    );
  const [{ identity }, directory] = await Promise.all([
    didCommApi.mailbox(),
    didCommApi.directory(),
  ]);
  if (!identity || identity.did !== holder.did)
    throw new Error('The active messaging key does not match this SIWE company identity.');
  const recipient = participant(directory, details.supplier);
  if (!recipient) throw new Error('The Supplier has no currently authorized messaging identity.');
  const id = crypto.randomUUID();
  const created = new Date();
  const expires = new Date(Math.min(details.dueAt * 1_000, created.getTime() + 24 * 60 * 60_000));
  const message: IDIDCommMessage = {
    id,
    type: EVIDENCE_REQUEST_TYPE,
    from: holder.did,
    to: [recipient.did],
    thid: details.requestId,
    created_time: Math.floor(created.getTime() / 1_000),
    expires_time: Math.floor(expires.getTime() / 1_000),
    body: {
      businessReference: details.requestId,
      batchId: details.batchId,
      claims: details.claims,
      dueAt: details.dueAt,
      ingredientBatchReference: details.batchId,
      purpose: details.reason,
      reason: details.reason,
      requestId: details.requestId,
      requestedClaims: details.claims,
      senderCompany: identity.companyName,
      recipientCompany: recipient.companyName,
    },
  };
  await didCommApi.relay({
    businessReference: details.requestId,
    createdAt: created.toISOString(),
    envelope: await packMessage(holder, message),
    expiresAt: expires.toISOString(),
    fromDid: holder.did,
    id,
    ingredientBatchReference: details.batchId,
    messageType: EVIDENCE_REQUEST_TYPE,
    threadId: details.requestId,
    toDid: recipient.did,
  });
}

export async function sendEvidencePresentationMessage(details: EvidenceDetails) {
  if (!details.presentation) throw new Error('The signed Ingredient presentation is unavailable.');
  const holder = getActiveMessagingAgent();
  if (!holder) throw new Error('Restore your messaging key under Secure messages before delivery.');
  const [{ identity, envelopes }, directory] = await Promise.all([
    didCommApi.mailbox(),
    didCommApi.directory(),
  ]);
  if (!identity || identity.did !== holder.did)
    throw new Error('The active messaging key does not match this SIWE company identity.');
  const recipient = participant(directory, details.requester);
  if (!recipient)
    throw new Error('The Manufacturer has no currently authorized messaging identity.');
  const original = envelopes.find(
    (item) =>
      item.businessReference.toLowerCase() === details.requestId.toLowerCase() &&
      item.toDid === holder.did &&
      item.messageType === EVIDENCE_REQUEST_TYPE,
  );
  if (!original)
    throw new Error('The encrypted original request is unavailable for thread correlation.');
  const id = crypto.randomUUID();
  const created = new Date();
  const expires = new Date(
    Math.min(details.presentationExpiresAt * 1_000, created.getTime() + 24 * 60 * 60_000),
  );
  const message: IDIDCommMessage = {
    id,
    type: EVIDENCE_PRESENTATION_TYPE,
    from: holder.did,
    to: [recipient.did],
    thid: original.threadId,
    pthid: original.id,
    created_time: Math.floor(created.getTime() / 1_000),
    expires_time: Math.floor(expires.getTime() / 1_000),
    body: {
      businessReference: details.requestId,
      batchId: details.batchId,
      ingredientBatchReference: details.batchId,
      presentation: details.presentation,
      purpose: details.reason,
      reason: details.reason,
      requestId: details.requestId,
      requestedClaims: details.claims,
      senderCompany: identity.companyName,
      recipientCompany: recipient.companyName,
    },
  };
  await didCommApi.relay({
    businessReference: details.requestId,
    createdAt: created.toISOString(),
    envelope: await packMessage(holder, message),
    expiresAt: expires.toISOString(),
    fromDid: holder.did,
    id,
    ingredientBatchReference: details.batchId,
    messageType: EVIDENCE_PRESENTATION_TYPE,
    parentThreadId: original.id,
    threadId: original.threadId,
    toDid: recipient.did,
  });
}
