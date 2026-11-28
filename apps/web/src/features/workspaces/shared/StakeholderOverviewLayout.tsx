import type { ReactNode } from 'react';
import { LoadingIndicator } from '../../../components/ui/LoadingIndicator';
import { CheckCircle2, RefreshCw } from 'lucide-react';

import { PaginatedTable } from '../../../components/ui/PaginatedTable';
import { CompanyAvatar } from '../../orders/CatalogueMedia';
import { Alert, Badge, Btn, InventorySummaryCard, SectionTitle } from './ui';
import { WorkspaceGuide } from '../WorkspaceGuide';
import type { BadgeVariant } from './ui/Badge';
import './stakeholder-overview.css';

export interface OverviewMetric {
  icon: ReactNode;
  label: string;
  note?: string;
  value: string | number;
  /** Opens the page that lists these records. */
  onClick?: () => void;
}

/** One thing waiting on this company, from any workflow. */
export interface OverviewTask {
  key: string;
  task: string;
  item: string;
  detail?: string;
  counterparty?: string;
  /** Unix seconds. */
  due?: number;
  badge: { label: string; variant: BadgeVariant };
  actionLabel: string;
  onAction: () => void;
}

export interface OverviewSnapshot {
  title: string;
  columns: string[];
  rows: Array<{ key: string; cells: ReactNode[] }>;
  empty: string;
  viewAllLabel: string;
  onViewAll: () => void;
}

export function StakeholderOverviewLayout({
  title,
  description,
  metrics,
  tasks,
  tasksLoading = false,
  snapshot,
  errors = [],
  onRefresh,
  refreshing = false,
}: {
  title: string;
  description: string;
  metrics: OverviewMetric[];
  tasks: OverviewTask[];
  tasksLoading?: boolean;
  snapshot: OverviewSnapshot;
  errors?: Array<string | undefined>;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const ordered = [...tasks].sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
  const unavailable = errors.some(Boolean);
  return (
    <div className="stakeholder-overview">
      <SectionTitle
        title={title}
        sub={description}
        action={
          onRefresh && (
            <Btn
              variant="outline"
              icon={<RefreshCw size={16} />}
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : unavailable ? 'Retry' : 'Refresh'}
            </Btn>
          )
        }
      />
      <WorkspaceGuide />
      {[...new Set(errors.filter(Boolean))].map((error) => (
        <Alert key={error} type="error" message={error!} />
      ))}
      <div className="stakeholder-overview__metrics" aria-label="Workspace summary">
        {metrics.slice(0, 4).map((metric) => (
          <InventorySummaryCard
            key={metric.label}
            {...metric}
            value={unavailable ? 'Unavailable' : tasksLoading ? '…' : metric.value}
            variant={metric.onClick ? 'navigation' : 'default'}
          />
        ))}
      </div>

      <section className="overview-panel" aria-label="Needs your action">
        <header>
          <h3>Needs your action</h3>
          {!tasksLoading && !unavailable && (
            <span className="overview-panel__count">{ordered.length}</span>
          )}
        </header>
        {unavailable ? (
          <p className="overview-panel__empty">
            Activity could not be checked. Retry loading the dashboard.
          </p>
        ) : tasksLoading && !ordered.length ? (
          <LoadingIndicator
            page
            layout="table"
            label="Checking orders, offers and evidence requests…"
          />
        ) : !ordered.length ? (
          <p className="overview-panel__empty is-done">
            <CheckCircle2 size={18} aria-hidden="true" /> You&apos;re all caught up. New requests
            and orders that need you will appear here.
          </p>
        ) : (
          <PaginatedTable>
            <table className="overview-table">
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Item</th>
                  <th scope="col">With</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((task) => (
                  <tr key={task.key}>
                    <td>
                      <strong>{task.task}</strong>
                    </td>
                    <td>
                      <span className="overview-table__stack">
                        <span>{task.item}</span>
                        {task.detail && <small>{task.detail}</small>}
                      </span>
                    </td>
                    <td>
                      {task.counterparty ? (
                        <span className="overview-table__company">
                          <CompanyAvatar name={task.counterparty} size="sm" />
                          {task.counterparty}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={dueClass(task.due)}>{formatDue(task.due)}</td>
                    <td>
                      <Badge {...task.badge} />
                    </td>
                    <td className="overview-table__action">
                      <Btn size="xs" onClick={task.onAction}>
                        {task.actionLabel}
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PaginatedTable>
        )}
      </section>

      <section className="overview-panel" aria-label={snapshot.title}>
        <header>
          <h3>{snapshot.title}</h3>
          <Btn size="xs" variant="outline" onClick={snapshot.onViewAll}>
            {snapshot.viewAllLabel}
          </Btn>
        </header>
        {unavailable ? (
          <p className="overview-panel__empty">
            Records are temporarily unavailable. Retry loading the dashboard.
          </p>
        ) : tasksLoading && !snapshot.rows.length ? (
          <LoadingIndicator page layout="table" label="Loading records…" />
        ) : !snapshot.rows.length ? (
          <p className="overview-panel__empty">{snapshot.empty}</p>
        ) : (
          <div className="overview-table__scroll">
            <table className="overview-table">
              <thead>
                <tr>
                  {snapshot.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot.rows.slice(0, 5).map((row) => (
                  <tr key={row.key}>
                    {row.cells.map((cell, index) => (
                      <td key={index}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function formatDue(due?: number) {
  if (!due) return '—';
  const ms = due * 1000 - Date.now();
  if (ms <= 0) return 'Overdue';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `In ${Math.max(1, hours)} h`;
  return new Date(due * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function dueClass(due?: number) {
  if (!due) return undefined;
  const ms = due * 1000 - Date.now();
  return ms <= 0 ? 'is-overdue' : ms < 24 * 3_600_000 ? 'is-soon' : undefined;
}
