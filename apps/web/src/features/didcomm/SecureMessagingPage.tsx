import { Download, LockKeyhole, RefreshCw, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IDIDCommMessage } from '@veramo/did-comm';
import {
  createBindingProof,
  createMessagingAgent,
  exportRecoveryKit,
  getActiveMessagingAgent,
  importRecoveryKit,
  packMessage,
  setActiveMessagingAgent,
  unpackMessage,
  type HolderMessagingAgent,
} from './didcomm-agent';
import {
  didCommApi,
  COMPANY_IDENTITY_DECLINED_TYPE,
  COMPANY_IDENTITY_PRESENTATION_TYPE,
  COMPANY_IDENTITY_REQUEST_TYPE,
  EVIDENCE_ACK_TYPE,
  EVIDENCE_PRESENTATION_TYPE,
  EVIDENCE_REQUEST_TYPE,
  type MessagingIdentity,
  type RelayEnvelope,
} from './didcomm.api';
import { prepareEvidenceAcceptance, verifyEvidence } from '../production-flow/production-flow.api';
import { completePreparedWorkflow } from '../production-flow/production-flow.transaction';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  FormField,
  Input,
  SectionTitle,
  T,
  Textarea,
} from '../workspaces/shared/ui';

interface MessageBody {
  businessReference: string;
  ingredientBatchReference?: string;
  reason: string;
  requestedClaims: string[];
  senderCompany: string;
  recipientCompany: string;
  acknowledgement?: string;
  presentation?: unknown;
  requestId?: string;
}
interface OpenedMessage {
  body: MessageBody;
  record: RelayEnvelope;
}

