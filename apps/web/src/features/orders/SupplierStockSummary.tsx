import type { SupplierStock } from './orders.api';
import { WorkflowHelp } from '../workspaces/shared/ui';
import './supplier-stock.css';

/** Whole-number on-chain amounts with thousands separators; anything else is shown as recorded. */
const amount = (value: string, unit: string) => {
  try {
    return `${BigInt(value).toLocaleString()} ${unit}`;
  } catch {
    return `${value} ${unit}`;
  }
};

export function SupplierStockSummary({ stock }: { stock: SupplierStock }) {
  return (
    <section aria-label="Supplier stock summary" className="supplier-stock">
      <dl>
        <div>
          <dt>Current stock</dt>
          <dd>{amount(stock.availableQuantity, stock.unit)}</dd>
        </div>
        <div>
          <dt>Estimated remaining</dt>
          <dd>
            {stock.remainingAfterRequests === null
              ? 'Unavailable: incomplete request data'
              : amount(stock.remainingAfterRequests, stock.unit)}
          </dd>
        </div>
        <div>
          <dt>Pending requests</dt>
          <dd>{amount(stock.pendingQuantity, stock.unit)}</dd>
        </div>
        <div>
          <dt>Approved, not dispatched</dt>
          <dd>{amount(stock.approvedQuantity, stock.unit)}</dd>
        </div>
      </dl>
      {stock.shortfall !== null && BigInt(stock.shortfall) > 0n && (
        <p role="status" className="supplier-stock__warning">
          Open requests exceed current stock by {amount(stock.shortfall, stock.unit)}. Review
          requests before approving.
        </p>
      )}
      <WorkflowHelp title="How stock is estimated">
        <p>
          Estimated remaining is current stock minus pending and approved, undispatched requests.
          Requests do not reserve stock; the estimate is not guaranteed.
        </p>
        <p>
          Collected deliveries are already deducted from current stock. Older direct receipts deduct
          stock when receipt is confirmed.
        </p>
      </WorkflowHelp>
    </section>
  );
}
