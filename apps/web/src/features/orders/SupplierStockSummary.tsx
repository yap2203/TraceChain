import type { SupplierStock } from './orders.api';

export function SupplierStockSummary({ stock }: { stock: SupplierStock }) {
  return (
    <section
      aria-label="Supplier stock summary"
      className="my-[12px] min-w-0 rounded-lg border border-[var(--c-border)] p-[12px] text-sm"
    >
      <dl className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
        <div>
          <dt>Current on-chain stock</dt>
          <dd className="m-0 break-words font-semibold">
            {stock.availableQuantity} {stock.unit}
          </dd>
        </div>
        <div>
          <dt>Remaining after open requests</dt>
          <dd className="m-0 break-words font-semibold">
            {stock.remainingAfterRequests === null
              ? 'Unavailable: older requests lack batch or decision data'
              : `${stock.remainingAfterRequests} ${stock.unit}`}
          </dd>
        </div>
        <div>
          <dt>Awaiting your approval</dt>
          <dd className="m-0 break-words">
            {stock.pendingQuantity} {stock.unit}
          </dd>
        </div>
        <div>
          <dt>Approved, awaiting receipt</dt>
          <dd className="m-0 break-words">
            {stock.approvedQuantity} {stock.unit}
          </dd>
        </div>
      </dl>
      {stock.shortfall !== null && BigInt(stock.shortfall) > 0n && (
        <p role="status">
          Open requests exceed current stock by {stock.shortfall} {stock.unit}. Review requests
          before approving.
        </p>
      )}
      <p className="mb-0">
        Request estimates include unexpired pending and approved quantities not yet received. Actual
        stock decreases on confirmed receipt; requests do not reserve stock.
      </p>
    </section>
  );
}
