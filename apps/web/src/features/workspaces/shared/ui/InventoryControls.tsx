import { ActionCountBadge, actionCountLabel } from './ActionCountBadge';
import type { ActionCount } from '../../action-counts';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { ChevronRight, LayoutGrid, List as ListIcon } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';

export type InventoryView = 'list' | 'grid';

export function InventorySummaryCard({
  label,
  value,
  note,
  icon,
  selected = false,
  onClick,
  variant = 'default',
  loading = false,
}: {
  label: string;
  value: string | number;
  note?: string;
  icon: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  variant?: 'default' | 'navigation';
  loading?: boolean;
}) {
  const content = (
    <>
      <div>
        <span>{label}</span>
        <strong>
          {loading ? (
            <LoadingIndicator embedded layout="value" label={`Loading ${label}`} />
          ) : (
            value
          )}
        </strong>
        {note && <small>{note}</small>}
      </div>
      <span aria-hidden="true">{icon}</span>
      {variant === 'navigation' && (
        <ChevronRight className="ingredient-summary-card__arrow" size={17} aria-hidden="true" />
      )}
    </>
  );
  return onClick ? (
    <button
      type="button"
      className={`ingredient-summary-card ingredient-summary-card--${variant}${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <article className="ingredient-summary-card">{content}</article>
  );
}

export interface StatusTab<T extends string> {
  count?: number;
  actionCount?: ActionCount;
  icon?: ReactNode;
  label: string;
  value: T;
}

/**
 * `tabs`: underline tabs for moving between related pages or sections (ARIA tabs, arrow keys).
 * `chips` (default): filter chips that narrow the current list (toggle buttons, not navigation).
 */
export function StatusTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  variant = 'chips',
}: {
  label: string;
  tabs: Array<StatusTab<T>>;
  value: T;
  onChange: (value: T) => void;
  variant?: 'chips' | 'tabs';
}) {
  const navigation = variant === 'tabs';
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!navigation || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    // Manual activation (WAI-ARIA tabs): arrows move focus; Enter/Space opens, since a tab may load a page.
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  };
  return (
    <div
      className={`workspace-status-tabs workspace-status-tabs--${variant}`}
      role={navigation ? 'tablist' : 'group'}
      aria-label={label}
      onKeyDown={moveFocus}
    >
      {tabs.map((tab) => {
        const selected = value === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            {...(navigation
              ? { role: 'tab', 'aria-selected': selected, tabIndex: selected ? 0 : -1 }
              : { 'aria-pressed': selected })}
            aria-label={
              tab.actionCount === null ||
              tab.actionCount === 'loading' ||
              (typeof tab.actionCount === 'number' && tab.actionCount > 0)
                ? actionCountLabel(tab.actionCount, tab.label)
                : undefined
            }
            onClick={() => onChange(tab.value)}
          >
            {tab.icon && <span aria-hidden="true">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.count !== undefined && <strong>{tab.count}</strong>}
            <ActionCountBadge count={tab.actionCount} label={tab.label} reserveSpace={navigation} />
          </button>
        );
      })}
    </div>
  );
}

export function InventoryViewToggle({
  value,
  onChange,
  label = 'Inventory view',
}: {
  value: InventoryView;
  onChange: (view: InventoryView) => void;
  label?: string;
}) {
  return (
    <div className="ingredient-view-selector" role="group" aria-label={label}>
      <span>View</span>
      <button
        type="button"
        aria-label="List view"
        aria-pressed={value === 'list'}
        onClick={() => onChange('list')}
      >
        <ListIcon size={15} aria-hidden="true" />
        <span>List</span>
      </button>
      <button
        type="button"
        aria-label="Grid view"
        aria-pressed={value === 'grid'}
        onClick={() => onChange('grid')}
      >
        <LayoutGrid size={15} aria-hidden="true" />
        <span>Grid</span>
      </button>
    </div>
  );
}

export function InventoryFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Card click opens details, except when the click lands on a control inside the card. */
export function openCardOnClick(open: () => void) {
  return (event: { target: EventTarget }) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, label, summary')) return;
    if (window.getSelection()?.toString()) return; // selecting text is not a click
    open();
  };
}
