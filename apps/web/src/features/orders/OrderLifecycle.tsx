import { Link } from 'react-router-dom';
import type { OrderRecord } from './orders.api';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';
import { workspacePath } from '../workspaces/workspace-paths';
import { Badge } from '../workspaces/shared/ui';
const same = (left?: string, right?: string) =>
  !!left && !!right && left.toLowerCase() === right.toLowerCase();
export function OrderLifecycle({
  order,
  actor,
  role,
}: {
  order: OrderRecord;
  actor: string;
  role: WorkspaceRole;
}) {
  const decision = Number(order.decision?.status ?? 0),
    delivery = order.productDelivery ?? order.delivery;
  const received =
    Number(delivery?.stage) === 5 ||
    (Number(order.approvedReceivedQuantity) > 0 &&
      BigInt(order.approvedReceivedQuantity) >= BigInt(order.requested)) ||
    (Number(order.custodyOrder?.received) > 0 &&
      BigInt(order.custodyOrder.received) >= BigInt(order.requested));
  const cancelled =
    !received && (decision === 2 || Number(order.status) === 3 || Number(delivery?.stage) === 6);
  const expired =
    !received &&
    !cancelled &&
    Number(order.expiresAt) <= Date.now() / 1000 &&
    Number(delivery?.stage) !== 4;
  const step = received ? 3 : decision === 1 ? 2 : 1;
  let next = 'Waiting for the seller to review this request.';
  if (same(order.seller, actor) && decision === 0)
    next = 'Review this request. Approve, reject, or request company evidence.';
  if (decision === 1)
    next = order.custodyOrder?.arranged
      ? 'The Distributor will arrange dispatch from warehouse stock.'
      : Number(delivery?.stage) === 2
        ? 'Waiting for the Distributor to accept the delivery.'
        : Number(delivery?.stage) === 3
          ? 'The Distributor will arrange pickup and record physical collection.'
          : Number(delivery?.stage) === 4
            ? 'Delivery is in transit. The receiver scans the shipment QR on arrival.'
            : same(order.seller, actor)
              ? 'Choose or complete the delivery arrangement below.'
              : 'The seller is preparing the delivery arrangement.';
  if (received)
    next =
      role === 'manufacturer'
        ? 'Receipt is confirmed. These ingredients can be used in product creation.'
        : 'Receipt is confirmed. Open traceability to inspect the recorded journey.';
  if (cancelled || expired)
    next = cancelled
      ? 'This request is rejected or cancelled. Review its recorded decision below.'
      : 'The request deadline has passed. Check the recorded delivery state before taking further action.';
  return (
    <section className="order-lifecycle" aria-label="Order progress">
      <ol>
        {['Requested', 'Seller review', 'Delivery', 'Received'].map((label, index) => (
          <li
            key={label}
            aria-current={!cancelled && !expired && index === step ? 'step' : undefined}
            className={index < step && !cancelled ? 'is-complete' : ''}
          >
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="order-next-action">
        <Badge
          label={
            cancelled
              ? 'Closed'
              : expired
                ? 'Deadline passed'
                : received
                  ? 'Received'
                  : step === 2
                    ? 'Delivery stage'
                    : 'Awaiting decision'
          }
          variant={received ? 'verified' : cancelled ? 'rejected' : 'pending'}
        />
        <p>{next}</p>
        {same(order.buyer, actor) && Number(delivery?.stage) === 4 && (
          <Link
            to={
              workspacePath(role, 'shipments') +
              '?' +
              new URLSearchParams({
                orderId: order.orderId,
                ...(delivery.transferId ? { shipmentId: delivery.transferId } : {}),
              })
            }
          >
            Open shipment & scan receipt
          </Link>
        )}
        {received && role === 'manufacturer' && (
          <Link to={workspacePath(role, 'products') + '?view=products-new'}>
            Create a product from received ingredients
          </Link>
        )}
      </div>
    </section>
  );
}
