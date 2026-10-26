import { describe, it, expect, vi } from 'vitest'
import { TtlCache } from '@/lib/ttl-cache'

describe('TtlCache', () => {
  it('loads once per TTL, then reloads (the Keka bug: expiry was never re-armed)', async () => {
    let t = 0
    const cache = new TtlCache<number>({ ttlMs: 1000, now: () => t })
    const load = vi.fn(async () => 42)
    expect(await cache.get('k', load, 0)).toBe(42)
    t = 999
    expect(await cache.get('k', load, 0)).toBe(42)
    expect(load).toHaveBeenCalledTimes(1)
    t = 1001
    await cache.get('k', load, 0)
    t = 1500
    await cache.get('k', load, 0)
    expect(load).toHaveBeenCalledTimes(2) // re-armed on every refresh
  })

  it('caches empty results too (a year with no holidays is not a miss)', async () => {
    const cache = new TtlCache<string[]>({ ttlMs: 1000, now: () => 0 })
    const load = vi.fn(async () => [] as string[])
    await cache.get('k', load, [])
    await cache.get('k', load, [])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('failed loads return the fallback and are retried after the shorter error TTL', async () => {
    let t = 0
    const cache = new TtlCache<string>({ ttlMs: 10_000, errorTtlMs: 100, now: () => t })
    const load = vi.fn(async () => {
      throw new Error('429')
    })
    expect(await cache.get('k', load, 'fallback')).toBe('fallback')
    t = 50
    await cache.get('k', load, 'fallback')
    expect(load).toHaveBeenCalledTimes(1)
    t = 151
    await cache.get('k', load, 'fallback')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('concurrent callers share one in-flight load', async () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 })
    let resolve!: (v: number) => void
    const load = vi.fn(() => new Promise<number>((r) => (resolve = r)))
    const a = cache.get('k', load, 0)
    const b = cache.get('k', load, 0)
    resolve(7)
    expect(await Promise.all([a, b])).toEqual([7, 7])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keys are independent', async () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 })
    expect(await cache.get('a', async () => 'A', '')).toBe('A')
    expect(await cache.get('b', async () => 'B', '')).toBe('B')
  })
})
