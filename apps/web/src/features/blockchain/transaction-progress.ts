type Stage = 'wallet' | 'confirming';
const pending = new Map<symbol, Stage>();
const listeners = new Set<() => void>();

export function transactionProgress() {
  if ([...pending.values()].includes('wallet')) return 'wallet';
  return pending.size ? 'confirming' : undefined;
}

export function subscribeTransactionProgress(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function beginTransaction() {
  const key = Symbol();
  const update = (stage?: Stage) => {
    if (stage) pending.set(key, stage);
    else pending.delete(key);
    listeners.forEach((listener) => listener());
  };
  update('wallet');
  return {
    confirming: () => update('confirming'),
    finish: () => update(),
  };
}
