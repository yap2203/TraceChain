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
}: {
  onRespond: (request: ProductionEvidenceRequest) => void;
  initialOrderId?: string;
  initialDirection?: 'received' | 'sent';
  onClearSelection?: () => void;
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
    [search, setSearch] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSentError('');
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
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (initialOrderId) {
      setSelectedOrder(initialOrderId);
      setDirection('sent');
    }
  }, [initialOrderId]);
  if (selectedOrder)
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Btn
          variant="outline"
          onClick={() => {
            setSelectedOrder(undefined);
            onClearSelection?.();
            void load();
          }}
        >
          Back to Information requests
        </Btn>
        <OrdersPage
          key={selectedOrder}
          role="supplier"
          initialOrderId={selectedOrder}
          evidenceOnly
        />
      </div>
    );
  const receivedShown = requests.filter((request) =>
    ((request.requesterName ?? request.manufacturerName ?? '') + request.requestId)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const sentShown = sent.filter((request) =>
    (request.recipient + request.purpose + request.id).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SectionTitle
        title="Information requests"
        sub="Keep evidence requested from you separate from company evidence you ask others to provide."
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
        hint="Results update as you type within the selected Received or Sent tab."
        value={search}
        onChange={setSearch}
      />
      {loading && <p role="status">Loading evidence requests...</p>}
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
