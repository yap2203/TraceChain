import { ChevronDown, ChevronRight, ChevronUp, LayoutGrid, List as ListIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type InventoryView = 'list' | 'grid';

export function InventorySummaryCard({
  label,
  value,
  note,
  icon,
  selected = false,
  onClick,
  variant = 'default',
}: {
  label: string;
  value: string | number;
  note?: string;
  icon: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  variant?: 'default' | 'navigation';
}) {
  const content = (
    <>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
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
  count: number;
  label: string;
  value: T;
}

export function StatusTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  variant = 'default',
}: {
  label: string;
  tabs: Array<StatusTab<T>>;
  value: T;
  onChange: (value: T) => void;
  variant?: 'default' | 'connected';
}) {
  return (
    <div
      className={`workspace-status-tabs workspace-status-tabs--${variant}`}
      role="tablist"
      aria-label={label}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
        >
          <span>{tab.label}</span>
          <strong>{tab.count}</strong>
        </button>
      ))}
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

export function InventoryExpandButton({
  expanded,
  controls,
  onClick,
}: {
  expanded: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ingredient-card__toggle"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
    >
      <span>{expanded ? 'Show less' : 'Show more'}</span>
      {expanded ? (
        <ChevronUp size={16} aria-hidden="true" />
      ) : (
        <ChevronDown size={16} aria-hidden="true" />
      )}
    </button>
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
