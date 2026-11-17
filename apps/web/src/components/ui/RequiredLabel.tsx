import { Fragment } from 'react';

export function RequiredMarker() {
  return <span className="required-marker text-red-400">*</span>;
}

/** Preserve existing label text while giving every required asterisk the same color. */
export function RequiredLabel({ label, required = false }: { label: string; required?: boolean }) {
  const parts = label.split('*');
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <RequiredMarker />}
          {part}
        </Fragment>
      ))}
      {required && parts.length === 1 && (
        <>
          {' '}
          <RequiredMarker />
        </>
      )}
    </>
  );
}
