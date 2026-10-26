/**
 * Small in-process cache with a per-entry TTL and in-flight de-duplication: concurrent callers for
 * the same key share one pending load. Successful and failed loads can have different lifetimes so
 * an outage is retried soon without hammering the upstream on every call.
 */
export interface TtlCacheOptions {
  ttlMs: number
  /** Lifetime of a failed load (the loader threw). Default: ttlMs / 10 */
  errorTtlMs?: number
  /** Injectable clock for tests */
  now?: () => number
}

interface Entry<V> {
  promise: Promise<V>
  expiresAt: number
}

export class TtlCache<V> {
  private entries = new Map<string, Entry<V>>()
  private readonly ttlMs: number
  private readonly errorTtlMs: number
  private readonly now: () => number

  constructor(opts: TtlCacheOptions) {
    this.ttlMs = opts.ttlMs
    this.errorTtlMs = opts.errorTtlMs ?? Math.max(1, Math.floor(opts.ttlMs / 10))
    this.now = opts.now ?? Date.now
  }

  /** Value for `key`, loading it at most once per lifetime. If the loader throws, `fallback` is returned and cached briefly. */
  async get(key: string, load: () => Promise<V>, fallback: V): Promise<V> {
    const hit = this.entries.get(key)
    if (hit && hit.expiresAt > this.now()) return hit.promise

    const entry: Entry<V> = { promise: Promise.resolve(fallback), expiresAt: Number.POSITIVE_INFINITY } // pending: never expires until settled
    entry.promise = load().then(
      (value) => {
        entry.expiresAt = this.now() + this.ttlMs
        return value
      },
      () => {
        entry.expiresAt = this.now() + this.errorTtlMs
        return fallback
      }
    )
    this.entries.set(key, entry)
    return entry.promise
  }

  clear() {
    this.entries.clear()
  }
}
