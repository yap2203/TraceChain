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

/** Paginates the direct tbody rows while preserving each table's cells and handlers. */
export function PaginatedTable({ children }: { children: ElementWithChildren }) {
  const id = useId();
  const sections = Children.toArray(children.props.children);
  const body = sections.find(
    (section): section is ElementWithChildren =>
      isValidElement(section) && section.type === 'tbody',
  );
  const rows = flattenRows(body?.props.children);
  const signature = JSON.stringify(rows.map((row) => (isValidElement(row) ? row.key : null)));
  const [pageSize, setPageSize] = useState(10);
  const [selection, setSelection] = useState({ signature, page: 1 });
  // Filtering or sorting starts at the first page, even when the record count is unchanged.
  if (selection.signature !== signature) setSelection({ signature, page: 1 });
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = selection.signature === signature ? Math.min(selection.page, totalPages) : 1;
  const start = (page - 1) * pageSize;
  const table = cloneElement(
    children,
    undefined,
    sections.map((section) =>
      section === body
        ? cloneElement(body, undefined, rows.slice(start, start + pageSize))
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
      <div className="table-pagination" aria-label="Table pagination">
        <label htmlFor={id}>
          Records per page
          <select
            id={id}
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setSelection({ signature, page: 1 });
            }}
          >
            {[5, 10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span role="status" aria-live="polite">
          {rows.length === 0 ? 0 : start + 1}–{Math.min(start + pageSize, rows.length)} of{' '}
          {rows.length}
        </span>
        <nav aria-label="Table pages">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setSelection({ signature, page: page - 1 })}
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
            onClick={() => setSelection({ signature, page: page + 1 })}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </nav>
      </div>
    </div>
  );
}
