import { BackNavigation } from '../../../../components/ui/BackNavigation';
import { reportError } from '../../../../components/ui/feedback';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { useCallback, useEffect, useState } from 'react';
import { Inbox, Send, RefreshCw, Search } from 'lucide-react';
import {
  listEvidenceRequests,
  getCompanyIdentityProofStatus,
  type ProductionEvidenceRequest,
} from '../../../production-flow/production-flow.api';
import { getOrders, orderIdentity, type OrdersState } from '../../../orders/orders.api';
import { OrdersPage } from '../../../orders/OrdersPage';
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
} from '../../shared/ui';
import { chainDate } from '../../shared/operational-format';
import { PaginatedTable } from '../../../../components/ui/PaginatedTable';
import {
  DeadlineCell,
  EvidenceStatusSelect,
  ingredientEvidenceStatus,
  ingredientRequestGroup,
  matchesStatusFilter,
  type EvidenceStatusFilter,
} from '../../../orders/EvidenceParts';
import {
  getIngredientBatches,
  type RegisteredIngredientBatch,
} from '../batches/ingredient-batch.api';

const canRespond = (request: ProductionEvidenceRequest) =>
  request.status === 1 && request.dueAt * 1000 > Date.now();
const roleLabel = (role?: string) =>
  role ? role.charAt(0) + role.slice(1).toLocaleLowerCase() : '';
const statuses = [
  'Unknown',
  'Awaiting response',
  'Evidence received',
  'Accepted',
  'Declined',
  'Rejected',
  'Cancelled',
];
const short = (value: string) =>
  value ? value.slice(0, 8) + '...' + value.slice(-6) : 'Unavailable';
