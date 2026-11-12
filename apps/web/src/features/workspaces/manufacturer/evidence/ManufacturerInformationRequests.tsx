import { useCallback, useEffect, useState } from 'react';
import { Inbox, RefreshCw, Search, Send } from 'lucide-react';
import { OrdersPage } from '../../../orders/OrdersPage';
import { getOrders, orderIdentity } from '../../../orders/orders.api';
import { CompanyIdentityProofAction } from '../../../production-flow/CompanyIdentityProofAction';
import {
  getCompanyIdentityProofStatus,
  listEvidenceRequests,
} from '../../../production-flow/production-flow.api';
import { Alert, Badge, Btn, Card, Input, SectionTitle, Table, TD, TR } from '../../shared/ui';
import { chainDate, shortChainId } from '../../shared/operational-format';
import { IngredientEvidence } from './IngredientEvidencePage';

type RequestRow = {
  id: string;
  kind: 'ingredient' | 'order';
  direction: 'received' | 'sent';
  company: string;
  reference: string;
  purpose: string;
  status: string;
  expiresAt?: number;
};
const evidenceStatuses = [
  'Unknown',
  'Awaiting Supplier',
  'Evidence received',
  'Accepted',
  'Declined',
  'Rejected',
  'Cancelled',
];

export function ManufacturerInformationRequests({
  initialOrderId,
  initialDirection = 'sent',
  onClearSelection,
}: {
  initialOrderId?: string;
  initialDirection?: 'received' | 'sent';
  onClearSelection?: (direction: 'received' | 'sent') => void;
}) {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [direction, setDirection] = useState(initialDirection);
  const [selected, setSelected] = useState<
    Pick<RequestRow, 'id' | 'kind' | 'direction'> | undefined
  >(
    initialOrderId ? { id: initialOrderId, kind: 'order', direction: initialDirection } : undefined,
  );
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const results = await Promise.allSettled([listEvidenceRequests(), getOrders()]);
    const next: RequestRow[] = [];
    const errors: string[] = [];
    const statusReads: Promise<void>[] = [];
    if (results[0].status === 'fulfilled') {
      for (const request of results[0].value.requests) {
        const common = {
          id: request.requestId,
          kind: 'ingredient' as const,
          company: request.supplierName ?? shortChainId(request.supplier),
          reference: request.ingredientBatchId,
        };
        next.push({
          ...common,
          direction: 'sent',
          purpose: 'Ingredient evidence',
          status: evidenceStatuses[request.status] ?? 'Unknown',
          expiresAt: request.dueAt,
        });
        statusReads.push(
          getCompanyIdentityProofStatus(request.requestId).then((status) => {
            if (status.status !== 'NOT_REQUESTED')
              next.push({
                ...common,
                direction: 'received',
                purpose: status.purpose ?? 'Company identity proof',
                status: status.status,
                expiresAt: status.expiresAt,
              });
          }),
        );
      }
    } else errors.push('Ingredient evidence requests could not be loaded.');
    if (results[1].status === 'fulfilled') {
      const data = results[1].value;
      for (const order of data.orders) {
        if (!order.identityChallenge || /^0x0+$/.test(order.identityChallenge)) continue;
        const isBuyer = order.buyer.toLowerCase() === data.actor.toLowerCase();
        const isSeller = order.seller.toLowerCase() === data.actor.toLowerCase();
        if (!isBuyer && !isSeller) continue;
        statusReads.push(
          orderIdentity(order.orderId, { action: 'status' }).then((status) => {
            next.push({
              id: order.orderId,
              kind: 'order',
              direction: isBuyer ? 'received' : 'sent',
              company: isBuyer
                ? (order.sellerName ?? shortChainId(order.seller))
                : (order.buyerName ?? shortChainId(order.buyer)),
              reference: order.orderId,
              purpose: status.purpose ?? 'Order-linked company identity proof',
              status: status.status,
              expiresAt: status.expiresAt,
            });
          }),
        );
      }
    } else errors.push('Order-linked company evidence requests could not be loaded.');
    const statuses = await Promise.allSettled(statusReads);
    if (statuses.some((result) => result.status === 'rejected'))
      errors.push('Some company proof statuses are unavailable. Refresh before making a decision.');
    setRows(next.sort((a, b) => a.id.localeCompare(b.id)));
    setError(errors.join(' '));
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setDirection(initialDirection);
    setSelected(
      initialOrderId
        ? { id: initialOrderId, kind: 'order', direction: initialDirection }
        : undefined,
    );
  }, [initialOrderId, initialDirection]);
  const selectedRow = rows.find(
    (row) => row.id === selected?.id && row.direction === selected?.direction,
  );
  if (selected)
    return (
      <div className="grid gap-[16px] min-w-0">
        <Btn
          variant="outline"
          onClick={() => {
            setSelected(undefined);
            onClearSelection?.(selected.direction);
            void load();
          }}
        >
          Back to Information requests
        </Btn>
        {error && <Alert type="warning" message={error} />}
        {selected.kind === 'order' ? (
          <OrdersPage
            key={selected.id}
            role="manufacturer"
            initialOrderId={selected.id}
            evidenceOnly
            mode="manage"
          />
        ) : selected.direction === 'sent' ? (
          <IngredientEvidence onNav={() => undefined} hideComposer requestId={selected.id} />
        ) : (
          <Card>
            <h2>Company evidence requested by Supplier</h2>
            <p>{selectedRow?.company ?? 'Supplier details unavailable'}</p>
            <p>Linked ingredient: {selectedRow?.reference ?? 'Unavailable'}</p>
            <p>Purpose: {selectedRow?.purpose ?? 'Unavailable'}</p>
            <p>
              Preview your Company Role presentation before approving or declining. This does not
              approve the ingredient request or share ingredient claims.
            </p>
            <CompanyIdentityProofAction
              key={selected.id}
              requestId={selected.id}
              role="manufacturer"
            />
          </Card>
        )}
      </div>
    );
  const shown = rows.filter(
    (row) =>
      row.direction === direction &&
      [row.company, row.reference, row.purpose, row.id]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="grid gap-[16px] min-w-0">
      <SectionTitle
        title="Information requests"
        sub="Review ingredient evidence and manage company identity proof separately from orders."
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
      <nav aria-label="Information request direction" className="flex flex-wrap gap-[8px]">
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
          ? 'Suppliers can ask for your company evidence before responding to an ingredient quantity or information request. Open a request to preview and explicitly approve or decline your proof.'
          : 'Ingredient information you requested from Suppliers, and company evidence you requested from buyers. Viewing, verifying and accepting evidence are separate actions.'}
      </p>
      <Input
        label="Search information requests"
        type="search"
        icon={<Search size={18} />}
        placeholder="Search company, purpose, ingredient or request ID…"
        value={search}
        onChange={setSearch}
      />
      {error && <Alert type="warning" message={error} />}
      {loading ? (
        <p role="status">Loading information requests…</p>
      ) : (
        <Card padding="0">
          <Table headers={['Company', 'Request type', 'Reference', 'Deadline', 'Status', '']}>
            {shown.map((row) => (
              <TR key={`${row.kind}:${row.id}`} onClick={() => setSelected(row)}>
                <TD bold>{row.company}</TD>
                <TD>{row.purpose}</TD>
                <TD mono>{shortChainId(row.reference)}</TD>
                <TD>{row.expiresAt ? chainDate(row.expiresAt) : 'Unavailable'}</TD>
                <TD>
                  <Badge
                    label={row.status}
                    variant={
                      ['VERIFIED', 'Accepted'].includes(row.status)
                        ? 'verified'
                        : ['DECLINED', 'Rejected'].includes(row.status)
                          ? 'rejected'
                          : 'pending'
                    }
                  />
                </TD>
                <TD>
                  <Btn
                    size="sm"
                    variant="outline"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelected(row);
                    }}
                  >
                    View request
                  </Btn>
                </TD>
              </TR>
            ))}
          </Table>
          {!shown.length && (
            <p className="p-[16px]">No {direction} information requests match your search.</p>
          )}
        </Card>
      )}
    </div>
  );
}