export function SecureMessagingPage({ role }: { role: 'manufacturer' | 'supplier' }) {
  const [holder, setHolder] = useState<HolderMessagingAgent | undefined>(getActiveMessagingAgent());
  const [identity, setIdentity] = useState<MessagingIdentity>();
  const [directory, setDirectory] = useState<MessagingIdentity[]>([]);
  const [envelopes, setEnvelopes] = useState<RelayEnvelope[]>([]);
  const [opened, setOpened] = useState<OpenedMessage[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const seen = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    const [mailbox, identities] = await Promise.all([didCommApi.mailbox(), didCommApi.directory()]);
    setIdentity(mailbox.identity);
    setEnvelopes(mailbox.envelopes);
    setDirectory(identities);
  }, []);
  useEffect(() => {
    void refresh().catch((cause) => setError(message(cause)));
  }, [refresh]);

  const initialize = async () =>
    run(async () => {
      const next = setActiveMessagingAgent(await createMessagingAgent());
      const challenge = await didCommApi.challenge();
      const bound = await didCommApi.bind(await createBindingProof(next, challenge));
      setHolder(next);
      setIdentity(bound);
      setNotice(
        'Messaging identity created and bound to this SIWE wallet. Download a recovery kit now.',
      );
      await refresh();
    });
  const restore = async (file: File) =>
    run(async () => {
      const next = await importRecoveryKit(await file.text(), password);
      if (identity && next.did !== identity.did)
        throw new Error(
          'This recovery kit does not match the messaging DID bound to the signed-in company.',
        );
      setActiveMessagingAgent(next);
      setHolder(next);
      setNotice('Messaging key restored in this browser session.');
    });
  const backup = async () =>
    run(async () => {
      if (!holder) throw new Error('Create or restore the messaging key first.');
      download('tracechain-didcomm-recovery-kit.json', await exportRecoveryKit(holder, password));
      setNotice('Encrypted recovery kit downloaded. TraceChain cannot recover it or its password.');
    });
  const decrypt = async (record: RelayEnvelope) =>
    run(async () => {
      if (!holder || holder.did !== identity?.did)
        throw new Error('Restore the private messaging key for this identity first.');
      if (seen.current.has(record.id))
        throw new Error('This message was already decrypted in this session.');
      if (record.toDid !== holder.did)
        throw new Error('This envelope is not addressed to this messaging identity.');
      const unpacked = await unpackMessage(holder, record.envelope);
      const body = unpacked.body as unknown as MessageBody;
      if (
        unpacked.id !== record.id ||
        unpacked.from !== record.fromDid ||
        !unpacked.to?.includes(record.toDid) ||
        unpacked.type !== record.messageType ||
        unpacked.thid !== record.threadId ||
        unpacked.pthid !== record.parentThreadId ||
        Number(unpacked.created_time ?? 0) !== Math.floor(Date.parse(record.createdAt) / 1000) ||
        Number(unpacked.expires_time ?? 0) !== Math.floor(Date.parse(record.expiresAt) / 1000) ||
        body.businessReference !== record.businessReference ||
        body.ingredientBatchReference !== record.ingredientBatchReference
      )
        throw new Error('Envelope metadata does not match the authenticated DIDComm message.');
      if (Number(unpacked.expires_time ?? 0) * 1000 <= Date.now())
        throw new Error('This encrypted message has expired.');
      seen.current.add(record.id);
      setOpened((items) => [
        ...items.filter((item) => item.record.id !== record.id),
        { body, record },
      ]);
    });
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionTitle
        title="Secure evidence messaging"
        sub="Browser-held DIDComm v2 authenticated encryption proof of concept"
        action={
          <Btn size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw size={14} /> Refresh
          </Btn>
        }
      />
      <Alert
        type="info"
        message="MetaMask + SIWE remains the login. Your separate messaging private key stays in browser memory and the encrypted recovery kit. The API stores ciphertext and visible routing metadata only."
      />
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, color: T.navy, marginBottom: 10 }}>Messaging identity</div>
        {identity ? (
          <>
            <div style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{identity.did}</div>
            <Badge
              label={
                holder?.did === identity.did
                  ? 'Key available this session'
                  : 'Restore key to decrypt'
              }
              variant={holder?.did === identity.did ? 'verified' : 'pending'}
            />
          </>
        ) : (
          <Btn disabled={busy} onClick={() => void initialize()}>
            <LockKeyhole size={15} /> Create messaging identity
          </Btn>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Input
            label="Recovery password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 10 characters"
          />
          <div style={{ alignSelf: 'end', display: 'flex', gap: 8 }}>
            <Btn
              size="sm"
              variant="outline"
              disabled={!holder || password.length < 10}
              onClick={() => void backup()}
            >
              <Download size={14} /> Download recovery kit
            </Btn>
            <Btn
              size="sm"
              variant="outline"
              disabled={password.length < 10}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={14} /> Restore kit
            </Btn>
          </div>
          <input
            ref={fileRef}
            hidden
            type="file"
            accept="application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void restore(file);
              event.target.value = '';
            }}
          />
        </div>
      </Card>
      {role === 'manufacturer' && identity && holder?.did === identity.did && (
        <ComposeRequest
          holder={holder}
          sender={identity}
          suppliers={directory.filter((item) => item.role === 'SUPPLIER')}
          onSent={async () => {
            setNotice('Encrypted evidence request relayed to the Supplier.');
            await refresh();
          }}
          onError={setError}
        />
      )}
      <Card>
        <div style={{ fontWeight: 700, color: T.navy, marginBottom: 12 }}>Encrypted mailbox</div>
        {envelopes.filter((item) => item.toDid === identity?.did).length === 0 ? (
          <EmptyState
            icon={<LockKeyhole size={40} />}
            title="No encrypted messages"
            sub="Messages addressed to this verified messaging DID will appear here."
          />
        ) : (
          envelopes
            .filter((item) => item.toDid === identity?.did)
            .map((record) => (
              <div
                key={record.id}
                style={{ borderTop: `1px solid ${T.border}`, padding: '12px 0' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <strong>
                      {messageTitle(record.messageType)}
                    </strong>
                    <div style={{ fontSize: 11, color: T.text2 }}>
                      Reference: {record.businessReference} · Expires{' '}
                      {new Date(record.expiresAt).toLocaleString()}
                    </div>
                  </div>
                  <Btn
                    size="xs"
                    disabled={busy || seen.current.has(record.id)}
                    onClick={() => void decrypt(record)}
                  >
                    {seen.current.has(record.id) ? 'Opened' : 'Decrypt & review'}
                  </Btn>
                </div>
                {opened
                  .filter((item) => item.record.id === record.id)
                  .map((item) => (
                    <Opened
                      key={record.id}
                      item={item}
                      holder={holder!}
                      identity={identity!}
                      directory={directory}
                      onSent={async () => {
                        setNotice('Encrypted acknowledgement relayed to the Manufacturer.');
                        await refresh();
                      }}
                      onError={setError}
                    />
                  ))}
              </div>
            ))
        )}
      </Card>
      <Alert
        type="warning"
        message="DIDComm encrypts message content, but routing metadata remains visible to TraceChain. It does not verify credential claims and cannot protect a compromised browser, malicious frontend code, or a participant who copies decrypted content."
      />
    </div>
  );
}

