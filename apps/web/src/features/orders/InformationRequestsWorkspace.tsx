import { BackNavigation } from '../../components/ui/BackNavigation';
import { submitProductionTransaction } from '../production-flow/production-flow.transaction';
import { COMPANY_ALWAYS_CLAIMS } from '@tracechain/shared';
import {
  CompanyRequestFields,
  normalizeCompanyRequestFields,
} from '../production-flow/CompanyRequestFields';
import { reportError } from '../../components/ui/feedback';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck, Inbox, Layers, RefreshCw, Search } from 'lucide-react';
import {
  getInformationRequests,
  getOrders,
  getCustodyOffer,
  type CustodyOffer,
  type CompanyProofRequestRow,
  type OrdersState,
} from './orders.api';
import {
  DeliveryIdentityPanel,
  proofStatusLabel,
  proofStatusVariant,
} from './DeliveryIdentityPanel';
import { OrdersPage } from './OrdersPage';
import { CompanyIdentityProofAction } from '../production-flow/CompanyIdentityProofAction';
import {
  getCompanyIdentityProofStatus,
  listEvidenceRequests,
  requestCompanyIdentityProof,
  verifyCompanyIdentityProof,
  type CompanyIdentityProofStatus,
} from '../production-flow/production-flow.api';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';
import { workspacePath } from '../workspaces/workspace-paths';
import { Building2, ClipboardList } from 'lucide-react';
import { EvidenceSummaryCard, RequestSummary, evidenceDateFields } from './EvidenceIdentity';
import {
  Alert,
  Badge,
  Btn,
  EmptyState,
  Input,
  SectionTitle,
  StatusTabs,
  TechnicalDetails,
} from '../workspaces/shared/ui';
import { CompanyAvatar } from './CatalogueMedia';
import {
  EvidenceDetailLayout,
  EvidenceNextStep,
  SharedClaims,
  friendlyClaim,
  DeadlineCell,
  EvidenceStatusSelect,
  matchesStatusFilter,
  type EvidenceStatusFilter,
} from './EvidenceParts';
import { PaginatedTable } from '../../components/ui/PaginatedTable';

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function InformationRequestsWorkspace({
  role,
  children,
  initialDirection,
}: {
  role: WorkspaceRole;
  children?: ReactNode;
  initialDirection?: 'received' | 'sent';
}) {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<CompanyProofRequestRow[]>([]),
    [data, setData] = useState<OrdersState>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState<EvidenceStatusFilter>('all'),
    [selectedDirection, setDirection] = useState<'received' | 'sent'>(
      params.get('direction') === 'sent' ? 'sent' : 'received',
    );
  const direction = initialDirection ?? selectedDirection;
  const reference = params.get('referenceId') ?? params.get('orderId') ?? '',
    context = params.get('context') ?? 'order';
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const requests = await getInformationRequests();
      setRows(requests.requests);
      if (requests.actor && (!reference || requests.requests.every((row) => row.sharedReference)))
        setData({
          actor: requests.actor,
          role,
          catalogue: [],
          orders: [],
          shipments: [],
          locations: [],
        });
      else
        setData(
          await getOrders(
            context === 'order' ? 'order-detail' : undefined,
            context === 'order' ? { orderId: reference } : {},
          ),
        );
    } catch (cause) {
      setError(reportError(cause, 'Information requests unavailable.'));
    } finally {
      setLoading(false);
    }
  }, [role, reference, context]);
  useEffect(() => {
    void load();
  }, [load]);
  const [ingredientCount, setIngredientCount] = useState(0);
  // Clicking the category tab remounts the ingredient list, closing any open review.
  const [ingredientMount, setIngredientMount] = useState(0);
  const hasIngredientTab = Boolean(children);
  useEffect(() => {
    // Only the category tab badge needs this; the ingredient list loads its own rows.
    if (!hasIngredientTab) return;
    void listEvidenceRequests()
      .then((result) => setIngredientCount(result.requests.length))
      .catch(() => undefined);
  }, [hasIngredientTab]);
  const selected = rows.find((row) => same(row.referenceId, reference) && row.context === context);
  const shipment = data?.logistics?.shipments.find(
    (entry) => same(entry.shipmentId, reference) && Number(entry.leg) === 1,
  );
  const order = data?.orders.find((entry) => same(entry.orderId, reference));
  const deliveryOrder = shipment
    ? {
        orderId: reference,
        seller: shipment.sender,
        buyer: shipment.recipient,
        expiresAt: shipment.expiresAt,
        delivery: shipment.delivery,
      }
    : order?.productDelivery
      ? { ...order, delivery: order.productDelivery }
      : order;
  const canDelivery =
    deliveryOrder?.delivery &&
    (same(data?.actor, deliveryOrder.seller) ||
      same(data?.actor, deliveryOrder.delivery.distributor));
  const showEvidence =
    children &&
    (params.get('tab') === 'evidence' ||
      Boolean(params.get('batchId') || params.get('productBatchId')));
  const requestDetail = Boolean(reference && !showEvidence);
  const custodyDetail = requestDetail && context === 'custody';
  const detailDirection = selected?.direction ?? (custodyDetail ? 'sent' : direction);
  const listPath = `${workspacePath(role, 'requests')}?direction=${detailDirection}`;
  const directionRows = useMemo(
    () => rows.filter((row) => row.direction === direction),
    [direction, rows],
  );
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (
      directionRows
        .filter((row) => {
          const group = requestGroup(row, direction);
          return (
            matchesStatusFilter(status, group) &&
            (!query ||
              [row.company, row.purpose, proofStatusLabel(row.status), contextLabel(row.context)]
                .join(' ')
                .toLocaleLowerCase()
                .includes(query))
          );
        })
        // Newest first; the API has no request time, so the latest deadline stands in for it.
        .sort((a, b) => b.expiresAt - a.expiresAt)
    );
  }, [direction, directionRows, search, status]);
  const actionCount = directionRows.filter(
    (row) => requestGroup(row, direction) === 'action',
  ).length;

  if (requestDetail)
    return (
      <div className="information-requests-page is-detail">
        <BackNavigation to={listPath}>Evidence Exchange</BackNavigation>
        {error && <Alert type="error" message={error} />}
        <EvidenceDetailLayout
          asideTitle="Request summary"
          asideIcon={ClipboardList}
          aside={selected && <RequestDetails row={selected} actor={data?.actor} />}
        >
          <EvidenceSummaryCard
            icon={Building2}
            title={
              !selected
                ? detailTitle(selected, custodyDetail)
                : selected.direction === 'received'
                  ? 'Your company'
                  : selected.company
            }
            subtitle={
              selected?.direction === 'received'
                ? `Requested by ${selected.company}`
                : formatRole(selected?.counterpartyRole) || undefined
            }
            context={`Company identity evidence · ${contextLabel(
              context as CompanyProofRequestRow['context'],
            )}`}
            badges={
              selected && (
                <>
                  <Badge
                    label={proofStatusLabel(selected.status)}
                    variant={proofStatusVariant(selected.status)}
                  />
                  <button
                    type="button"
                    className="information-request-refresh"
                    aria-label="Refresh evidence request status"
                    title="Refresh"
                    disabled={loading}
                    onClick={() => void load()}
                  >
                    <RefreshCw size={16} aria-hidden="true" />
                  </button>
                </>
              )
            }
          />
          {loading && !data ? (
            <LoadingIndicator page label="Loading request…" />
          ) : selected?.status === 'UNAVAILABLE' ? (
            <EvidenceNextStep
              tone="closed"
              message="This request is no longer valid: a participant's authorization or binding has changed. No action is possible."
            />
          ) : selected?.sharedReference ? (
            <SharedCompanyProof key={selected.requestId} row={selected} role={role} />
          ) : context === 'custody' && data ? (
            <CustodyCompanyProof referenceId={reference} data={data} role={role} />
          ) : context === 'delivery' ? (
            data && canDelivery ? (
              <DeliveryIdentityPanel
                key={reference}
                order={deliveryOrder!}
                data={data}
                onChanged={load}
                showHeading={false}
              />
            ) : (
              <Alert
                type="warning"
                message="This delivery proof is not available to your company."
              />
            )
          ) : context === 'order' ? (
            order ? (
              <OrdersPage role={role} initialOrderId={reference} evidenceOnly mode="manage" />
            ) : (
              <Alert type="warning" message="This order proof is not available to your company." />
            )
          ) : context === 'ingredient' ? (
            <IngredientCompanyProof key={reference} role={role} requestId={reference} />
          ) : (
            <Alert type="error" message="Unknown information request type." />
          )}
        </EvidenceDetailLayout>
      </div>
    );

  return (
    <div className="information-requests-page">
      <SectionTitle
        title="Evidence Exchange"
        sub="Share and verify company and ingredient evidence."
        action={
          <Btn
            variant="outline"
            icon={<RefreshCw size={16} />}
            disabled={loading}
            onClick={() => void load()}
          >
            Refresh
          </Btn>
        }
      />
      {children && (
        <StatusTabs
          label="Information request category"
          value={showEvidence ? 'ingredient' : 'company'}
          onChange={(value) => {
            setIngredientMount((count) => count + 1);
            setParams(value === 'ingredient' ? { tab: 'evidence' } : {});
          }}
          variant="tabs"
          tabs={[
            {
              value: 'company',
              label: 'Company evidence',
              icon: <BadgeCheck size={16} />,
              count: directionRows.length,
            },
            {
              value: 'ingredient',
              label: 'Ingredient evidence',
              icon: <Layers size={16} />,
              count: ingredientCount,
            },
          ]}
        />
      )}
      <div className="evidence-toolbar">
        {!showEvidence && !initialDirection && (
          <div className="evidence-segmented" role="group" aria-label="Request direction">
            {(['received', 'sent'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={direction === value}
                onClick={() => {
                  setDirection(value);
                  setParams({ direction: value });
                }}
              >
                {value === 'received' ? 'Received' : 'Sent'}
                <strong>{rows.filter((row) => row.direction === value).length}</strong>
              </button>
            ))}
          </div>
        )}
        {!showEvidence && (
          <>
            <EvidenceStatusSelect value={status} onChange={setStatus} actionCount={actionCount} />
            <div className="evidence-toolbar__search">
              <Input
                label="Search evidence requests"
                type="search"
                icon={<Search size={16} />}
                value={search}
                onChange={setSearch}
                placeholder="Search company or purpose"
              />
            </div>
          </>
        )}
      </div>
      {error && <Alert type="error" message={error} />}
      {showEvidence ? (
        <Fragment key={ingredientMount}>{children}</Fragment>
      ) : loading ? (
        <LoadingIndicator page label="Loading evidence requests…" />
      ) : visibleRows.length ? (
        <div className="evidence-table-card">
          <PaginatedTable>
            <table className="evidence-table" aria-label="Evidence requests">
              <thead>
                <tr>
                  <th scope="col">
                    {direction === 'received' ? 'Requested by' : 'Requested from'}
                  </th>
                  <th scope="col">Request for</th>
                  <th scope="col">Fields</th>
                  <th scope="col">Deadline</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <EvidenceRequestRow
                    key={row.requestId}
                    row={row}
                    actionable={requestGroup(row, direction) === 'action'}
                    logoPath={
                      data?.companies?.find(
                        (company) =>
                          company.companyName.toLocaleLowerCase() ===
                          row.company.toLocaleLowerCase(),
                      )?.logoPath
                    }
                    onOpen={() => setParams({ context: row.context, referenceId: row.referenceId })}
                  />
                ))}
              </tbody>
            </table>
          </PaginatedTable>
        </div>
      ) : (
        <EmptyState
          icon={<Inbox size={30} />}
          title={directionRows.length ? 'No requests match these filters' : 'No evidence requests'}
          sub={
            directionRows.length
              ? 'Change the search or status filter.'
              : direction === 'received'
                ? 'Requests from other companies for your company evidence appear here.'
                : 'Evidence you request from other companies appears here.'
          }
        />
      )}
    </div>
  );
}

