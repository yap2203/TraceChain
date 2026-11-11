/** Client-side feedback only. Protected APIs and contracts remain authoritative. */
export function textError(value: string, label: string, maximum: number, required = true) {
  if (required && !value.trim()) return `${label} is required.`;
  if (value.trim().length > maximum) return `${label} must be ${maximum} characters or fewer.`;
  return '';
}

export function quantityError(value: string, label = 'Quantity', maximum?: string) {
  if (!/^[1-9]\d{0,38}$/.test(value))
    return `${label} must be a positive whole number of at most 39 digits.`;
  if (maximum !== undefined && BigInt(value) > BigInt(maximum))
    return `${label} exceeds the available quantity (${maximum}).`;
  return '';
}

export function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const date = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === value ? date : NaN;
}
export function futureDateError(value: string, label: string, now = new Date()) {
  const date = calendarDate(value);
  return !Number.isFinite(date)
    ? `${label} must be a valid date.`
    : date + 86_400_000 <= now.getTime()
      ? `${label} cannot be in the past.`
      : '';
}
export function productionDateError(produced: string, expires: string, now = new Date()) {
  const start = calendarDate(produced);
  const end = calendarDate(expires);
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return 'Enter valid production and expiry dates.';
  if (start > now.getTime()) return 'Production date cannot be in the future.';
  if (end <= now.getTime()) return 'Expiry date must be in the future.';
  if (end <= start) return 'Expiry date must follow production date.';
  return '';
}
export function referenceError(value: string, label = 'Batch reference') {
  return (
    textError(value, label, 120) ||
    (!/^[A-Za-z0-9._:/-]+$/.test(value.trim())
      ? `${label} can contain letters, numbers, dots, underscores, colons, slashes and hyphens only.`
      : '')
  );
}
export function uploadError(
  file: File,
  maximumBytes: number,
  extensions: RegExp,
  mediaTypes: readonly string[],
) {
  if (!file.size) return 'The selected file is empty.';
  if (file.size > maximumBytes)
    return `The selected file exceeds ${Math.round(maximumBytes / 1024 / 1024)} MB.`;
  if (!extensions.test(file.name) || (file.type && !mediaTypes.includes(file.type)))
    return 'The selected file type is not supported.';
  return '';
}