function ComposeRequest({
  holder,
  sender,
  suppliers,
  onSent,
  onError,
}: {
  holder: HolderMessagingAgent;
  sender: MessagingIdentity;
  suppliers: MessagingIdentity[];
  onSent: () => Promise<void>;
  onError: (value: string) => void;
}) {
  const [recipient, setRecipient] = useState('');
  const [business, setBusiness] = useState('');
  const [batch, setBatch] = useState('');
  const [claims, setClaims] = useState('origin, quantity');
  const [reason, setReason] = useState('');
  const [approved, setApproved] = useState(false);
  const send = async () => {
    try {
      const target = suppliers.find((item) => item.did === recipient);
      if (!target || !approved) throw new Error('Select a verified Supplier and approve sending.');
      const id = crypto.randomUUID();
      const now = new Date();
      const expires = new Date(now.getTime() + 60 * 60_000);
      const body: MessageBody = {
        businessReference: business,
        ingredientBatchReference: batch || undefined,
        reason,
        requestedClaims: claims
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        senderCompany: sender.companyName,
        recipientCompany: target.companyName,
      };
      const message: IDIDCommMessage = {
        id,
        type: EVIDENCE_REQUEST_TYPE,
        from: sender.did,
        to: [target.did],
        thid: id,
        created_time: Math.floor(now.getTime() / 1000),
        expires_time: Math.floor(expires.getTime() / 1000),
        body,
      };
      const envelope = await packMessage(holder, message);
      await didCommApi.relay({
        businessReference: business,
        createdAt: now.toISOString(),
        envelope,
        expiresAt: expires.toISOString(),
        fromDid: sender.did,
        id,
        ingredientBatchReference: batch || undefined,
        messageType: EVIDENCE_REQUEST_TYPE,
        threadId: id,
        toDid: target.did,
      });
      await onSent();
    } catch (cause) {
      onError(message(cause));
    }
  };
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, color: T.navy, marginBottom: 12 }}>
        Send encrypted evidence request
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        <FormField label="Verified Supplier">
          <select value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            <option value="">Select Supplier</option>
            {suppliers.map((item) => (
              <option key={item.did} value={item.did}>
                {item.companyName}
              </option>
            ))}
          </select>
        </FormField>
        <Input label="Business request reference" value={business} onChange={setBusiness} />
        <Input label="Ingredient batch reference" value={batch} onChange={setBatch} />
        <Input label="Requested claim names" value={claims} onChange={setClaims} />
        <Textarea label="Purpose / reason" value={reason} onChange={setReason} rows={3} />
        <label style={{ fontSize: 12 }}>
          <input
            type="checkbox"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />{' '}
          I approve sending this business information to the selected Supplier.
        </label>
        <Btn disabled={!recipient || !business || !reason || !approved} onClick={() => void send()}>
          Encrypt and send
        </Btn>
      </div>
    </Card>
  );
}