function EvidenceRequestRow({
  row,
  actionable,
  logoPath,
  onOpen,
}: {
  row: CompanyProofRequestRow;
  actionable: boolean;
  logoPath?: string;
  onOpen: () => void;
}) {
  const verb = actionable ? (row.direction === 'received' ? 'Respond' : 'Verify') : 'View';
  return (
    <tr className={actionable ? 'is-actionable' : undefined} onClick={onOpen}>
      <td>
        <span className="evidence-table__company">
          <CompanyAvatar name={row.company} logoPath={logoPath} size="sm" />
          <span>
            <strong>{row.company}</strong>
            <small>
              {[formatRole(row.counterpartyRole), shortWallet(row.counterpartyWallet)]
                .filter(Boolean)
                .join(' · ')}
            </small>
          </span>
        </span>
      </td>
      <td>
        <span className="evidence-table__stack">
          <strong>{contextLabel(row.context)}</strong>
          <small title={row.purpose}>{row.subject ?? row.purpose}</small>
        </span>
      </td>
      <td>
        <span className="evidence-table__stack">
          <strong>{row.requiredFieldsCount ?? '—'} required</strong>
          <small>
            {Math.max(0, (row.requestedFieldsCount ?? 0) - (row.requiredFieldsCount ?? 0))} optional
          </small>
        </span>
      </td>
      <DeadlineCell dueAt={row.expiresAt} closed={isClosed(row.status)} />
      <td>
        <Badge label={proofStatusLabel(row.status)} variant={proofStatusVariant(row.status)} />
      </td>
      <td className="evidence-table__action">
        <Btn
          size="xs"
          variant={actionable ? 'primary' : 'outline'}
          aria-label={`${verb} request from ${row.company}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {verb}
        </Btn>
      </td>
    </tr>
  );
}

/** Who, what, which fields and when — shown on every request, open or closed. */
function RequestDetails({ row, actor }: { row: CompanyProofRequestRow; actor?: string }) {
  const received = row.direction === 'received';
  const required = row.requiredClaims ?? [];
  const optional = (row.optionalClaims ?? []).filter((claim) => !required.includes(claim));
  const counterparty = {
    name: row.company,
    role: formatRole(row.counterpartyRole) || undefined,
    wallet: row.counterpartyWallet,
  };
  const you = { name: 'Your company', wallet: actor, you: true };
  return (
    <RequestSummary
      requester={received ? counterparty : you}
      provider={received ? you : counterparty}
      facts={[
        {
          label: 'Request for',
          value: (
            <>
              {contextLabel(row.context)}
              {row.subject && <small>{row.subject}</small>}
            </>
          ),
        },
        ...evidenceDateFields({
          dueAt: row.expiresAt,
          open: !isClosed(row.status),
          verifiedAt: row.verifiedAt,
        }),
      ]}
      purpose={row.purpose}
      requested={[...required, ...optional].map((claim) => ({
        claim,
        label: friendlyClaim(claim),
        required: required.includes(claim),
        state: 'requested' as const,
      }))}
    />
  );
}

function shortWallet(wallet?: string) {
  return wallet && wallet.length > 14 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
}

function formatRole(role?: string) {
  return role ? role.charAt(0) + role.slice(1).toLocaleLowerCase().replaceAll('_', ' ') : '';
}

function detailTitle(row: CompanyProofRequestRow | undefined, custody: boolean) {
  if (!row) return custody ? 'Request company evidence' : 'Company identity request';
  return row.direction === 'received'
    ? `${row.company} asks for your company identity`
    : `Company identity from ${row.company}`;
}

function isClosed(status: string) {
  return ['VERIFIED', 'UNAVAILABLE', 'EXPIRED', 'DECLINED', 'REJECTED'].includes(status);
}

function requestGroup(row: CompanyProofRequestRow, direction: 'received' | 'sent') {
  if (isClosed(row.status) || row.expiresAt * 1000 <= Date.now()) return 'closed' as const;
  if (direction === 'received' && ['REQUESTED', 'PENDING'].includes(row.status))
    return 'action' as const;
  if (direction === 'sent' && ['PRESENTED', 'SHARED'].includes(row.status))
    return 'action' as const;
  return 'open' as const;
}

function contextLabel(context: CompanyProofRequestRow['context']) {
  if (context === 'custody') return 'Custody offer';
  if (context === 'delivery') return 'Delivery';
  if (context === 'order') return 'Order';
  return 'Ingredient information';
}

function SharedCompanyProof({ row, role }: { row: CompanyProofRequestRow; role: WorkspaceRole }) {
  const [status, setStatus] = useState<CompanyIdentityProofStatus>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void getCompanyIdentityProofStatus(row.requestId)
      .then(setStatus)
      .catch((error) => setError(error.message));
  }, [row.requestId]);
  if (row.direction === 'received')
    return (
      <>
        {error && <Alert type="error" message={error} />}
        <CompanyIdentityProofAction requestId={row.requestId} role={role} />
      </>
    );
  const current = status?.status ?? row.status;
  const canVerify = ['PRESENTED', 'VERIFIED'].includes(current);
  return (
    <div className="evidence-panel">
      {error && <Alert type="error" message={error} />}
      <EvidenceNextStep
        tone={current === 'VERIFIED' ? 'done' : canVerify ? 'default' : 'closed'}
        message={
          current === 'VERIFIED'
            ? 'Verified. Nothing else to do.'
            : canVerify
              ? `${row.company} shared their details. Verify them to continue.`
              : isClosed(current)
                ? 'This request has closed.'
                : `Waiting for ${row.company} to respond.`
        }
        action={
          canVerify &&
          current !== 'VERIFIED' && (
            <Btn
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                void verifyCompanyIdentityProof(row.requestId)
                  .then(async (result) => {
                    if (result.transaction && result.actorWallet)
                      await submitProductionTransaction(result.transaction, result.actorWallet);
                    setStatus({
                      ...result,
                      ...(await getCompanyIdentityProofStatus(row.requestId)),
                    });
                  })
                  .catch((error) => setError(error.message))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Verifying…' : 'Verify company identity'}
            </Btn>
          )
        }
      />
      {status?.credential && (
        <SharedClaims
          values={status.credential as Record<string, unknown>}
          missing={status.missingClaims}
        />
      )}
    </div>
  );
}

function CustodyCompanyProof({
  referenceId,
  data,
  role,
}: {
  referenceId: string;
  data: OrdersState;
  role: WorkspaceRole;
}) {
  const [offer, setOffer] = useState<CustodyOffer>(),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setOffer((await getCustodyOffer(referenceId)).offer);
    } catch (cause) {
      setError(reportError(cause, 'Custody offer unavailable.'));
    }
  }, [referenceId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <Alert type="error" message={error} />;
  if (!offer) return <LoadingIndicator page label="Loading request…" />;
  const delivery = {
    distributor: offer.distributor,
    stage:
      offer.status === 'REQUESTED'
        ? 2
        : ['ACCEPTED', 'SCHEDULED'].includes(offer.status)
          ? 3
          : offer.status === 'DISPATCHED'
            ? 4
            : offer.status === 'RECEIVED'
              ? 5
              : 6,
  };
  const item = (data.catalogue ?? []).find((entry) =>
    (entry.batches ?? []).some((batchId: string) => same(batchId, offer.batchId)),
  );
  return (
    <div className="evidence-panel">
      <div className="evidence-context-strip">
        <span>
          <small>Custody offer</small>
          <strong>{offer.itemName || item?.name || 'Registered stock'}</strong>
        </span>
        <span>
          <small>Quantity</small>
          <strong>
            {offer.quantity} {offer.unit}
          </strong>
        </span>
        <span>
          <small>Offer status</small>
          <strong>{offerStatusLabel(offer.status)}</strong>
        </span>
        <Link to={custodyOfferPath(role, offer.offerId)}>View custody offer</Link>
      </div>
      <DeliveryIdentityPanel
        data={data}
        order={{
          orderId: offer.offerId,
          seller: offer.sender,
          buyer: offer.distributor,
          expiresAt: offer.expiresAt,
          delivery,
          ...(offer.kind === 2 ? { productDelivery: delivery } : {}),
        }}
        requestedBy={offer.distributorName}
        hideRefresh
        showHeading={false}
        onChanged={load}
      />
      <TechnicalDetails
        fields={[
          { label: 'Offer ID', value: offer.offerId },
          { label: 'Batch ID', value: offer.batchId },
          { label: 'Raw custody status', value: offer.status },
          { label: 'Sender wallet', value: offer.sender },
          { label: 'Distributor wallet', value: offer.distributor },
        ]}
      />
    </div>
  );
}

function custodyOfferPath(role: WorkspaceRole, offerId: string) {
  const page = role === 'distributor' ? 'intake' : 'transfers';
  return `${workspacePath(role, page)}?offerId=${encodeURIComponent(offerId)}`;
}

function offerStatusLabel(status: CustodyOffer['status']) {
  return (
    {
      REQUESTED: 'Awaiting acceptance',
      ACCEPTED: 'Accepted',
      SCHEDULED: 'Pickup arranged',
      REJECTED: 'Rejected',
      DISPATCHED: 'In transit',
      RECEIVED: 'Received',
      EXPIRED: 'Expired',
    } satisfies Record<CustodyOffer['status'], string>
  )[status];
}

function IngredientCompanyProof({ role, requestId }: { role: WorkspaceRole; requestId: string }) {
  const [required, setRequired] = useState<string[]>([...COMPANY_ALWAYS_CLAIMS]);
  const [optional, setOptional] = useState<string[]>([]);
  const [purpose, setPurpose] = useState(
    'Verify requesting company identity before sharing ingredient evidence',
  );
  const [deadline, setDeadline] = useState('');
  const [status, setStatus] = useState<CompanyIdentityProofStatus>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void getCompanyIdentityProofStatus(requestId)
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [requestId]);
  const run = async (verify: boolean) => {
    setBusy(true);
    setError('');
    try {
      const normalized = normalizeCompanyRequestFields(required, optional);
      const result = verify
        ? await verifyCompanyIdentityProof(requestId)
        : await requestCompanyIdentityProof(requestId, {
            purpose,
            requiredClaims: normalized.required,
            optionalClaims: normalized.optional,
            ...(deadline ? { expiresAt: Math.floor(Date.parse(deadline) / 1000) } : {}),
          });
      if (result.transaction && result.actorWallet)
        await submitProductionTransaction(result.transaction, result.actorWallet);
      setStatus({ ...result, ...(await getCompanyIdentityProofStatus(requestId)) });
    } catch (cause) {
      setError(reportError(cause, 'Company proof action failed.'));
    } finally {
      setBusy(false);
    }
  };
  if (!status)
    return (
      <>
        {error && <Alert type="error" message={error} />}
        {!error && <LoadingIndicator page label="Loading request…" />}
      </>
    );
  if (role !== 'supplier') return <CompanyIdentityProofAction requestId={requestId} role={role} />;
  const canRequest = ['NOT_REQUESTED', 'EXPIRED'].includes(status.status);
  const canVerify = status.status === 'PRESENTED';
  return (
    <div className="evidence-panel">
      {error && <Alert type="error" message={error} />}
      <EvidenceNextStep
        tone={status.status === 'VERIFIED' ? 'done' : 'default'}
        message={
          canRequest
            ? 'Ask the requesting company to prove its identity before you share ingredient evidence.'
            : canVerify
              ? 'The company shared its details. Verify them to continue.'
              : status.status === 'VERIFIED'
                ? `Verified${status.verifiedAt ? ` on ${new Date(status.verifiedAt).toLocaleString()}` : ''}. Nothing else to do.`
                : 'Waiting for the company to respond.'
        }
        action={
          canVerify && (
            <Btn disabled={busy} onClick={() => void run(true)}>
              Verify company proof
            </Btn>
          )
        }
      />
      {canRequest && (
        <div className="evidence-request-form">
          <CompanyRequestFields
            required={required}
            optional={optional}
            onChange={(r, o) => {
              setRequired(r);
              setOptional(o);
            }}
          />
          <Input label="Purpose" value={purpose} onChange={setPurpose} maxLength={500} />
          <Input label="Deadline" type="datetime-local" value={deadline} onChange={setDeadline} />
          <div className="company-evidence-card__footer">
            <Btn disabled={busy || !purpose.trim()} onClick={() => void run(false)}>
              Request company proof
            </Btn>
          </div>
        </div>
      )}
      {status.checks?.length ? (
        <p className="evidence-panel__checks">Checks: {status.checks.join(' · ')}</p>
      ) : null}
    </div>
  );
}
