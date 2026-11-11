import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { targetChainId } from '../../config/chain';
import type { PreparedTransaction } from '../blockchain/blockchain.api';
import { submitProductionTransaction } from '../production-flow/production-flow.transaction';
import {
  getOrders,
  prepareOrder,
  orderIdentity,
  type OrdersState,
  type OrderRecord,
} from './orders.api';
import {
  Alert,
  Btn,
  Card,
  Input,
  SelectField,
  T,
  Table,
  TR,
  TD,
  Badge,
} from '../workspaces/shared/ui';
import { workspacePath } from '../workspaces/workspace-paths';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';
import {
  createCompanyIdentityPresentation,
  createSelectiveCompanyIdentityPresentation,
  getActiveMessagingAgent,
} from '../didcomm/didcomm-agent';
import { PresentationSigningSettingsLink } from '../didcomm/HolderSigningKeyPanel';
import { getEvidenceDetails, prepareEvidenceRequest } from '../production-flow/production-flow.api';
import { sendEvidenceRequestMessage } from '../production-flow/evidence-didcomm';

const short = (value?: string) =>
  value ? `${value.slice(0, 10)}…${value.slice(-6)}` : 'Unavailable';
const same = (a: string, b: string) => a?.toLowerCase() === b?.toLowerCase();
const timestamp = (value: string | number) =>
  Number(value) ? new Date(Number(value) * 1000).toLocaleString() : 'Not recorded';
