import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

type BackNavigationProps = {
  children: ReactNode;
  disabled?: boolean;
} & ({ to: string; onClick?: never } | { to?: never; onClick: () => void });

/** Page navigation only; form-step controls remain beside Continue/Submit. */
export function BackNavigation({ children, disabled, ...props }: BackNavigationProps) {
  const content = (
    <>
      <ChevronLeft size={17} aria-hidden="true" />
      <span>{children}</span>
    </>
  );
  return (
    <div className="page-back-navigation">
      {props.to !== undefined ? (
        <Link className="page-back-navigation__control" to={props.to}>
          {content}
        </Link>
      ) : (
        <button
          className="page-back-navigation__control"
          type="button"
          disabled={disabled}
          onClick={props.onClick}
        >
          {content}
        </button>
      )}
    </div>
  );
}
