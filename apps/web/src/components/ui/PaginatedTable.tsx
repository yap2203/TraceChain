import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './pagination.css';

type ElementWithChildren = ReactElement<{ children?: ReactNode }>;

function flattenRows(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flattenRows(child.props.children)
      : [child],
  );
}

/** Page state for any list. `keys` identify the current rows, in order. */
export function usePagination(keys: readonly unknown[]) {
  const signature = JSON.stringify(keys);
  const [pageSize, setPageSize] = useState(10);
  const [selection, setSelection] = useState({ signature, page: 1 });
  // Filtering or sorting starts at the first page, even when the record count is unchanged.
  if (selection.signature !== signature) setSelection({ signature, page: 1 });
  const total = keys.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = selection.signature === signature ? Math.min(selection.page, totalPages) : 1;
  const start = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    start,
    end: start + pageSize,
    total,
    totalPages,
    setPage: (next: number) => setSelection({ signature, page: next }),
    setPageSize: (size: number) => {
      setPageSize(size);
      setSelection({ signature, page: 1 });
    },
  };
}

/** The shared "Records per page · 1–10 of 42 · Page 1 of 5" footer. */
export function PaginationBar({
  pagination,
  label = 'Table pages',
}: {
  pagination: ReturnType<typeof usePagination>;
  label?: string;
}) {
  const id = useId();
  const { page, pageSize, start, total, totalPages, setPage, setPageSize } = pagination;
  return (
    <div className="table-pagination" aria-label="Table pagination">
      <label htmlFor={id}>
        Records per page
        <select
          id={id}
          value={pageSize}
          onChange={(event) => setPageSize(Number(event.target.value))}
        >
          {[5, 10, 25, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <span role="status" aria-live="polite">
        {total === 0 ? 0 : start + 1}–{Math.min(start + pageSize, total)} of {total}
      </span>
      <nav aria-label={label}>
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
}

/** Paginates the direct tbody rows while preserving each table's cells and handlers. */
export function PaginatedTable({
  children,
  paginate = true,
}: {
  children: ElementWithChildren;
  paginate?: boolean;
}) {
  const sections = Children.toArray(children.props.children);
  const body = sections.find(
    (section): section is ElementWithChildren =>
      isValidElement(section) && section.type === 'tbody',
  );
  const rows = flattenRows(body?.props.children);
  const pagination = usePagination(rows.map((row) => (isValidElement(row) ? row.key : null)));
  const table = cloneElement(
    children,
    undefined,
    sections.map((section) =>
      section === body
        ? cloneElement(
            body,
            undefined,
            paginate ? rows.slice(pagination.start, pagination.end) : rows,
          )
        : section,
    ),
  );

  return (
    <div className="paginated-table">
      <div
        className="paginated-table__scroll"
        tabIndex={0}
        role="region"
        aria-label="Scrollable table"
      >
        {table}
      </div>
      {paginate && <PaginationBar pagination={pagination} />}
    </div>
  );
}