function Opened({
  item,
  holder,
  identity,
  directory,
  onSent,
  onError,
}: {
  item: OpenedMessage;
  holder: HolderMessagingAgent;
  identity: MessagingIdentity;
  directory: MessagingIdentity[];
  onSent: () => Promise<void>;
  onError: (value: string) => void;
}) {
  const [ack, setAck] = useState('Request received and will be reviewed.');
  const [verification, setVerification] = useState('');
  const sender = directory.find((value) => value.did === item.record.fromDid);
  const sendAck = async () => {
    try {
      if (!sender) throw new Error('The sender no longer has a verified messaging identity.');
      const id = crypto.randomUUID();
      const now = new Date();
      const expires = new Date(now.getTime() + 60 * 60_000);
      const body: MessageBody = {
        ...item.body,
        acknowledgement: ack,
        senderCompany: identity.companyName,
        recipientCompany: sender.companyName,
      };
      const message: IDIDCommMessage = {
        id,
        type: EVIDENCE_ACK_TYPE,
        from: identity.did,
        to: [sender.did],
        thid: item.record.threadId,
        pthid: item.record.id,
        created_time: Math.floor(now.getTime() / 1000),
        expires_time: Math.floor(expires.getTime() / 1000),
        body,
      };
      await didCommApi.relay({
        businessReference: item.record.businessReference,
        createdAt: now.toISOString(),
        envelope: await packMessage(holder, message),
        expiresAt: expires.toISOString(),
        fromDid: identity.did,
        id,
        ingredientBatchReference: item.record.ingredientBatchReference,
        messageType: EVIDENCE_ACK_TYPE,
        parentThreadId: item.record.id,
        threadId: item.record.threadId,
        toDid: sender.did,
      });
      await onSent();
    } catch (cause) {
      onError(message(cause));
    }

  };
  const verifyPresentation = async () => {
    try {
      const result = await verifyEvidence(item.body.requestId ?? item.record.businessReference);
      setVerification(`Verification passed at ${new Date(result.verifiedAt).toLocaleString()}.`);
    } catch (cause) {
      onError(message(cause));
    }

  };
  const acceptPresentation = async () => {
    try {
      await completePreparedWorkflow(() =>
        prepareEvidenceAcceptance(item.body.requestId ?? item.record.businessReference),
      );
      setVerification('Evidence accepted on chain after separate business approval.');
      await onSent();
    } catch (cause) {
      onError(message(cause));
    }
  };
  return (
    <div style={{ marginTop: 12, padding: 12, background: T.surface2, borderRadius: 8 }}>
      <div>
        <b>Actual sender:</b> {sender?.companyName ?? item.body.senderCompany}
      </div>
      <div>
        <b>Purpose:</b> {item.body.reason}
      </div>
      <div>
        <b>Requested claims:</b> {item.body.requestedClaims.join(', ')}
      </div>
      <div>
        <b>Ingredient:</b> {item.body.ingredientBatchReference || 'Not specified'}
      </div>
      {item.record.messageType === EVIDENCE_REQUEST_TYPE && (
        <div style={{ marginTop: 10 }}>
          <Textarea label="Encrypted acknowledgement" value={ack} onChange={setAck} rows={2} />
          <Btn size="sm" onClick={() => void sendAck()}>
            Encrypt acknowledgement
          </Btn>
        </div>
      )}
      {item.body.acknowledgement && (
        <div>
          <b>Acknowledgement:</b> {item.body.acknowledgement}
        </div>
      )}
      {item.record.messageType === EVIDENCE_PRESENTATION_TYPE && (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <div>
            <b>
              {typeof item.body.presentation === 'string'
                ? 'Received selective Ingredient presentation:'
                : 'Disclosed full Ingredient Credential:'}
            </b>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11 }}>
              {typeof item.body.presentation === 'string'
                ? 'Open Ingredient Evidence to view only the disclosed claims and verify them.'
                : JSON.stringify(disclosedClaims(item.body.presentation), null, 2)}
            </pre>
          </div>
          <Alert
            type="warning"
            message="DIDComm decryption authenticates transport only. Verify the VP and credential before making a separate business decision."
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn size="sm" onClick={() => void verifyPresentation()}>
              Verify evidence
            </Btn>
            <Btn
              size="sm"
              disabled={!verification.startsWith('Verification passed')}
              onClick={() => void acceptPresentation()}
            >
              Accept evidence
            </Btn>
          </div>
          {verification && <Alert type="info" message={verification} />}
        </div>
      )}
    </div>
  );
}
function disclosedClaims(presentation: unknown) {
  const candidate = presentation as {
    verifiableCredential?: Array<{ credentialSubject?: unknown }>;
  };
  return candidate?.verifiableCredential?.[0]?.credentialSubject ?? 'Unavailable';
}
function messageTitle(messageType: string) {
  switch (messageType) {
    case EVIDENCE_REQUEST_TYPE:
      return 'Ingredient evidence request';
    case COMPANY_IDENTITY_REQUEST_TYPE:
      return 'Company identity proof request';
    case COMPANY_IDENTITY_PRESENTATION_TYPE:
      return 'Company identity presentation';
    case COMPANY_IDENTITY_DECLINED_TYPE:
      return 'Company identity proof declined';
    default:
      return 'Encrypted acknowledgement';
  }
}
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Secure messaging failed.';
}
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
