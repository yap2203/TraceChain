import { useId, useMemo, useState, type ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import { PaginationBar, usePagination } from '../../../../components/ui/PaginatedTable';
import { RequiredLabel } from '../../../../components/ui/RequiredLabel';
import { Btn } from './Button';
import { Modal } from './Modal';
import './entity-picker.css';

export interface EntityOption {
  id: string;
  title: string;
  /** Distinguishes look-alikes: reference, company, etc. */
  subtitle?: string;
  facts?: { label: string; value: string }[];
  /** Extra text matched by search (identifiers, addresses). */
  keywords?: string;
  /** Filter value for the optional filter select. */
  group?: string;
  /** Optional thumbnail (e.g. a catalogue image) shown before the text. */
  media?: ReactNode;
  /** Set when the option cannot be chosen; shown to the user. */
  disabledReason?: string;
}

/**
 * Search-and-pick dialog for complex records (stock, warehouses, companies…).
 * Small, simple lists should keep using SelectField.
 */
export function EntityPicker({
  label,
  required,
  value,
  onChange,
  options,
  dialogTitle,
  chooseLabel,
  confirmLabel = 'Select',
  searchPlaceholder = 'Search',
  filterLabel,
  sorts = [],
  emptyText,
  disabled,
  error,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (id: string) => void;
  options: EntityOption[];
  dialogTitle: string;
  chooseLabel: string;
  confirmLabel?: string;
  searchPlaceholder?: string;
  /** Shows a filter select over `group` values when given. */
  filterLabel?: string;
  sorts?: { value: string; label: string; compare: (a: EntityOption, b: EntityOption) => number }[];
  emptyText: string;
  disabled?: boolean;
  error?: string;
}) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(value);
  // Kept between openings so reopening the picker resumes the last search.
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [sort, setSort] = useState(sorts[0]?.value ?? '');
  const selected = options.find((option) => option.id === value);
  const groups = useMemo(
    () => [...new Set(options.map((option) => option.group).filter(Boolean) as string[])].sort(),
    [options],
  );
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const compare = sorts.find((entry) => entry.value === sort)?.compare;
    const list = options.filter(
      (option) =>
        (!group || option.group === group) &&
        (!needle ||
          [
            option.title,
            option.subtitle,
            option.keywords,
            ...(option.facts ?? []).map((f) => f.value),
          ]
            .join(' ')
            .toLocaleLowerCase()
            .includes(needle)),
    );
    return compare ? [...list].sort(compare) : list;
  }, [group, options, query, sort, sorts]);
  const pagination = usePagination(shown.map((option) => option.id));
  const close = () => setOpen(false);
  const confirm = () => {
    if (pending) onChange(pending);
    close();
  };

  return (
    <div className="entity-picker" aria-labelledby={labelId} role="group">
      <span id={labelId} className="entity-picker__label">
        <RequiredLabel label={label} required={required} />
      </span>
      {selected ? (
        <div className="entity-picker__selected">
          <OptionBody option={selected} />
          <Btn
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setPending(value);
              setOpen(true);
            }}
          >
            Change
          </Btn>
        </div>
      ) : (
        <button
          type="button"
          className="entity-picker__empty"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onClick={() => {
            setPending('');
            setOpen(true);
          }}
        >
          <Search size={16} aria-hidden="true" /> {chooseLabel}
        </button>
      )}
      {error && (
        <p role="alert" className="entity-picker__error">
          {error}
        </p>
      )}
      {open && (
        <Modal
          title={dialogTitle}
          onClose={close}
          width={760}
          footer={
            <div className="entity-picker__footer">
              <Btn variant="outline" onClick={close}>
                Cancel
              </Btn>
              <Btn disabled={!pending} onClick={confirm}>
                {confirmLabel}
              </Btn>
            </div>
          }
        >
          <div className="entity-picker__dialog">
            <div className="entity-picker__tools">
              <label className="entity-picker__search">
                <span className="sr-only">{searchPlaceholder}</span>
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  autoFocus
                  placeholder={searchPlaceholder}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              {filterLabel && groups.length > 1 && (
                <label>
                  <span className="sr-only">{filterLabel}</span>
                  <select value={group} onChange={(event) => setGroup(event.target.value)}>
                    <option value="">All {filterLabel.toLocaleLowerCase()}</option>
                    {groups.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {sorts.length > 1 && (
                <label>
                  <span className="sr-only">Sort</span>
                  <select value={sort} onChange={(event) => setSort(event.target.value)}>
                    {sorts.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <p className="entity-picker__count" role="status" aria-live="polite">
              {shown.length} {shown.length === 1 ? 'match' : 'matches'}
            </p>
            {!options.length ? (
              <p className="entity-picker__none">{emptyText}</p>
            ) : !shown.length ? (
              <p className="entity-picker__none">No matches. Change the search or filter.</p>
            ) : (
              <ul className="entity-picker__list" aria-label={dialogTitle}>
                {shown.slice(pagination.start, pagination.end).map((option) => {
                  const chosen = option.id === pending;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        className={`entity-picker__option${chosen ? ' is-selected' : ''}`}
                        aria-pressed={chosen}
                        disabled={Boolean(option.disabledReason)}
                        onClick={() => setPending(option.id)}
                        onDoubleClick={() => {
                          setPending(option.id);
                          onChange(option.id);
                          close();
                        }}
                      >
                        <OptionBody option={option} />
                        {chosen && <Check size={18} aria-hidden="true" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {shown.length > 10 && <PaginationBar pagination={pagination} label="Result pages" />}
          </div>
        </Modal>
      )}
    </div>
  );
}

function OptionBody({ option }: { option: EntityOption }) {
  return (
    <>
      {option.media && <span className="entity-picker__media">{option.media}</span>}
      <OptionText option={option} />
    </>
  );
}

function OptionText({ option }: { option: EntityOption }) {
  return (
    <span className="entity-picker__body">
      <strong>{option.title}</strong>
      {option.subtitle && <small>{option.subtitle}</small>}
      {option.facts?.length ? (
        <span className="entity-picker__facts">
          {option.facts.map((fact) => (
            <span key={fact.label}>
              {fact.label}: <b>{fact.value}</b>
            </span>
          ))}
        </span>
      ) : null}
      {option.disabledReason && <em>{option.disabledReason}</em>}
    </span>
  );
}
