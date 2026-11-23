export interface ReadModelState {
  updatedAt: string;
  stale: boolean;
  refreshing: boolean;
  refreshFailed: boolean;
}

/** Bounded, process-local display data. Callers must authorize before every read.
 * Never use these snapshots for action preflight, proof verification or stock allocation.
 */
export class DisplaySnapshots<T> {
  private entries = new Map<
    string,
    {
      value?: T;
      updatedAt?: number;
      pending?: Promise<T>;
      retryAt?: number;
      failed?: boolean;
    }
  >();

  constructor(
    private freshMs = 5_000,
    private maxAgeMs = 120_000,
  ) {}

  invalidate() {
    this.entries.clear();
  }

  async get(key: string, load: () => Promise<T>, force = false) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {};
      this.entries.set(key, entry);
      if (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value!);
    }
    const age = entry.updatedAt === undefined ? Infinity : Date.now() - entry.updatedAt;
    const usable = entry.value !== undefined && age >= 0 && age < this.maxAgeMs;
    const start = () => {
      if (!entry.pending) {
        // Promise.resolve also captures synchronous loader failures.
        const pending = Promise.resolve().then(load);
        entry.pending = pending;
        void pending.then(
          (value) => {
            entry.value = structuredClone(value);
            entry.updatedAt = Date.now();
            entry.failed = false;
            entry.retryAt = undefined;
            entry.pending = undefined;
          },
          () => {
            entry.failed = true;
            entry.retryAt = Date.now() + this.freshMs;
            entry.pending = undefined;
          },
        );
      }
      return entry.pending;
    };
    if (force || !usable) await start();
    else if (age >= this.freshMs && (entry.retryAt ?? 0) <= Date.now()) void start();
    return {
      value: structuredClone(entry.value!),
      readModel: {
        updatedAt: new Date(entry.updatedAt!).toISOString(),
        stale: Date.now() - entry.updatedAt! >= this.freshMs,
        refreshing: !!entry.pending,
        refreshFailed: !!entry.failed,
      } satisfies ReadModelState,
    };
  }
}
