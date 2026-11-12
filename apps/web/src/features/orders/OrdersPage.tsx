import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
  Badge,
  Btn,
  Card,
  Input,
  Modal,
  SelectField,
  T,
  TechnicalDetails,
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
import { CatalogueBrowser, CatalogueSkeleton } from './CatalogueBrowser';
import { SupplierStockSummary } from './SupplierStockSummary';
import { CatalogueImage, CompanyAvatar } from './CatalogueMedia';
import {
  companyEvidenceStatus,
  nextAction,
  requestStatus,
  RequestsLoading,
  RequestsOverview,
} from './RequestsOverview';

const short = (value?: string) =>
  value ? `${value.slice(0, 10)}…${value.slice(-6)}` : 'Unavailable';
const same = (a: string, b: string) => a?.toLowerCase() === b?.toLowerCase();
const timestamp = (value: string | number) =>
  Number(value) ? new Date(Number(value) * 1000).toLocaleString() : 'Not recorded';
const now = () => Math.floor(Date.now() / 1000);
const orderError = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : 'Action failed.';
  if (/\b(rpc|provider)\b.*unavailable|unavailable.*\b(rpc|provider)\b/i.test(message))
    return 'Blockchain/RPC unavailable. Try again when the configured network is reachable.';
  if (/fetch failed|network error|order service is unavailable/i.test(message))
    return 'The order service is unavailable. Try again shortly.';
  return message;
};
export function OrdersPage({
  role,
  initialOrderId = '',
  evidenceOnly = false,
  mode = 'combined',
  initialBatchId = '',
}: {
  role: WorkspaceRole;
  initialOrderId?: string;
  evidenceOnly?: boolean;
  mode?: 'combined' | 'browse' | 'manage';
  initialBatchId?: string;
}) {
  const [data, setData] = useState<OrdersState>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [tab, setTab] = useState(
    role === 'supplier' || evidenceOnly || mode === 'manage' ? 'orders' : 'catalogue',
  );
  const [direction, setDirection] = useState<'sent' | 'received'>('sent');
  const [selected, setSelected] = useState(initialOrderId);
  const [pendingDecision, setPendingDecision] = useState<1 | 2>();
  const [decisionReason, setDecisionReason] = useState('');
  const [receiptConfirmed, setReceiptConfirmed] = useState(false);
  useEffect(() => {
    setReceiptConfirmed(false);
  }, [selected]);
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
    load().catch((cause) => setError(orderError(cause)));
  }, [load]);
  useEffect(() => {
    if (!initialBatchId || !data) return;
    const entry = data.catalogue.find((item) =>
      item.batches?.some((batch: string) => same(batch, initialBatchId)),
    );
    if (!entry)
      setError(
        'This linked ingredient is not currently available in the registered Supplier records. Refresh or contact its Supplier.',
      );
  }, [initialBatchId, data]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (cause) {
      setError(orderError(cause));
    } finally {
      busyRef.current = false;
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
      if (action === 'approved-receipt') setReceiptConfirmed(false);
      if (action === 'request') {
        if (mode === 'browse') {
          navigate(workspacePath(role, 'orders'));
          return;
        }
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
  const receiptOccurredAt = form.receivedAt ? Math.floor(Date.parse(form.receivedAt) / 1000) : 0;
  const managedOrders =
    data?.orders.filter((entry) =>
      role === 'supplier' || direction === 'received'
        ? same(entry.seller, data.actor)
        : same(entry.buyer, data.actor),
    ) ?? [];
  const availableItems =
    data?.catalogue.filter(
      (entry) =>
        !entry.archived &&
        (mode !== 'browse' || Number(entry.kind) === 1) &&
        (role !== 'manufacturer' || Number(entry.kind) === 1 || same(entry.seller, data.actor)) &&
        (role !== 'retailer' || Number(entry.kind) === 2),
    ) ?? [];
  const openTab = (value: string) => {
    setTab(value);
    setSelected('');
    setIdentityMaterial(undefined);
    setIdentityStatus(undefined);
  };
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
      <header className="orders-page-header">
        <div>
          <h2 style={{ color: T.navy }}>
            {evidenceOnly
              ? 'Company evidence request'
              : mode === 'manage'
                ? 'My orders'
                : mode === 'browse'
                  ? 'Supplier ingredients'
                  : role === 'supplier'
                    ? evidenceOnly
                      ? 'Company evidence request'
                      : 'Incoming quantity requests'
                    : 'Browse & requests'}
          </h2>
          <p>
            {mode === 'manage'
              ? 'Manage ingredient requests sent to Suppliers and product requests received from buyers. Orders record requests only; no payment or stock movement takes place.'
              : mode === 'browse'
                ? 'Open an ingredient to see its registered details, request evidence or send a quantity request to its Supplier.'
                : role === 'supplier'
                  ? evidenceOnly
                    ? 'Manage company evidence linked to this request. Verification does not approve the order automatically.'
                    : 'Review Manufacturer quantity requests and record your decision. Approval does not move stock, take payment or dispatch goods.'
                  : 'Browse registered ingredients and products, request quantities or additional details, and exchange company evidence. No payment or fulfilment steps are included.'}
          </p>
        </div>
        <Btn
          variant="outline"
          icon={<RefreshCw size={16} />}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await load();
              setNotice(
                'Requests refreshed. Changes recorded by other stakeholders are now shown.',
              );
            })
          }
        >
          {busy ? 'Working…' : 'Refresh data'}
        </Btn>
      </header>
      {role !== 'supplier' && mode === 'combined' && !evidenceOnly && (
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
      {notice && <Alert type="success" message={notice} />}
      {!data && !error && (role === 'supplier' ? <RequestsLoading /> : <CatalogueSkeleton />)}
      {data && role !== 'supplier' && tab === 'catalogue' && (
        <CatalogueBrowser
          actor={data.actor}
          busy={busy}
          items={availableItems}
          initialBatchId={initialBatchId}
          role={role}
          onOpenEvidence={() =>
            navigate(workspacePath(role, role === 'manufacturer' ? 'requests' : 'evidence'))
          }
          onQuantityRequest={(selectedItem, input) =>
            submit('request', {
              itemId: selectedItem.itemId,
              batchId: selectedItem.batches[0],
              kind: Number(selectedItem.kind),
              requestOnly: true,
              quantity: input.quantity,
              unit: selectedItem.unit,
              expiresAt: Math.floor(Date.parse(input.deadline) / 1000),
              evidenceRequired: false,
              note: input.note,
            })
          }
          onEvidenceRequest={(selectedItem, input) =>
            run(async () => {
              const prepared = await prepareEvidenceRequest({
                batchId: input.batchId,
                ...(Number(selectedItem.kind) === 2
                  ? { productBatchId: selectedItem.batches[0] }
                  : {}),
                operationId: crypto.randomUUID(),
                claims: input.claims,
                requiredClaims: input.requiredClaims,
                reason: input.reason,
                dueAt: new Date(input.deadline).toISOString(),
              });
              if (!prepared.transaction || !prepared.requestId)
                throw new Error('Information request could not be prepared.');
              await sign(prepared.transaction);
              await sendEvidenceRequestMessage(await getEvidenceDetails(prepared.requestId));
              setNotice(
                'Information requested. Open Information requests to review the Supplier response.',
              );
            })
          }
        />
      )}
      {data && tab === 'orders' && (
        <>
          {mode === 'manage' && !order && (
            <>
              <nav aria-label="Order direction" className="flex flex-wrap gap-[8px]">
                <Btn
                  variant={direction === 'sent' ? 'primary' : 'outline'}
                  onClick={() => setDirection('sent')}
                >
                  Sent to Suppliers
                </Btn>
                <Btn
                  variant={direction === 'received' ? 'primary' : 'outline'}
                  onClick={() => setDirection('received')}
                >
                  Received from buyers
                </Btn>
              </nav>
            </>
          )}
          {role !== 'supplier' && (
            <>
              <h3>{order ? 'Request details' : 'My requests'}</h3>
              <p>
                Review requests you sent or received. The recipient can ask for company evidence;
                presenting and verifying it are separate actions.
              </p>
            </>
          )}
          {order && role !== 'supplier' && (
            <Btn variant="outline" onClick={() => setSelected('')}>
              Back to requests
            </Btn>
          )}
          {!order && (
            <RequestsOverview
              actor={data.actor}
              catalogue={data.catalogue}
              orders={mode === 'manage' || role === 'supplier' ? managedOrders : data.orders}
              role={role}
              onView={(orderId) => {
                setSelected(orderId);
                setPendingDecision(undefined);
                setIdentityMaterial(undefined);
                setIdentityStatus(undefined);
              }}
            />
          )}
          {order && (
            <OrderDetailSurface
              modal={role === 'supplier'}
              title={`Review request — ${item?.name ?? 'Requested item'}`}
              onClose={() => setSelected('')}
            >
              <div className="request-detail-modal">
                <section
                  className="request-detail-summary"
                  aria-label="Ingredient and Manufacturer"
                >
                  <CatalogueImage
                    path={item?.imagePath}
                    alt={`${item?.name ?? 'Ingredient'} catalogue image`}
                    category={item?.category}
                    large
                  />
                  <div>
                    <Badge
                      label={requestStatus(order).label}
                      variant={requestStatus(order).variant}
                    />
                    <h3>{item?.name ?? 'Requested item'}</h3>
                    <p>Batch reference: {item?.batchReference || 'Not disclosed'}</p>
                    <div className="request-detail-company">
                      <CompanyAvatar
                        name={order.buyerName ?? 'Verified Manufacturer unavailable'}
                        size="lg"
                      />
                      <div>
                        <span>Manufacturer</span>
                        <strong>{order.buyerName ?? 'Verified Manufacturer unavailable'}</strong>
                      </div>
                    </div>
                  </div>
                </section>
                <dl className="request-detail-facts">
                  <div>
                    <dt>Requested quantity</dt>
                    <dd>
                      {order.requested} {item?.unit ?? ''}
                    </dd>
                  </div>
                  <div>
                    <dt>Submitted</dt>
                    <dd>{timestamp(order.createdAt ?? order.requestedAt)}</dd>
                  </div>
                  <div>
                    <dt>Response deadline</dt>
                    <dd>{timestamp(order.expiresAt)}</dd>
                  </div>
                  <div>
                    <dt>Company evidence</dt>
                    <dd>{companyEvidenceStatus(order)}</dd>
                  </div>
                </dl>
                <Alert type="info" message={`Next action: ${nextAction(order, data.actor)}`} />
                {buyer &&
                  mode === 'manage' &&
                  !evidenceOnly &&
                  order.identityChallenge &&
                  !/^0x0+$/.test(order.identityChallenge) && (
                    <Btn
                      variant="outline"
                      onClick={() =>
                        navigate(
                          workspacePath(role, 'requests') +
                            '?direction=received&orderId=' +
                            encodeURIComponent(order.orderId),
                        )
                      }
                    >
                      Respond to company evidence request
                    </Btn>
                  )}
                <p>Private note: {order.details?.note || 'No note recorded'}</p>
                {buyer && role === 'manufacturer' && mode === 'manage' && !evidenceOnly && (
                  <section className="orders-stage grid gap-[12px]">
                    <h3>Confirm ingredients received</h3>
                    <p>
                      Supplier decision:{' '}
                      {Number(order.decision?.status) === 1
                        ? 'Approved'
                        : Number(order.decision?.status) === 2
                          ? 'Rejected'
                          : order.decision
                            ? 'Awaiting approval'
                            : 'Unavailable — refresh the request'}
                    </p>
                    <p>
                      Supplier approved: {order.requested} {item?.unit}. Received so far:{' '}
                      {order.approvedReceivedQuantity ?? 'Unavailable'} {item?.unit}. Only confirmed
                      receipt adds stock for production.
                    </p>
                    {Number(order.decision?.status) !== 1 ? (
                      <Alert
                        type="info"
                        message="Receipt confirmation becomes available after the Supplier approves this quantity request."
                      />
                    ) : !data.approvedReceiptsSupported ? (
                      <Alert
                        type="warning"
                        message="Deploy the updated registry suite to enable receipt confirmation for approved requests."
                      />
                    ) : Number(item?.kind) !== 1 ? (
                      <Alert
                        type="warning"
                        message="Ingredient details are unavailable. Refresh before confirming receipt."
                      />
                    ) : (
                      activeOrder && (
                        <>
                          <SelectField
                            label="Receiving / production location"
                            value={form.receiptLocation ?? ''}
                            onChange={change('receiptLocation')}
                            required
                            options={[
                              { value: '', label: 'Select your receiving location' },
                              ...data.locations
                                .filter((location) => same(location.company, data.actor))
                                .map((location) => ({
                                  value: location.location,
                                  label: location.label ?? short(location.location),
                                })),
                            ]}
                          />
                          {!data.locations.some((location) =>
                            same(location.company, data.actor),
                          ) && (
                            <div className="grid gap-[8px]">
                              <Input
                                label="New receiving location name"
                                value={form.locationLabel ?? ''}
                                onChange={change('locationLabel')}
                                maxLength={160}
                              />
                              <Btn
                                disabled={busy || !form.locationLabel?.trim()}
                                onClick={() =>
                                  void submit('location', { label: form.locationLabel.trim() })
                                }
                              >
                                Register receiving location
                              </Btn>
                            </div>
                          )}
                          <Input
                            label={`Quantity received (${item?.unit})`}
                            type="number"
                            min="1"
                            max={(
                              BigInt(order.requested) -
                              BigInt(order.approvedReceivedQuantity ?? '0')
                            ).toString()}
                            step="1"
                            value={form.receiptQuantity ?? ''}
                            onChange={change('receiptQuantity')}
                            required
                          />
                          <Input
                            label="Actual receipt date and time"
                            type="datetime-local"
                            step="1"
                            value={form.receivedAt ?? ''}
                            onChange={change('receivedAt')}
                            required
                          />
                          <label className="flex items-start gap-[8px]">
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={receiptConfirmed}
                              onChange={(event) => setReceiptConfirmed(event.target.checked)}
                            />
                            I confirm these ingredients physically arrived at my receiving location.
                          </label>
                          <Btn
                            disabled={
                              busy ||
                              !receiptConfirmed ||
                              !form.receiptLocation ||
                              !/^[1-9]\d*$/.test(form.receiptQuantity ?? '') ||
                              !form.receivedAt ||
                              !Number.isFinite(receiptOccurredAt) ||
                              receiptOccurredAt > now() ||
                              BigInt(form.receiptQuantity || '0') >
                                BigInt(order.requested) -
                                  BigInt(order.approvedReceivedQuantity ?? '0')
                            }
                            onClick={() =>
                              void submit('approved-receipt', {
                                orderId: order.orderId,
                                quantity: form.receiptQuantity,
                                location: form.receiptLocation,
                                occurredAt: receiptOccurredAt,
                              })
                            }
                          >
                            Confirm receipt with MetaMask
                          </Btn>
                        </>
                      )
                    )}
                  </section>
                )}
                {order.decision?.reason && <p>Seller decision reason: {order.decision.reason}</p>}
                <p>
                  {order.isRequestOnly || order.details?.requestOnly
                    ? 'This request does not reserve stock, dispatch goods or confirm delivery.'
                    : 'Earlier physical-flow records are preserved. Removing fulfilment controls does not undo any existing reservations or shipments.'}
                </p>
                {seller && (role === 'supplier' || mode === 'manage') && !evidenceOnly && (
                  <>
                    {role === 'supplier' &&
                      data.supplierStock
                        ?.filter((stock) =>
                          same(
                            stock.batchId,
                            order.requestedBatch ??
                              (item?.batches?.length === 1 ? item.batches[0] : undefined),
                          ),
                        )
                        .map((stock) => <SupplierStockSummary key={stock.batchId} stock={stock} />)}
                    <h4>Available actions</h4>
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
                    <div className="request-detail-actions">
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
                            workspacePath(role, 'requests') +
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
                        <div className="request-detail-actions">
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
                <TechnicalDetails
                  fields={[
                    { label: 'Request ID', value: order.orderId },
                    { label: 'Batch ID', value: item?.batches?.[0] ?? '' },
                    { label: 'Requester wallet', value: order.buyer },
                    { label: 'Recipient wallet', value: order.seller },
                    {
                      label: 'Transaction identifier',
                      value: order.transactionHash ?? order.txHash ?? '',
                    },
                  ]}
                />
                {(seller || buyer) &&
                  activeOrder &&
                  (evidenceOnly || (role !== 'supplier' && mode !== 'manage')) && (
                    <details className="orders-stage" open>
                      <summary>Company identity evidence</summary>
                      <p>
                        Seller requests a proof → buyer previews and approves sharing → seller
                        verifies and records the result. This can happen before ingredient evidence
                        is shared.
                      </p>
                      <p>
                        Request necessary company claims. The presenter chooses optional claims in
                        an authority-signed selective proof linked to its current Company Role
                        Credential. Wallet, role and subject binding stay visible. This does not
                        grant access to ingredient evidence.
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
                              <label
                                key={claim}
                                style={{ display: 'inline-block', marginRight: 14 }}
                              >
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
                            wallet and role are mandatory for holder and authorization checks.
                            Legacy full-credential presentations are labelled separately.
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
                                const result = await orderIdentity(order.orderId, {
                                  action: 'verify',
                                });
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
                          Identity proof: {identityStatus.status}.{' '}
                          {identityStatus.checks?.join(', ')}
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
                              identityMaterial.claims ??
                                identityMaterial.credential.credentialSubject,
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
                                    : await createCompanyIdentityPresentation(
                                        holder,
                                        identityMaterial,
                                      );
                                await orderIdentity(order.orderId, {
                                  action: 'present',
                                  presentation,
                                });
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
              </div>
            </OrderDetailSurface>
          )}
        </>
      )}
    </div>
  );
}

function OrderDetailSurface({
  modal,
  title,
  onClose,
  children,
}: {
  modal: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return modal ? (
    <Modal title={title} width={860} onClose={onClose}>
      {children}
    </Modal>
  ) : (
    <Card>{children}</Card>
  );
}
