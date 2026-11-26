import type { SupplierStock } from './orders.api';
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
          <dt>Current on-chain stock</dt>
          <dd>{amount(stock.availableQuantity, stock.unit)}</dd>
        </div>
        <div>
          <dt>Remaining after open requests</dt>
          <dd>
            {stock.remainingAfterRequests === null
              ? 'Unavailable: older requests lack batch or decision data'
              : amount(stock.remainingAfterRequests, stock.unit)}
          </dd>
        </div>
        <div>
          <dt>Awaiting your approval</dt>
          <dd>{amount(stock.pendingQuantity, stock.unit)}</dd>
        </div>
        <div>
          <dt>Approved requests still in stock</dt>
          <dd>{amount(stock.approvedQuantity, stock.unit)}</dd>
        </div>
      </dl>
      {stock.shortfall !== null && BigInt(stock.shortfall) > 0n && (
        <p role="status" className="supplier-stock__warning">
          Open requests exceed current stock by {amount(stock.shortfall, stock.unit)}. Review
          requests before approving.
        </p>
      )}
      <p className="supplier-stock__note">
        Requests do not reserve stock. Collected deliveries are already deducted from current stock;
        legacy direct receipts deduct stock at receipt.
      </p>
    </section>
  );
}
