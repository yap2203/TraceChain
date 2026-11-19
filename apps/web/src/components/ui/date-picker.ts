import type { MouseEvent } from 'react';

/** Open native date/time pickers from an explicit click, with native fallback. */
export function openDatePicker(event: MouseEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  if (
    event.defaultPrevented ||
    input.disabled ||
    input.readOnly ||
    !['date', 'datetime-local', 'time', 'month', 'week'].includes(input.type) ||
    typeof input.showPicker !== 'function'
  )
    return;
  try {
    input.showPicker();
    // Avoid a second native activation when the calendar icon itself was clicked.
    event.preventDefault();
  } catch {
    // Some browsers/embedded contexts restrict showPicker. Keep native editing and icon behavior.
  }
}