type Sent = {
  kind: 'order' | 'ingredient';
  id: string;
  recipient: string;
  purpose: string;
  status: string;
  expiresAt?: number;
  request?: ProductionEvidenceRequest;
};
export function InformationRequests({
  onRespond,
  initialOrderId,
  initialDirection = 'received',
  onClearSelection,
  hideDirection = false,
}: {
  onRespond: (request: ProductionEvidenceRequest) => void;
  initialOrderId?: string;
  initialDirection?: 'received' | 'sent';
  onClearSelection?: () => void;
  hideDirection?: boolean;
}) {
  const [requests, setRequests] = useState<ProductionEvidenceRequest[]>([]);
  const [sent, setSent] = useState<Sent[]>([]),
    [selectedOrder, setSelectedOrder] = useState(initialOrderId);
  const [direction, setDirection] = useState<'received' | 'sent'>(
    initialOrderId ? 'sent' : initialDirection,
  );
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [sentError, setSentError] = useState(''),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState<EvidenceStatusFilter>('all');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSentError('');
    if (hideDirection && initialDirection === 'received' && !initialOrderId) {
      try {
        setRequests((await listEvidenceRequests()).requests);
      } catch (cause) {
        setError(reportError(cause, 'Received evidence requests are unavailable.'));
      } finally {
        setLoading(false);
      }
      return;
    }
    const results = await Promise.allSettled([listEvidenceRequests(), getOrders()]);
    const incoming = results[0].status === 'fulfilled' ? results[0].value.requests : [];
    setRequests(incoming);
    if (results[0].status === 'rejected')
      setError(results[0].reason.message ?? 'Received evidence requests are unavailable.');
    const outgoing: Sent[] = [];
    const pending: Promise<void>[] = [];
    if (results[1].status === 'fulfilled') {
      const data = results[1].value as OrdersState;
      for (const order of data.orders.filter(
        (entry) =>
          entry.seller.toLowerCase() === data.actor.toLowerCase() &&
          entry.identityChallenge &&
          !/^0x0+$/.test(entry.identityChallenge),
      )) {
        pending.push(
          orderIdentity(order.orderId, { action: 'status' }).then((status) => {
            outgoing.push({
              kind: 'order',
              id: order.orderId,
              recipient: order.buyerName ?? short(order.buyer),
              purpose: status.purpose ?? 'Company identity evidence',
              status: status.status,
              expiresAt: status.expiresAt,
            });
          }),
        );
      }
    } else
      setSentError(
        results[1].reason.message ?? 'Quantity-linked company requests are unavailable.',
      );
    for (const request of incoming)
      pending.push(
        getCompanyIdentityProofStatus(request.requestId).then((status) => {
          if (status.status !== 'NOT_REQUESTED')
            outgoing.push({
              kind: 'ingredient',
              id: request.requestId,
              recipient:
                request.requesterName ?? request.manufacturerName ?? short(request.requester ?? ''),
              purpose: status.purpose ?? 'Company identity evidence',
              status: status.status,
              expiresAt: status.expiresAt,
              request,
            });
        }),
      );
    const statuses = await Promise.allSettled(pending);
    if (statuses.some((result) => result.status === 'rejected'))
      setSentError(
        'Some sent evidence statuses could not be checked. Refresh before making a decision.',
      );
    setSent(outgoing.sort((a, b) => a.id.localeCompare(b.id)));
    setLoading(false);
  }, [hideDirection, initialDirection, initialOrderId]);
  useEffect(() => {
    void load();
  }, [load]);
  const [batches, setBatches] = useState<RegisteredIngredientBatch[]>([]);
  useEffect(() => {
    // Display only: ingredient names instead of on-chain batch IDs.
    void getIngredientBatches()
      .then((result) => setBatches(result.batches))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (initialOrderId) {
      setSelectedOrder(initialOrderId);
      setDirection('sent');
    }
  }, [initialOrderId]);
  if (selectedOrder)
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <BackNavigation
          onClick={() => {
            setSelectedOrder(undefined);
            onClearSelection?.();
            void load();
          }}
        >
          Back to Information requests
        </BackNavigation>
        <OrdersPage
          key={selectedOrder}
          role="supplier"
          initialOrderId={selectedOrder}
          evidenceOnly
        />
      </div>
    );
  const batchFor = (batchId: string) =>
    batches.find((batch) => batch.batchId.toLowerCase() === batchId.toLowerCase());
  const receivedShown = requests.filter(
    (request) =>
      matchesStatusFilter(status, ingredientRequestGroup(request, 'received')) &&
      (
        (request.requesterName ?? request.manufacturerName ?? '') +
        request.requestId +
        (batchFor(request.ingredientBatchId)?.ingredientName ?? '') +
        (batchFor(request.ingredientBatchId)?.batchReference ?? '')
      )
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const sentShown = sent.filter((request) =>
    (request.recipient + request.purpose + request.id).toLowerCase().includes(search.toLowerCase()),
  );
  // Inside Evidence Exchange: the page already has a title and refresh, so show a compact table.
  if (hideDirection && direction === 'received')
    return (
      <div className="information-requests-page">
        <div className="evidence-toolbar">
          <EvidenceStatusSelect
            value={status}
            onChange={setStatus}
            actionCount={
              requests.filter((request) => ingredientRequestGroup(request, 'received') === 'action')
                .length
            }
          />
          <div className="evidence-toolbar__search">
            <Input
              label="Search ingredient evidence requests"
              type="search"
              icon={<Search size={16} />}
              placeholder="Search company or ingredient"
              value={search}
              onChange={setSearch}
            />
          </div>
        </div>
        {error && <Alert type="error" message={error} />}
        {loading ? (
          <LoadingIndicator page layout="table" label="Loading ingredient evidence requests…" />
        ) : !receivedShown.length ? (
          <EmptyState
            icon={<Inbox size={30} />}
            title={
              requests.length
                ? 'No requests match these filters'
                : 'No ingredient evidence requests'
            }
            sub="When a Manufacturer or Retailer asks about one of your ingredient batches, it appears here."
          />
        ) : (
          <div className="evidence-table-card">
            <PaginatedTable>
              <table className="evidence-table" aria-label="Ingredient evidence requests">
                <thead>
                  <tr>
                    <th scope="col">Requested by</th>
                    <th scope="col">Ingredient</th>
                    <th scope="col">Deadline</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...receivedShown]
                    .sort((a, b) => b.updatedAt - a.updatedAt || b.dueAt - a.dueAt)
                    .map((request) => {
                      const batch = batchFor(request.ingredientBatchId);
                      const status = ingredientEvidenceStatus(request.status, request.dueAt);
                      const company =
                        request.requesterName ??
                        request.manufacturerName ??
                        short(request.requester);
                      const respond = canRespond(request);
                      return (
                        <tr
                          key={request.requestId}
                          className={respond ? 'is-actionable' : undefined}
                          onClick={() => onRespond(request)}
                        >
                          <td>
                            <span className="evidence-table__stack">
                              <strong>{company}</strong>
                              <small>
                                {[roleLabel(request.requesterRole), short(request.requester)]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </small>
                            </span>
                          </td>
                          <td>
                            <span className="evidence-table__stack">
                              <strong>{batch?.ingredientName ?? 'Ingredient batch'}</strong>
                              <small>
                                {batch
                                  ? `Batch ${batch.batchReference}`
                                  : short(request.ingredientBatchId)}
                              </small>
                            </span>
                          </td>
                          <DeadlineCell
                            dueAt={request.dueAt}
                            closed={ingredientRequestGroup(request, 'received') === 'closed'}
                          />
                          <td>
                            <Badge label={status.label} variant={status.variant} />
                          </td>
                          <td className="evidence-table__action">
                            <Btn
                              size="xs"
                              variant={respond ? 'primary' : 'outline'}
                              aria-label={`${respond ? 'Respond to' : 'View'} request from ${company}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                onRespond(request);
                              }}
                            >
                              {respond ? 'Respond' : 'View'}
                            </Btn>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </PaginatedTable>
          </div>
        )}
      </div>
    );
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SectionTitle
        title={hideDirection ? 'Ingredient evidence requests' : 'Information requests'}
        sub={
          hideDirection
            ? 'Review ingredient information requested from your company.'
            : 'Keep evidence requested from you separate from company evidence you ask others to provide.'
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
      {!hideDirection && (
        <nav
          aria-label="Evidence request direction"
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
        >
          <Btn
            icon={<Inbox size={16} />}
            variant={direction === 'received' ? 'primary' : 'outline'}
            onClick={() => setDirection('received')}
          >
            Received requests
          </Btn>
          <Btn
            icon={<Send size={16} />}
            variant={direction === 'sent' ? 'primary' : 'outline'}
            onClick={() => setDirection('sent')}
          >
            Sent requests
          </Btn>
        </nav>
      )}
      <p>
        {direction === 'received'
          ? 'Other companies are asking you for ingredient evidence. Review the necessary claims before choosing optional disclosures.'
          : 'Company identity evidence you requested from Manufacturers or Retailers. Open a request to check the response and verify its proof.'}
      </p>
      <Input
        label="Search evidence requests"
        type="search"
        icon={<Search size={18} />}
        placeholder={
          direction === 'received'
            ? 'Search by requesting company or request ID…'
            : 'Search by company, purpose or request ID…'
        }
        hint={
          hideDirection
            ? 'Search the requests received by your company.'
            : 'Results update as you type within the selected Received or Sent tab.'
        }
        value={search}
        onChange={setSearch}
      />
      {loading && <LoadingIndicator page layout="table" label="Loading evidence requests..." />}
      {direction === 'received' && error && <Alert type="error" message={error} />}
      {direction === 'sent' && sentError && <Alert type="error" message={sentError} />}
      {!loading && direction === 'received' && (
        <Card padding="0">
          {!receivedShown.length ? (
            <EmptyState
              icon={<Inbox size={36} />}
              title="No received evidence requests"
              sub="Requests for your ingredient evidence will appear here."
            />
          ) : (
            <Table headers={['From company', 'Type', 'Deadline', 'Status', '']}>
              {receivedShown.map((request) => (
                <TR key={request.requestId} onClick={() => onRespond(request)}>
                  <TD bold>
                    {request.requesterName ??
                      request.manufacturerName ??
                      short(request.requester ?? '')}
                  </TD>
                  <TD>Ingredient evidence</TD>
                  <TD muted>{chainDate(request.dueAt)}</TD>
                  <TD>
                    <Badge
                      label={statuses[request.status] ?? 'Unknown'}
                      variant={request.status === 3 ? 'active' : 'pending'}
                    />
                  </TD>
                  <TD>
                    <Btn
                      size="sm"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRespond(request);
                      }}
                    >
                      View / respond
                    </Btn>
                  </TD>
                </TR>
              ))}
            </Table>
          )}
        </Card>
      )}
      {!loading && direction === 'sent' && (
        <Card padding="0">
          {!sentShown.length ? (
            <EmptyState
              icon={<Send size={36} />}
              title="No sent company evidence requests"
              sub="Open a Manufacturer order and choose Request company evidence to start."
            />
          ) : (
            <Table headers={['To company', 'Linked to', 'Purpose', 'Deadline', 'Status', '']}>
              {sentShown.map((request) => (
                <TR key={request.kind + request.id}>
                  <TD bold>{request.recipient}</TD>
                  <TD>
                    {request.kind === 'order' ? 'Quantity request' : 'Ingredient evidence request'}
                  </TD>
                  <TD>{request.purpose}</TD>
                  <TD muted>{request.expiresAt ? chainDate(request.expiresAt) : 'Unavailable'}</TD>
                  <TD>
                    <Badge
                      label={request.status}
                      variant={request.status === 'VERIFIED' ? 'active' : 'pending'}
                    />
                  </TD>
                  <TD>
                    <Btn
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        request.kind === 'order'
                          ? setSelectedOrder(request.id)
                          : request.request && onRespond(request.request)
                      }
                    >
                      View evidence request
                    </Btn>
                  </TD>
                </TR>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
