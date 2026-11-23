let epoch = 0;
let identity = '';
export function authRequestScope() {
  return `${epoch}:${identity}`;
}
export function resetAuthRequestScope() {
  epoch++;
  identity = '';
}
export function synchronizeAuthRequestScope(value: string) {
  if (identity !== value) {
    epoch++;
    identity = value;
  }
}
