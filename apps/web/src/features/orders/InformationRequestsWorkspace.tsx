import { reportError } from '../../components/ui/feedback';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ChevronRight,
  Clock3,
  Inbox,
  PackageSearch,
  RefreshCw,
  Search,
} from 'lucide-react';
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
  getEvidenceDetails,
  requestCompanyIdentityProof,
  verifyCompanyIdentityProof,
  type CompanyIdentityProofStatus,
} from '../production-flow/production-flow.api';
import { sendCompanyIdentityRequestMessage } from '../production-flow/evidence-didcomm';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';
import { workspacePath } from '../workspaces/workspace-paths';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  Input,
  SectionTitle,
  StatusTabs,
  TechnicalDetails,
} from '../workspaces/shared/ui';
import { CompanyAvatar } from './CatalogueMedia';
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
    [status, setStatus] = useState<'all' | 'pending' | 'verified' | 'unavailable'>('all'),
    [selectedDirection, setDirection] = useState<'received' | 'sent'>('received');
  const direction = initialDirection ?? selectedDirection;
  const reference = params.get('referenceId') ?? params.get('orderId') ?? '',
    context = params.get('context') ?? 'order';
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [requests, orders] = await Promise.all([getInformationRequests(), getOrders()]);
      setRows(requests.requests);
      setData(orders);
    } catch (cause) {
      setError(reportError(cause, 'Information requests unavailable.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
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
  const directionRows = useMemo(
    () => rows.filter((row) => row.direction === direction),
    [direction, rows],
  );
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return directionRows.filter((row) => {
      const group = requestGroup(row.status);
      return (
        (status === 'all' || status === group) &&
        (!query ||
          [row.company, row.purpose, row.status, row.referenceId, contextLabel(row.context)]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query))
      );
    });
  }, [directionRows, search, status]);
  return (
    <div className={`information-requests-page${requestDetail ? ' is-detail' : ''}`}>
      {requestDetail && (
        <nav className="information-request-breadcrumb" aria-label="Breadcrumb">
          <button
            type="button"
            onClick={() => {
              setParams({});
              void load();
            }}
          >
            Received requests
          </button>
          <ChevronRight size={14} aria-hidden="true" />
          {custodyDetail ? (
            <Link to={custodyOfferPath(role, reference)}>Custody offer</Link>
          ) : (
            <span>{contextLabel(context as CompanyProofRequestRow['context'])}</span>
          )}
          <ChevronRight size={14} aria-hidden="true" />
          <span aria-current="page">Company evidence</span>
        </nav>
      )}
      <SectionTitle
        title={
          requestDetail
            ? 'Company evidence request'
            : initialDirection
              ? `${initialDirection === 'received' ? 'Received' : 'Sent'} information requests`
              : 'Information requests'
        }
        sub={
          requestDetail
            ? custodyDetail
              ? 'Review and respond to evidence requests for this custody offer.'
              : 'Review and respond to this company evidence request.'
            : 'Review and respond to company or ingredient evidence requests.'
        }
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
        <div className="information-request-category-tabs">
          <StatusTabs
            label="Information request category"
            value={showEvidence ? 'ingredient' : 'company'}
            onChange={(value) => setParams(value === 'ingredient' ? { tab: 'evidence' } : {})}
            variant="connected"
            tabs={[
              { value: 'company', label: 'Company evidence', count: directionRows.length },
              {
                value: 'ingredient',
                label: 'Ingredient evidence',
                count: showEvidence ? 1 : 0,
              },
            ]}
          />
        </div>
      )}
      {error && <Alert type="error" message={error} />}
      {showEvidence ? (
        children
      ) : reference ? (
        <>
          {loading && !data ? (
            <LoadingIndicator page label="Checking request participants…" />
          ) : selected?.status === 'UNAVAILABLE' ? (
            <Alert
              type="warning"
              message="This historical proof request is unavailable for further actions. Its participant binding or current authorization is no longer valid."
            />
          ) : context === 'custody' && data ? (
            <CustodyCompanyProof referenceId={reference} data={data} role={role} />
          ) : context === 'delivery' ? (
            data && canDelivery ? (
              <Card>
                <h3>
                  {order?.productDelivery ? 'Manufacturer' : 'Supplier'} company credential proof
                </h3>
                <p>
                  {selected?.purpose ??
                    'Review the seller company identity before custody acceptance or dispatch.'}
                </p>
                <DeliveryIdentityPanel
                  key={reference}
                  order={deliveryOrder!}
                  data={data}
                  onChanged={load}
                />
              </Card>
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
        </>
      ) : (
        <>
          {!initialDirection && (
            <nav className="workspace-secondary-tabs" aria-label="Company proof direction">
              <Btn
                variant={direction === 'received' ? 'primary' : 'outline'}
                aria-pressed={direction === 'received'}
                onClick={() => setDirection('received')}
              >
                Received requests
              </Btn>
              <Btn
                variant={direction === 'sent' ? 'primary' : 'outline'}
                aria-pressed={direction === 'sent'}
                onClick={() => setDirection('sent')}
              >
                Sent requests
              </Btn>
            </nav>
          )}
          <div className="information-request-list-controls">
            <p className="workspace-list-guidance">
              {direction === 'received'
                ? 'Other companies are asking your company to share information.'
                : 'Track information your company has requested from others.'}
            </p>
            <Input
              label="Search company requests"
              type="search"
              icon={<Search size={16} />}
              value={search}
              onChange={setSearch}
              placeholder="Search company, purpose, reference or status"
            />
            <div className="information-request-status-filters">
              <StatusTabs
                label="Filter information requests by status"
                value={status}
                onChange={setStatus}
                variant="connected"
                tabs={[
                  { value: 'all', label: 'All', count: directionRows.length },
                  {
                    value: 'pending',
                    label: 'Pending',
                    count: directionRows.filter((row) => requestGroup(row.status) === 'pending')
                      .length,
                  },
                  {
                    value: 'verified',
                    label: 'Verified',
                    count: directionRows.filter((row) => requestGroup(row.status) === 'verified')
                      .length,
                  },
                  {
                    value: 'unavailable',
                    label: 'Unavailable',
                    count: directionRows.filter((row) => requestGroup(row.status) === 'unavailable')
                      .length,
                  },
                ]}
              />
            </div>
          </div>
          {loading ? (
            <LoadingIndicator page label="Loading your company proof requests…" />
          ) : (
            <div className="information-request-list">
              {visibleRows.map((row) => (
                <InformationRequestCard
                  key={row.requestId}
                  row={row}
                  direction={direction}
                  data={data}
                  onReview={() => setParams({ context: row.context, referenceId: row.referenceId })}
                />
              ))}
              {!visibleRows.length && (
                <EmptyState
                  icon={<Inbox size={30} />}
                  title={
                    directionRows.length
                      ? 'No requests match these filters'
                      : 'No company proof requests'
                  }
                  sub={
                    directionRows.length
                      ? 'Change the search or selected status to see other requests.'
                      : 'Company evidence requests linked to your orders, custody shipments and ingredient information appear here.'
                  }
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function contextLabel(context: CompanyProofRequestRow['context']) {
  if (context === 'custody') return 'Custody offer';
  if (context === 'delivery') return 'Custody / delivery';
  if (context === 'order') return 'Quantity request';
  return 'Ingredient information';
}

function requestGroup(status: string): 'pending' | 'verified' | 'unavailable' {
  if (status === 'VERIFIED') return 'verified';
  if (['UNAVAILABLE', 'EXPIRED', 'DECLINED', 'REJECTED'].includes(status)) return 'unavailable';
  return 'pending';
}

function requestNextAction(row: CompanyProofRequestRow, direction: 'received' | 'sent') {
  if (row.status === 'VERIFIED') return 'No action required';
  if (['UNAVAILABLE', 'EXPIRED'].includes(row.status)) return 'No action available';
  if (['PRESENTED', 'SHARED'].includes(row.status)) return 'Review shared evidence';
  return direction === 'received' ? 'Review and respond' : 'Await company response';
}

function requestActionMessage(row: CompanyProofRequestRow, direction: 'received' | 'sent') {
  if (row.status === 'VERIFIED') return 'The company evidence has been verified.';
  if (['UNAVAILABLE', 'EXPIRED'].includes(row.status))
    return 'This request is no longer available for a response.';
  if (['PRESENTED', 'SHARED'].includes(row.status))
    return direction === 'received'
      ? 'Review the shared evidence and its verification status.'
      : 'Your company evidence has been shared for review.';
  return direction === 'received'
    ? 'Review the request and choose whether to share your company evidence.'
    : `Wait for ${row.company} to review and respond to the evidence request.`;
}

function InformationRequestCard({
  row,
  direction,
  data,
  onReview,
}: {
  row: CompanyProofRequestRow;
  direction: 'received' | 'sent';
  data?: OrdersState;
  onReview: () => void;
}) {
  const actor = data?.companies?.find((company) => same(company.wallet, data.actor));
  const actorCompany = {
    name: actor?.companyName ?? registeredCompanyFallback(data?.role),
    logoPath: actor?.logoPath,
  };
  const counterparty = data?.companies?.find(
    (company) => company.companyName.toLocaleLowerCase() === row.company.toLocaleLowerCase(),
  );
  const counterpartyCompany = { name: row.company, logoPath: counterparty?.logoPath };
  const requesting = direction === 'received' ? counterpartyCompany : actorCompany;
  const responding = direction === 'received' ? actorCompany : counterpartyCompany;
  const deadline = deadlineIndicator(row.expiresAt);

  return (
    <article className="information-request-card">
      <div className="information-request-card__heading">
        <div>
          <span>{contextLabel(row.context)}</span>
          <h3>Company identity verification</h3>
          <p>{row.purpose}</p>
        </div>
        <div className="information-request-card__badges">
          <Badge label={proofStatusLabel(row.status)} variant={proofStatusVariant(row.status)} />
          {deadline && <Badge label={deadline.label} variant={deadline.variant} />}
        </div>
      </div>
      <div className="information-request-card__parties" aria-label="Request participants">
        <RequestParty
          label="Requesting company"
          name={requesting.name}
          logoPath={requesting.logoPath}
        />
        <span className="information-request-card__direction" aria-hidden="true">
          <ArrowRight size={18} />
        </span>
        <RequestParty
          label="Responding company"
          name={responding.name}
          logoPath={responding.logoPath}
        />
      </div>
      <dl className="information-request-card__facts">
        <div>
          <dt>Related to</dt>
          <dd>{contextLabel(row.context)}</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>{row.requestedAt ? formatRequestDate(row.requestedAt) : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>{formatRequestDate(row.expiresAt)}</dd>
        </div>
        <div>
          <dt>Evidence requested</dt>
          <dd>Company identity</dd>
        </div>
        <div>
          <dt>Next action</dt>
          <dd>{requestNextAction(row, direction)}</dd>
        </div>
      </dl>
      <div className="information-request-card__next">
        <span className="information-request-card__next-icon" aria-hidden="true">
          <Clock3 size={17} />
        </span>
        <p>
          <strong>Next action:</strong> {requestActionMessage(row, direction)}
        </p>
        <Btn variant="primary" onClick={onReview}>
          Review request
        </Btn>
      </div>
      <TechnicalDetails
        fields={[
          { label: 'Request ID', value: row.requestId },
          { label: 'Reference ID', value: row.referenceId },
          { label: 'Raw proof status', value: row.status },
        ]}
      />
    </article>
  );
}

function registeredCompanyFallback(role?: string) {
  if (!role) return 'Registered company';
  return `Registered ${role.charAt(0)}${role.slice(1).toLocaleLowerCase()} company`;
}

function deadlineIndicator(expiresAt: number) {
  const remaining = expiresAt * 1000 - Date.now();
  if (remaining <= 0) return { label: 'Overdue', variant: 'rejected' as const };
  if (remaining <= 48 * 60 * 60 * 1000) return { label: 'Due soon', variant: 'pending' as const };
  return undefined;
}

function formatRequestDate(value: string | number) {
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

function RequestParty({
  label,
  name,
  logoPath,
}: {
  label: string;
  name: string;
  logoPath?: string;
}) {
  return (
    <span className="information-request-card__party">
      <CompanyAvatar name={name} logoPath={logoPath} size="md" />
      <span>
        <small>{label}</small>
        <strong>{name}</strong>
      </span>
    </span>
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
  if (!offer) return <LoadingIndicator page label="Checking custody request participants…" />;
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
  const batch = item?.batchDetails?.find((entry: { batchId?: string }) =>
    same(entry.batchId, offer.batchId),
  );
  return (
    <div className="custody-evidence-detail">
      <Card className="custody-evidence-context">
        <div className="custody-evidence-context__heading">
          <span>
            <PackageSearch size={18} aria-hidden="true" />
          </span>
          <div>
            <small>Custody offer</small>
            <h3>{offer.itemName || item?.name || 'Registered stock'}</h3>
            <p>{batch?.batchReference ?? item?.batchReference ?? shortReference(offer.batchId)}</p>
          </div>
          <Badge
            label={offerStatusLabel(offer.status)}
            variant={offerStatusVariant(offer.status)}
          />
        </div>
        <dl className="custody-evidence-context__facts">
          <div>
            <dt>Requesting company</dt>
            <dd>{offer.distributorName}</dd>
          </div>
          <div>
            <dt>Quantity</dt>
            <dd>
              {offer.quantity} {offer.unit}
            </dd>
          </div>
          <div>
            <dt>Reference</dt>
            <dd>{shortReference(offer.offerId)}</dd>
          </div>
        </dl>
        <div className="custody-evidence-context__actions">
          <Link
            className="custody-evidence-context__link"
            to={custodyOfferPath(role, offer.offerId)}
          >
            View custody offer
          </Link>
        </div>
        <TechnicalDetails
          fields={[
            { label: 'Offer ID', value: offer.offerId },
            { label: 'Batch ID', value: offer.batchId },
            { label: 'Raw custody status', value: offer.status },
            { label: 'Sender wallet', value: offer.sender },
            { label: 'Distributor wallet', value: offer.distributor },
          ]}
        />
      </Card>
      <Alert
        type="info"
        message="Evidence verification and custody acceptance are separate. Sharing evidence does not accept or move the stock."
      />
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
        onChanged={load}
      />
    </div>
  );
}

function custodyOfferPath(role: WorkspaceRole, offerId: string) {
  const page = role === 'distributor' ? 'intake' : 'transfers';
  return `${workspacePath(role, page)}?offerId=${encodeURIComponent(offerId)}`;
}

function shortReference(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
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

function offerStatusVariant(status: CustodyOffer['status']) {
  if (status === 'RECEIVED') return 'verified' as const;
  if (['REJECTED', 'EXPIRED'].includes(status)) return 'rejected' as const;
  return 'pending' as const;
}
function IngredientCompanyProof({ role, requestId }: { role: WorkspaceRole; requestId: string }) {
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
      if (verify) setStatus(await verifyCompanyIdentityProof(requestId));
      else {
        setStatus(await requestCompanyIdentityProof(requestId));
        await sendCompanyIdentityRequestMessage(await getEvidenceDetails(requestId));
      }
    } catch (cause) {
      setError(reportError(cause, 'Company proof action failed.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <h3>Company credential evidence</h3>
      {error && <Alert type="error" message={error} />}
      <p>{status?.purpose ?? 'Company proof linked to this ingredient information request.'}</p>
      <p>Status: {status?.status ?? 'Checking authorization…'}</p>
      {status && role === 'supplier' ? (
        <>
          <Btn
            disabled={busy || !['NOT_REQUESTED', 'EXPIRED'].includes(status.status)}
            onClick={() => void run(false)}
          >
            Request company proof
          </Btn>
          <Btn
            variant="outline"
            disabled={busy || !['PRESENTED', 'VERIFIED'].includes(status.status)}
            onClick={() => void run(true)}
          >
            Verify company proof
          </Btn>
          {status.checks && (
            <ul>
              {status.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          )}
          {status.verifiedAt && (
            <p>
              Last successful verification (historical):{' '}
              {new Date(status.verifiedAt).toLocaleString()}. This does not grant business
              acceptance; protected actions check current authorization again.
            </p>
          )}
        </>
      ) : (
        status && <CompanyIdentityProofAction requestId={requestId} role={role} />
      )}
    </Card>
  );
}