const now = () => Math.floor(Date.now() / 1000);
export function OrdersPage({
  role,
  initialOrderId = '',
  evidenceOnly = false,
}: {
  role: WorkspaceRole;
  initialOrderId?: string;
  evidenceOnly?: boolean;
}) {
  const [data, setData] = useState<OrdersState>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [detailsRequestOpen, setDetailsRequestOpen] = useState(false);
  const [detailClaims, setDetailClaims] = useState<Record<string, string>>({
    countryOfOrigin: 'optional',
    expiryDate: 'required',
  });
  const [tab, setTab] = useState(role === 'supplier' || evidenceOnly ? 'orders' : 'catalogue');
  const [selected, setSelected] = useState(initialOrderId);
  const [pendingDecision, setPendingDecision] = useState<1 | 2>();
  const [decisionReason, setDecisionReason] = useState('');
  const [form, setForm] = useState<Record<string, string>>({
    quantity: '',
    unit: 'g',
  });
  const [identityMaterial, setIdentityMaterial] = useState<any>();
  const [identitySelectedClaims, setIdentitySelectedClaims] = useState<string[]>([]);
  const [identityStatus, setIdentityStatus] = useState<any>();
  const [requiredClaims, setRequiredClaims] = useState<string[]>([
    'companyName',
    'role',
    'walletAddress',
    'id',
  ]);
  const navigate = useNavigate();
  const change = (field: string) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const load = useCallback(async () => {
    setData(await getOrders());
  }, []);
  useEffect(() => {
    load().catch((cause) => setError(cause.message));
  }, [load]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };
  const sign = async (transaction: PreparedTransaction) => {
    if (!window.ethereum) throw new Error('Connect MetaMask to sign this action.');
    if (BigInt(transaction.chainId) !== targetChainId)
      throw new Error('The prepared transaction targets a different chain.');
    if (!data?.actor) throw new Error('Refresh the authenticated company before signing.');
    await submitProductionTransaction(transaction, data.actor);
    setNotice('Transaction confirmed on-chain.');
    try {
      await load();
    } catch {
      throw new Error(
        'Transaction confirmed, but refresh failed. Refresh the page; do not repeat the transaction.',
      );
    }
  };
  const submit = (action: string, values: Record<string, unknown>) =>
    run(async () => {
      const prepared = await prepareOrder({ ...values, action, operationId: crypto.randomUUID() });
      await sign(prepared.transaction);
      if (action === 'request') {
        setTab('orders');
        setSelected('');
        setNotice('Request submitted. The recipient can review it and ask for company evidence.');
      }
    });
  const order = data?.orders.find((entry) => entry.orderId === selected);
  const item = data?.catalogue.find((entry) => entry.itemId === (order?.itemId ?? selected));
  const seller = !!order && !!data && same(order.seller, data.actor);
  const buyer = !!order && !!data && same(order.buyer, data.actor);
  const activeOrder = !!order && Number(order.status) < 3 && Number(order.expiresAt) > now();
  const openTab = (value: string) => {
    setTab(value);
    setSelected('');
    setIdentityMaterial(undefined);
    setIdentityStatus(undefined);
  };
  const choices = (label: string, field: string, options: { value: string; label: string }[]) => (
    <SelectField
      label={label}
      value={form[field] ?? ''}
      onChange={change(field)}
      disabled={busy}
      options={[{ value: '', label: 'Select…' }, ...options]}
    />
  );
  const fields = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2,minmax(0,1fr))',
    alignItems: 'start',
    gap: 12,
  } as const;
  const refreshIdentity = () =>
    run(async () => {
      if (order) setIdentityStatus(await orderIdentity(order.orderId, { action: 'status' }));
    });
  return (
    <div className="orders-page" style={{ display: 'grid', gap: 16, width: '100%' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <h2 style={{ color: T.navy }}>
          {role === 'supplier'
            ? evidenceOnly
              ? 'Company evidence request'
              : 'Manage orders'
            : 'Browse & requests'}
        </h2>
        <Btn
          variant="outline"
          icon={<RefreshCw size={16} />}
          disabled={busy}
          onClick={() => void run(load)}
        >
          {busy ? 'Working…' : 'Refresh data'}
        </Btn>
      </header>
      <p>
        {role === 'supplier'
          ? evidenceOnly
            ? 'Manage company evidence linked to this request. Verification does not approve the order automatically.'
            : 'Review incoming Manufacturer requests, record a decision, or ask for company evidence. No payment or stock movement takes place.'
          : 'Browse registered ingredients and products, request quantities or additional details, and exchange company evidence. No payment or fulfilment steps are included.'}
      </p>
      {role !== 'supplier' && (
        <nav aria-label="Browse and requests" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Btn
            variant={tab === 'catalogue' ? 'primary' : 'outline'}
            disabled={busy}
            onClick={() => openTab('catalogue')}
          >
            Browse items
          </Btn>
          <Btn
            variant={tab === 'orders' ? 'primary' : 'outline'}
            disabled={busy}
            onClick={() => openTab('orders')}
          >
            My requests
          </Btn>
        </nav>
      )}
      {error && <Alert type="error" message={error} />}
      {notice && <div role="status">{notice}</div>}
      {!data && !error && <p role="status">Loading on-chain order ledger…</p>}
      {data && role !== 'supplier' && tab === 'catalogue' && (
        <>
          {item && !order ? (
            <Btn variant="outline" onClick={() => setSelected('')}>
              Back to items
            </Btn>
          ) : (
            <div>
              <h3>Registered ingredients & products</h3>
              <p>
                {role === 'manufacturer'
                  ? 'Browse registered supplier ingredients. Your finished products appear automatically for retailers after production.'
                  : role === 'retailer'
                    ? 'Choose a finished product, view details and send a quantity or evidence request.'
                    : 'Browse the registered items and review requests available to your company.'}
              </p>
            </div>
          )}
          {!data.catalogue.length && (
            <p>
              No registered ingredients or products found. They appear here automatically after
              registration.
            </p>
          )}
          {!item && (
            <div className="request-item-grid">
              {data.catalogue
                .filter(
                  (entry) =>
                    !entry.archived &&
                    (role !== 'manufacturer' ||
                      Number(entry.kind) === 1 ||
                      same(entry.seller, data.actor)) &&
                    (role !== 'retailer' || Number(entry.kind) === 2),
                )
                .map((entry) => (
                  <Card key={entry.itemId}>
                    <span>{Number(entry.kind) === 1 ? 'Ingredient' : 'Product'}</span>
                    <h3>{entry.name}</h3>
                    <p>{entry.sellerName ?? 'Company name unavailable'}</p>
                    <p>
                      {entry.price !== undefined
                        ? entry.currency + ' ' + entry.price + ' / ' + entry.unit
                        : 'Price unavailable'}
                    </p>
                    <p>
                      {entry.category ?? 'Category unavailable'} |{' '}
                      {entry.active === false ? 'Unavailable for requests' : 'Registered batch'}
                    </p>
                    <Btn
                      variant="outline"
                      onClick={() => {
                        setSelected(entry.itemId);
                        setForm((current) => ({ ...current, unit: entry.unit }));
                      }}
                    >
                      View details
                    </Btn>
                  </Card>
                ))}
            </div>
          )}
          {item && !order && (
            <Card>
              <h3>{item.name}</h3>
              <p>
                Company: {item.sellerName ?? 'Company name unavailable'} | Category:{' '}
                {item.category ?? 'Unavailable'}
              </p>
              <p>Reference: {item.batchReference ?? short(item.batches[0])}</p>
              <p>
                Indicative price:{' '}
                {item.price !== undefined
                  ? `${item.currency} ${item.price} per ${item.unit}`
                  : 'Unavailable'}
                . Requests do not take payment.
              </p>
              {item.batchDetails?.map((batch: OrderRecord) => (
                <p key={batch.batchId}>
                  Batch {short(batch.batchId)} | Expires {timestamp(batch.expiresAt)} |{' '}
                  {batch.supplierAvailable !== undefined
                    ? `${batch.supplierAvailable} ${item.unit} available`
                    : 'Quantity recorded in the product batch'}
                </p>
              ))}
              {((role === 'manufacturer' && Number(item.kind) === 1) ||
                (role === 'retailer' && Number(item.kind) === 2)) && (
                <Btn variant="outline" onClick={() => setDetailsRequestOpen((current) => !current)}>
                  Request {Number(item.kind) === 1 ? 'ingredient' : 'product'} details
                </Btn>
              )}
              {detailsRequestOpen && (
                <section className="orders-stage">
                  <h4>Request additional evidence</h4>
                  <p>
                    Select necessary claims and optional claims. The holder chooses optional
                    disclosures. Product requests concern linked ingredient evidence.
                  </p>
                  {Number(item.kind) === 2 &&
                    choices(
                      'Ingredient in this product',
                      'detailBatch',
                      (
                        item.batchDetails?.flatMap(
                          (batch: OrderRecord) => batch.ingredientLinks ?? [],
                        ) ?? []
                      ).map((link: OrderRecord) => ({
                        value: link.batchId,
                        label: short(link.batchId),
                      })),
                    )}
                  <Input
                    label="Reason for requesting details"
                    value={form.detailReason ?? ''}
                    onChange={change('detailReason')}
                    maxLength={500}
                  />
                  <Input
                    label="Details response deadline"
                    type="datetime-local"
                    value={form.detailDeadline ?? ''}
                    onChange={change('detailDeadline')}
                  />
                  <div style={fields}>
                    {[
                      'countryOfOrigin',
                      'productionDate',
                      'expiryDate',
                      'allergenDeclaration',
                      'certificationDetails',
                      'qualityTestSummary',
                    ].map((claim) => (
                      <SelectField
                        key={claim}
                        label={claim + ' disclosure requirement'}
                        value={detailClaims[claim] ?? 'not-requested'}
                        onChange={(value) =>
                          setDetailClaims((current) => ({ ...current, [claim]: value }))
                        }
                        options={[
                          { value: 'not-requested', label: 'Do not request' },
                          { value: 'optional', label: 'Optional' },
                          { value: 'required', label: 'Necessary' },
                        ]}
                      />
                    ))}
                  </div>
                  <Btn
                    disabled={
                      busy ||
                      !form.detailReason?.trim() ||
                      !form.detailDeadline ||
                      !Object.values(detailClaims).some((value) => value !== 'not-requested') ||
                      (Number(item.kind) === 2 && !form.detailBatch)
                    }
                    onClick={() =>
                      void run(async () => {
                        const prepared = await prepareEvidenceRequest({
                          batchId: Number(item.kind) === 1 ? item.batches[0] : form.detailBatch,
                          ...(Number(item.kind) === 2 ? { productBatchId: item.batches[0] } : {}),
                          operationId: crypto.randomUUID(),
                          claims: Object.keys(detailClaims).filter(
                            (key) => detailClaims[key] !== 'not-requested',
                          ),
                          requiredClaims: Object.keys(detailClaims).filter(
                            (key) => detailClaims[key] === 'required',
                          ),
                          reason: form.detailReason,
                          dueAt: new Date(form.detailDeadline).toISOString(),
                        });
                        if (!prepared.transaction || !prepared.requestId)
                          throw new Error('Details request could not be prepared.');
                        await sign(prepared.transaction);
                        await sendEvidenceRequestMessage(
                          await getEvidenceDetails(prepared.requestId),
                        );
                        setNotice(
                          'Details requested. Open Ingredient evidence to review the response; verification and acceptance remain separate.',
                        );
                      })
                    }
                  >
                    Send details request
                  </Btn>
                  <Btn variant="outline" onClick={() => navigate(workspacePath(role, 'evidence'))}>
                    Open evidence responses
                  </Btn>
                </section>
              )}
              {((role === 'manufacturer' && Number(item.kind) === 1) ||
                (role === 'retailer' && Number(item.kind) === 2)) && (
                <details className="orders-stage">
                  <summary>Request a quantity</summary>
                  <p>
                    Enter the quantity you are interested in, a deadline and an optional note. The
                    recipient can review your request and ask for company evidence.
                  </p>
                  <div style={fields}>
                    <Input
                      label={`Requested quantity (${item.unit})`}
                      value={form.quantity}
                      onChange={change('quantity')}
                      type="number"
                      min="1"
                      step="1"
                      required
                    />
                    <Input
                      label="Request deadline"
                      type="datetime-local"
                      value={form.deadline ?? ''}
                      onChange={change('deadline')}
                      required
                    />
                    <Input
                      label="Private note"
                      value={form.note ?? ''}
                      onChange={change('note')}
                      maxLength={500}
                    />
                  </div>
                  <Btn
                    disabled={
                      busy ||
                      item.active === false ||
                      !/^[1-9]\d*$/.test(form.quantity) ||
                      !form.deadline
                    }
                    onClick={() =>
                      void submit('request', {
                        itemId: item.itemId,
                        batchId: item.batches[0],
                        kind: Number(item.kind),
                        requestOnly: true,
                        quantity: form.quantity,
                        unit: item.unit,
                        expiresAt: Math.floor(Date.parse(form.deadline) / 1000),
                        evidenceRequired: false,
                        note: form.note ?? '',
                      })
                    }
                  >
                    Submit request
                  </Btn>
                </details>
              )}
            </Card>
          )}
        </>
      )}
      {data && tab === 'orders' && (
        <>
          <h3>
            {order
              ? 'Request details'
              : role === 'supplier'
                ? 'Incoming Manufacturer orders'
                : 'My requests'}
          </h3>
          <p>
            Review requests you sent or received. The recipient can ask for company evidence;
            presenting and verifying it are separate actions.
          </p>
          {order && (
            <Btn variant="outline" onClick={() => setSelected('')}>
              Back to requests
            </Btn>
          )}
          {!data.orders.length && <p>No requests for your wallet.</p>}
          {!order && role === 'supplier' && (
            <Card padding="0">
              <Table
                headers={[
                  'Manufacturer',
                  'Ingredient',
                  'Requested quantity',
                  'Deadline',
                  'Decision',
                  '',
                ]}
              >
                {data.orders
                  .filter((entry) => same(entry.seller, data.actor))
                  .map((entry) => (
                    <TR
                      key={entry.orderId}
                      onClick={() => {
                        setSelected(entry.orderId);
                        setPendingDecision(undefined);
                      }}
                    >
                      <TD bold>{entry.buyerName ?? short(entry.buyer)}</TD>
                      <TD>
                        {data.catalogue.find((item) => item.itemId === entry.itemId)?.name ??
                          'Unavailable'}
                      </TD>
                      <TD>
                        {entry.requested}{' '}
                        {data.catalogue.find((item) => item.itemId === entry.itemId)?.unit ?? ''}
                      </TD>
                      <TD muted>{timestamp(entry.expiresAt)}</TD>
                      <TD>
                        <Badge
                          label={
                            Number(entry.decision?.status) === 1
                              ? 'Approved'
                              : Number(entry.decision?.status) === 2
                                ? 'Rejected'
                                : Number(entry.expiresAt) <= now()
                                  ? 'Expired'
                                  : Number(entry.status) === 3
                                    ? 'Closed'
                                    : 'Awaiting review'
                          }
                          variant={Number(entry.decision?.status) === 1 ? 'active' : 'pending'}
                        />
                      </TD>
                      <TD>
                        <Btn
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(entry.orderId);
                            setPendingDecision(undefined);
                          }}
                        >
                          View request
                        </Btn>
                      </TD>
                    </TR>
                  ))}
              </Table>
            </Card>
          )}
          {!order &&
            role !== 'supplier' &&
            data.orders.map((entry) => (
              <Card key={entry.orderId}>
                <h3>
                  {data.catalogue.find((item) => item.itemId === entry.itemId)?.name ??
                    'Item name unavailable'}
                </h3>
                <p>
                  {same(entry.seller, data.actor)
                    ? 'Received request'
                    : same(entry.buyer, data.actor)
                      ? 'Sent request'
                      : 'Request record'}
                </p>
                <p>
                  Requester: {entry.buyerName ?? short(entry.buyer)} | Recipient:{' '}
                  {entry.sellerName ?? short(entry.seller)}
                </p>
                <p>
                  Quantity requested: {entry.requested}{' '}
                  {data.catalogue.find((item) => item.itemId === entry.itemId)?.unit ?? ''} |
                  Deadline: {timestamp(entry.expiresAt)}
                </p>
                <p>
                  Status:{' '}
                  {Number(entry.decision?.status) === 1
                    ? 'Approved'
                    : Number(entry.decision?.status) === 2
                      ? 'Rejected'
                      : Number(entry.status) === 3
                        ? 'Closed'
                        : Number(entry.expiresAt) <= now()
                          ? 'Expired'
                          : 'Submitted'}
                </p>
                <Btn
                  onClick={() => {
                    setSelected(entry.orderId);
                    setIdentityMaterial(undefined);
                    setIdentityStatus(undefined);
                  }}
                >
                  View request
                </Btn>
              </Card>
            ))}
          {order && (
            <Card key={order.orderId}>
              <h3>{item?.name ?? 'Requested item'}</h3>
              <p>
                Requested quantity: {order.requested} {item?.unit ?? ''}
              </p>
              <p>Request ID: {order.orderId}</p>
              <p>Private note: {order.details?.note || 'No note recorded'}</p>
              {order.decision?.reason && <p>Supplier decision reason: {order.decision.reason}</p>}
              <p>
                {order.details?.requestOnly
                  ? 'This request does not reserve stock, dispatch goods or confirm delivery.'
                  : 'Earlier physical-flow records are preserved. Removing fulfilment controls does not undo any existing reservations or shipments.'}
              </p>
              {seller && role === 'supplier' && !evidenceOnly && (
                <>
                  <p>
                    Requester: {order.buyerName ?? short(order.buyer)} ({order.buyer})
                  </p>
                  <p>Deadline: {timestamp(order.expiresAt)}</p>
                  <p>
                    Decision:{' '}
                    {Number(order.decision?.status) === 1
                      ? 'Approved'
                      : Number(order.decision?.status) === 2
                        ? 'Rejected'
                        : 'Awaiting review'}
                  </p>
                  {!order.decision && (
                    <Alert
                      type="warning"
                      message="Deploy the updated registry suite to enable order decisions. Existing records remain unchanged."
                    />
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Btn
                      disabled={
                        busy ||
                        !activeOrder ||
                        !order.isRequestOnly ||
                        Number(order.decision?.status) !== 0
                      }
                      onClick={() => {
                        setPendingDecision(1);
                        setDecisionReason('Request approved');
                      }}
                    >
                      Approve
                    </Btn>
                    <Btn
                      variant="danger"
                      disabled={
                        busy ||
                        !activeOrder ||
                        !order.isRequestOnly ||
                        Number(order.decision?.status) !== 0
                      }
                      onClick={() => {
                        setPendingDecision(2);
                        setDecisionReason('');
                      }}
                    >
                      Reject
                    </Btn>
                    <Btn
                      variant="outline"
                      disabled={!activeOrder}
                      onClick={() =>
                        navigate(
                          workspacePath('supplier', 'requests') +
                            '?direction=sent&orderId=' +
                            encodeURIComponent(order.orderId),
                        )
                      }
                    >
                      Request company evidence
                    </Btn>
                  </div>
                  {pendingDecision && (
                    <Card>
                      <h4>
                        {pendingDecision === 1 ? 'Approve this request?' : 'Reject this request?'}
                      </h4>
                      <p>
                        This records your decision only. No payment, reservation or dispatch takes
                        place.
                      </p>
                      <Input
                        label="Decision reason"
                        value={decisionReason}
                        onChange={setDecisionReason}
                        required
                        maxLength={1000}
                      />
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Btn
                          variant={pendingDecision === 2 ? 'danger' : 'primary'}
                          disabled={busy || !decisionReason.trim()}
                          onClick={() =>
                            void run(async () => {
                              const prepared = await prepareOrder({
                                action: 'decide-request',
                                operationId: crypto.randomUUID(),
                                orderId: order.orderId,
                                decision: pendingDecision,
                                reason: decisionReason.trim(),
                              });
                              await sign(prepared.transaction);
                              setPendingDecision(undefined);
                              setNotice(
                                'Decision recorded successfully. Stock and credential permissions are unchanged.',
                              );
                            })
                          }
                        >
                          Confirm {pendingDecision === 1 ? 'approval' : 'rejection'}
                        </Btn>
                        <Btn
                          variant="outline"
                          disabled={busy}
                          onClick={() => setPendingDecision(undefined)}
                        >
                          Cancel
                        </Btn>
                      </div>
                    </Card>
                  )}
                </>
              )}
              {(seller || buyer) && activeOrder && (role !== 'supplier' || evidenceOnly) && (
                <details className="orders-stage" open>
                  <summary>Company identity evidence</summary>
                  <p>
                    Seller requests a proof → buyer previews and approves sharing → seller verifies
                    and records the result. This can happen before ingredient evidence is shared.
                  </p>
                  <p>
                    Request necessary company claims. The presenter chooses optional claims in an
                    authority-signed selective proof linked to its current Company Role Credential.
                    Wallet, role and subject binding stay visible. This does not grant access to
                    ingredient evidence.
                  </p>
                  {seller && (
                    <>
                      <div style={fields}>
                        <Input
                          label="Identity proof purpose"
                          value={form.purpose ?? ''}
                          onChange={change('purpose')}
                          maxLength={500}
                        />
                        <Input
                          label="Identity proof deadline"
                          type="datetime-local"
                          value={form.identityDeadline ?? ''}
                          onChange={change('identityDeadline')}
                        />
                      </div>

                      <fieldset>
                        <legend>Required signed company claims</legend>
                        {[
                          'companyId',
                          'companyName',
                          'companyRegistrationNumber',
                          'role',
                          'walletAddress',
                          'id',
                          'applicationReference',
                        ].map((claim) => (
                          <label key={claim} style={{ display: 'inline-block', marginRight: 14 }}>
                            <input
                              type="checkbox"
                              checked={requiredClaims.includes(claim)}
                              disabled={['id', 'walletAddress', 'role'].includes(claim)}
                              onChange={(event) =>
                                setRequiredClaims((current) =>
                                  event.target.checked
                                    ? [...current, claim]
                                    : current.filter((value) => value !== claim),
                                )
                              }
                            />
                            {claim}
                          </label>
                        ))}
                      </fieldset>
                      <p>
                        Other claims are optional. The presenter can omit them; the subject DID,
                        wallet and role are mandatory for holder and authorization checks. Legacy
                        full-credential presentations are labelled separately.
                      </p>
                      <Btn
                        disabled={busy || !form.purpose?.trim() || !form.identityDeadline}
                        onClick={() =>
                          void run(async () => {
                            const result = await orderIdentity(order.orderId, {
                              action: 'request',
                              purpose: form.purpose,
                              expiresAt: Math.floor(Date.parse(form.identityDeadline) / 1000),
                              required: false,
                              requiredClaims,
                              optionalClaims: [
                                'companyId',
                                'companyName',
                                'companyRegistrationNumber',
                                'role',
                                'walletAddress',
                                'id',
                                'applicationReference',
                              ].filter((claim) => !requiredClaims.includes(claim)),
                            });
                            await sign(result.transaction);
                          })
                        }
                      >
                        Request company identity proof
                      </Btn>
                      <Btn
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const result = await orderIdentity(order.orderId, { action: 'verify' });
                            if (result.transaction) await sign(result.transaction);
                            else
                              setNotice(
                                'Company identity verification is already recorded on-chain.',
                              );
                            setIdentityStatus(
                              await orderIdentity(order.orderId, { action: 'status' }),
                            );
                          })
                        }
                      >
                        Verify company identity & record result
                      </Btn>
                    </>
                  )}
                  <Btn disabled={busy} onClick={refreshIdentity}>
                    Check identity status
                  </Btn>
                  {identityStatus && (
                    <p role="status">
                      Identity proof: {identityStatus.status}. {identityStatus.checks?.join(', ')}
                    </p>
                  )}
                  {identityStatus?.credential && (
                    <dl>
                      {Object.entries(identityStatus.credential).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd style={{ overflowWrap: 'anywhere' }}>{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {buyer && (
                    <>
                      <Btn
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const material = await orderIdentity(order.orderId, {
                              action: 'material',
                            });
                            setIdentitySelectedClaims(material.requiredClaims ?? []);
                            setIdentityMaterial(material);
                          })
                        }
                      >
                        Preview requested Company Role VP
                      </Btn>
                      <Btn
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await orderIdentity(order.orderId, { action: 'decline' });
                            setIdentityStatus({ status: 'DECLINED' });
                          })
                        }
                      >
                        Decline identity request
                      </Btn>
                    </>
                  )}
                  {identityMaterial && (
                    <>
                      <Alert
                        type="warning"
                        message={
                          identityMaterial.format === 'COMPANY_IDENTITY_SD_JWT'
                            ? 'Select optional claims to share. Required claims and cryptographic binding remain visible. This authority-derived proof references your existing credential; it does not alter that credential.'
                            : 'Full disclosure: this legacy request shares the entire signed Company Role Credential. Optional fields cannot be hidden in this format.'
                        }
                      />
                      <p>
                        Verifier: {short(identityMaterial.audience)} · Purpose:{' '}
                        {identityMaterial.purpose} · Expires:{' '}
                        {timestamp(identityMaterial.expiresAt)}
                      </p>
                      <dl>
                        {Object.entries(
                          identityMaterial.claims ?? identityMaterial.credential.credentialSubject,
                        ).map(([key, value]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            {identityMaterial.format === 'COMPANY_IDENTITY_SD_JWT' && (
                              <label>
                                <input
                                  type="checkbox"
                                  aria-label={`Share ${key}`}
                                  checked={identitySelectedClaims.includes(key)}
                                  disabled={identityMaterial.requiredClaims.includes(key)}
                                  onChange={(event) =>
                                    setIdentitySelectedClaims((current) =>
                                      event.target.checked
                                        ? [...current, key]
                                        : current.filter((claim) => claim !== key),
                                    )
                                  }
                                />
                                {identityMaterial.requiredClaims.includes(key)
                                  ? 'Necessary'
                                  : 'Optional'}
                              </label>
                            )}
                            <dd style={{ overflowWrap: 'anywhere' }}>{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                      <PresentationSigningSettingsLink role={role} />
                      <Btn
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const holder = getActiveMessagingAgent();
                            if (!holder || holder.did !== identityMaterial.holderDid)
                              throw new Error(
                                'Restore the holder signing key bound to your wallet.',
                              );
                            const presentation =
                              identityMaterial.format === 'COMPANY_IDENTITY_SD_JWT'
                                ? await createSelectiveCompanyIdentityPresentation(
                                    holder,
                                    identityMaterial.sdJwt,
                                    {
                                      audience: identityMaterial.audience,
                                      nonce: identityMaterial.challenge,
                                      claims: identitySelectedClaims,
                                    },
                                  )
                                : await createCompanyIdentityPresentation(holder, identityMaterial);
                            await orderIdentity(order.orderId, { action: 'present', presentation });
                            setIdentityMaterial(undefined);
                            setIdentityStatus({ status: 'PRESENTED' });
                          })
                        }
                      >
                        Approve selected claims & send proof
                      </Btn>
                    </>
                  )}
                </details>
              )}

              {!activeOrder && (
                <p>
                  This request is closed or expired. Its record remains available for reference.
                </p>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
