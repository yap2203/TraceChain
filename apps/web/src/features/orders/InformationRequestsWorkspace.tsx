import { reportError } from '../../components/ui/feedback';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox, RefreshCw, Search } from 'lucide-react';
import {
  getInformationRequests,
  getOrders,
  getCustodyOffer,
  type CustodyOffer,
  type CompanyProofRequestRow,
  type OrdersState,
} from './orders.api';
import { DeliveryIdentityPanel } from './DeliveryIdentityPanel';
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
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  Input,
  SectionTitle,
  Table,
  TD,
  TR,
} from '../workspaces/shared/ui';
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
  const showEvidence = params.get('tab') === 'evidence' && children;
  return (
    <div className="grid min-w-0 gap-[16px]">
      <SectionTitle
        title={
          initialDirection
            ? `${initialDirection === 'received' ? 'Received' : 'Sent'} information requests`
            : 'Information requests'
        }
        sub="Review requests for company identity or ingredient evidence. Sharing and verification are separate actions."
        action={
          <Btn
            variant="outline"
            icon={<RefreshCw size={16} />}
            disabled={loading}
            onClick={() => void load()}
          >
            Refresh requests
          </Btn>
        }
      />
      {!initialDirection && (
        <nav className="flex flex-wrap gap-[8px]" aria-label="Information request category">
          <Btn
            aria-pressed={!showEvidence}
            variant={!showEvidence ? 'primary' : 'outline'}
            onClick={() => setParams({})}
          >
            Company credential requests
          </Btn>
          {children && (
            <Btn
              variant={showEvidence ? 'primary' : 'outline'}
              aria-pressed={!!showEvidence}
              onClick={() => setParams({ tab: 'evidence' })}
            >
              Ingredient evidence
            </Btn>
          )}
        </nav>
      )}
      {error && <Alert type="error" message={error} />}
      {showEvidence ? (
        children
      ) : reference ? (
        <>
          <Btn
            variant="outline"
            onClick={() => {
              setParams({});
              void load();
            }}
          >
            Back to company requests
          </Btn>
          {loading && !data ? (
            <LoadingIndicator page label="Checking request participants…" />
          ) : selected?.status === 'UNAVAILABLE' ? (
            <Alert
              type="warning"
              message="This historical proof request is unavailable for further actions. Its participant binding or current authorization is no longer valid."
            />
          ) : context === 'custody' && data ? (
            <CustodyCompanyProof referenceId={reference} data={data} />
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
          {loading ? (
            <LoadingIndicator page label="Loading your company proof requests…" />
          ) : (
            <Card padding="0">
              <Table headers={['Company', 'Context', 'Purpose', 'Deadline', 'Status', '']}>
                {rows
                  .filter(
                    (row) =>
                      row.direction === direction &&
                      [row.company, row.purpose, row.status, row.referenceId]
                        .join(' ')
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
                  .map((row) => (
                    <TR key={row.requestId}>
                      <TD bold>{row.company}</TD>
                      <TD>
                        {row.context === 'custody'
                          ? 'Custody offer'
                          : row.context === 'delivery'
                            ? 'Custody / delivery'
                            : row.context === 'order'
                              ? 'Quantity request'
                              : 'Ingredient information'}
                      </TD>
                      <TD>{row.purpose}</TD>
                      <TD>{new Date(row.expiresAt * 1000).toLocaleString()}</TD>
                      <TD>
                        <Badge
                          label={row.status === 'VERIFIED' ? 'Previously verified' : row.status}
                          variant={row.status === 'VERIFIED' ? 'verified' : 'pending'}
                        />
                      </TD>
                      <TD>
                        <Btn
                          variant="outline"
                          onClick={() =>
                            setParams({ context: row.context, referenceId: row.referenceId })
                          }
                        >
                          Manage proof request
                        </Btn>
                      </TD>
                    </TR>
                  ))}
              </Table>
              {!rows.some((row) => row.direction === direction) && (
                <EmptyState
                  icon={<Inbox size={30} />}
                  title="No company proof requests"
                  sub="Company evidence requests linked to your orders, custody shipments and ingredient information appear here."
                />
              )}
            </Card>
          )}
        </>
      )}
      {initialDirection && children && !showEvidence && !reference && (
        <section className="workspace-request-section" aria-label="Ingredient evidence requests">
          {children}
        </section>
      )}
    </div>
  );
}
function CustodyCompanyProof({ referenceId, data }: { referenceId: string; data: OrdersState }) {
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
  return (
    <Card>
      <h3>Company evidence for this custody offer</h3>
      <p>Verification and custody acceptance are separate decisions.</p>
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
        onChanged={load}
      />
    </Card>
  );
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
            <p>Last verification: {new Date(status.verifiedAt).toLocaleString()}</p>
          )}
        </>
      ) : (
        status && <CompanyIdentityProofAction requestId={requestId} role={role} />
      )}
    </Card>
  );
}
