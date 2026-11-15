import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox, RefreshCw, Search } from 'lucide-react';
import {
  getInformationRequests,
  getOrders,
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
}: {
  role: WorkspaceRole;
  children?: ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<CompanyProofRequestRow[]>([]),
    [data, setData] = useState<OrdersState>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(''),
    [direction, setDirection] = useState('received');
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
      setError(cause instanceof Error ? cause.message : 'Information requests unavailable.');
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
    : order;
  const canDelivery =
    deliveryOrder?.delivery &&
    (same(data?.actor, deliveryOrder.seller) ||
      same(data?.actor, deliveryOrder.delivery.distributor));
  const showEvidence = params.get('tab') === 'evidence' && children;
  return (
    <div className="grid min-w-0 gap-[16px]">
      <SectionTitle
        title="Information requests"
        sub="Manage Company Role credential proofs here. Presenting, verifying, order approval and physical delivery remain separate actions."
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
      <nav className="flex flex-wrap gap-[8px]" aria-label="Information request category">
        <Btn variant={!showEvidence ? 'primary' : 'outline'} onClick={() => setParams({})}>
          Company credential requests
        </Btn>
        {children && (
          <Btn
            variant={showEvidence ? 'primary' : 'outline'}
            onClick={() => setParams({ tab: 'evidence' })}
          >
            Ingredient evidence
          </Btn>
        )}
      </nav>
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
            <p role="status">Checking request participants…</p>
          ) : selected?.status === 'UNAVAILABLE' ? (
            <Alert
              type="warning"
              message="This historical proof request is unavailable for further actions. Its participant binding or current authorization is no longer valid."
            />
          ) : context === 'delivery' ? (
            data && canDelivery ? (
              <Card>
                <h3>Supplier company credential proof</h3>
                <p>
                  {selected?.purpose ??
                    'Review the Supplier identity before custody acceptance or dispatch.'}
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
          <div className="flex flex-wrap gap-[8px]" aria-label="Company proof direction">
            <Btn
              variant={direction === 'received' ? 'primary' : 'outline'}
              onClick={() => setDirection('received')}
            >
              Received requests
            </Btn>
            <Btn
              variant={direction === 'sent' ? 'primary' : 'outline'}
              onClick={() => setDirection('sent')}
            >
              Sent requests
            </Btn>
          </div>
          <Input
            label="Search company requests"
            type="search"
            icon={<Search size={16} />}
            value={search}
            onChange={setSearch}
            placeholder="Search company, purpose, reference or status"
          />
          {loading ? (
            <p role="status">Loading your company proof requests…</p>
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
                        {row.context === 'delivery'
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
    </div>
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
      setError(cause instanceof Error ? cause.message : 'Company proof action failed.');
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
