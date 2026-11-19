import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type FocusEventHandler,
  type KeyboardEvent,
} from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { Country } from 'react-phone-number-input';

interface Option {
  value?: Country;
  label: string;
  divider?: boolean;
}
interface Props {
  variant?: 'compact' | 'field';
  value?: Country;
  options: Option[];
  onChange: (country?: Country) => void;
  iconComponent: ComponentType<{ country?: Country; label: string }>;
  disabled?: boolean;
  readOnly?: boolean;
  onFocus?: FocusEventHandler<HTMLDivElement>;
  onBlur?: FocusEventHandler<HTMLDivElement>;
  'aria-label'?: string;
}

export function RegistrationCountrySelect({
  variant = 'compact',
  value,
  options,
  onChange,
  iconComponent: Icon,
  disabled,
  readOnly,
  onFocus,
  onBlur,
  'aria-label': label = 'Country',
}: Props) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();
  const selected = options.find((option) => !option.divider && option.value === value);
  const visible = options.filter(
    (option) =>
      !option.divider &&
      `${option.label} ${option.value ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (option: Option) => {
    onChange(option.value);
    close();
  };
  const navigate = (event: KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === 'ArrowDown') next = (index + 1) % visible.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + visible.length) % visible.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = visible.length - 1;
    else return;
    event.preventDefault();
    optionRefs.current[next]?.focus();
  };
  return (
    <div
      ref={root}
      className={variant === 'field' ? 'relative w-full min-w-0' : 'relative shrink-0'}
      onFocus={onFocus}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setOpen(false);
          onBlur?.(event);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        type="button"
        ref={trigger}
        disabled={disabled || readOnly}
        aria-label={label}
        aria-describedby={`${listId}-selected`}
        title={selected?.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={
          variant === 'field'
            ? 'flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg border border-solid border-[var(--c-border2,var(--color-border))] bg-[var(--c-surface,var(--color-surface))] px-3 py-2 text-left text-sm text-[var(--c-text,var(--color-text))] outline-none focus-visible:ring-2 focus-visible:ring-ui-primary'
            : 'flex min-h-7 items-center gap-2 rounded border-0 bg-transparent px-1 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-ui-primary'
        }
        onClick={() => {
          setSearch('');
          setOpen((current) => !current);
        }}
      >
        <span aria-hidden="true" className="block w-6 shrink-0">
          <Icon country={value} label={selected?.label ?? 'International'} />
        </span>
        {variant === 'field' && (
          <span className="min-w-0 flex-1 truncate">{selected?.label ?? 'Select a country'}</span>
        )}
        <ChevronDown aria-hidden="true" size={16} className="shrink-0" />
      </button>
      <span id={`${listId}-selected`} className="sr-only">
        Selected country: {selected?.label ?? 'International'}
      </span>
      {open && (
        <div
          className={`absolute top-full left-0 z-50 mt-2 rounded-xl border border-ui-border bg-ui-surface p-2 text-ui-text shadow-xl ${variant === 'field' ? 'w-full min-w-0' : 'w-72 max-w-[calc(100vw-4rem)]'}`}
        >
          <label className="mb-2 flex items-center gap-2 rounded-lg border border-ui-border px-2">
            <Search aria-hidden="true" size={16} />
            <input
              ref={input}
              type="search"
              aria-label="Search countries"
              value={search}
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm text-inherit outline-none"
              placeholder="Search country"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  optionRefs.current[event.key === 'ArrowDown' ? 0 : visible.length - 1]?.focus();
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (visible[0]) choose(visible[0]);
                }
              }}
            />
          </label>
          <div
            role="listbox"
            id={listId}
            aria-label="Countries"
            className="max-h-60 overflow-y-auto overscroll-contain"
          >
            {visible.map((option, index) => (
              <button
                key={option.value ?? 'international'}
                type="button"
                role="option"
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                aria-selected={option.value === value}
                className="flex w-full items-center gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-sm text-inherit hover:bg-ui-primary/10 focus:bg-ui-primary/10 focus:outline-none aria-selected:bg-ui-primary/15"
                onClick={() => choose(option)}
                onKeyDown={(event) => navigate(event, index)}
              >
                <span aria-hidden="true" className="block w-6 shrink-0">
                  <Icon country={option.value} label={option.label} />
                </span>
                <span>{option.label}</span>
              </button>
            ))}
            {!visible.length && (
              <p role="status" className="p-3 text-sm">
                No countries found.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
