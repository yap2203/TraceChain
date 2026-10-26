import type { ReactNode } from 'react';

import { EmptyState } from './EmptyState';

export interface TableColumn<T> {
  header: string;
  key: string;
  render: (row: T) => ReactNode;
}

interface TableProps<T> {
  caption: string;
  columns: readonly TableColumn<T>[];
  emptyDescription?: string;
  emptyTitle?: string;
  getRowKey: (row: T) => string;
  rows: readonly T[];
}

export function Table<T>({
  caption,
  columns,
  emptyDescription = 'Records will appear here when they are available.',
  emptyTitle = 'No records yet',
  getRowKey,
  rows,
}: TableProps<T>) {
  if (rows.length === 0) {
    return <EmptyState description={emptyDescription} title={emptyTitle} />;
  }

  return (
    <div className="table-scroll">
      <table className="ui-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
