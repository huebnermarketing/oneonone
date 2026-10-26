import { describe, it, expect } from 'vitest'
import { mergeBusy, isIntervalFree, alignUp, computeFreeSlots, isMeetingTimeFree } from '@/lib/free-slots'

const M = 60_000
const t = (hhmm: string) => Date.parse(`2026-11-10T${hhmm}:00.000Z`)
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16)
const day = { start: t('09:00'), end: t('12:00') }

describe('mergeBusy / isIntervalFree / alignUp', () => {
  it('merges overlapping and touching ranges, drops empty ones', () => {
    expect(mergeBusy([{ start: t('10:00'), end: t('10:30') }, { start: t('09:00'), end: t('09:30') }, { start: t('10:30'), end: t('11:00') }, { start: t('11:00'), end: t('11:00') }]))
      .toEqual([{ start: t('09:00'), end: t('09:30') }, { start: t('10:00'), end: t('11:00') }])
  })
  it('half-open intervals: back-to-back is free', () => {
    const busy = [{ start: t('10:00'), end: t('10:30') }]
    expect(isIntervalFree(t('09:30'), t('10:00'), busy)).toBe(true)
    expect(isIntervalFree(t('10:30'), t('11:00'), busy)).toBe(true)
    expect(isIntervalFree(t('09:45'), t('10:15'), busy)).toBe(false)
  })
  it('aligns up to the step grid', () => {
    expect(hhmm(alignUp(t('10:17'), 30 * M))).toBe('10:30')
    expect(hhmm(alignUp(t('10:30'), 30 * M))).toBe('10:30')
  })
})

describe('computeFreeSlots', () => {
  it('30-min meetings on a 30-min grid around a busy block', () => {
    const slots = computeFreeSlots({ window: day, busy: [{ start: t('10:00'), end: t('11:00') }], durationMs: 30 * M, stepMs: 30 * M })
    expect(slots.map((s) => hhmm(s.start))).toEqual(['09:00', '09:30', '11:00', '11:30'])
  })
  it('60-min meetings still start every 30 min (no lost :30 starts)', () => {
    const slots = computeFreeSlots({ window: day, busy: [], durationMs: 60 * M, stepMs: 30 * M })
    expect(slots.map((s) => `${hhmm(s.start)}-${hhmm(s.end)}`)).toEqual(['09:00-10:00', '09:30-10:30', '10:00-11:00', '10:30-11:30', '11:00-12:00'])
  })
  it('stays on the grid after a busy event ending off-grid', () => {
    const slots = computeFreeSlots({ window: day, busy: [{ start: t('09:00'), end: t('10:17') }], durationMs: 30 * M, stepMs: 30 * M })
    expect(hhmm(slots[0].start)).toBe('10:30')
  })
  it('respects the accept predicate and empty windows', () => {
    const noon = t('11:00')
    expect(computeFreeSlots({ window: day, busy: [], durationMs: 30 * M, stepMs: 30 * M, accept: (s) => s < noon }).map((s) => hhmm(s.start))).toEqual(['09:00', '09:30', '10:00', '10:30'])
    expect(computeFreeSlots({ window: { start: t('09:00'), end: t('09:20') }, busy: [], durationMs: 30 * M, stepMs: 30 * M })).toEqual([])
  })
})

describe('isMeetingTimeFree (backlog #22)', () => {
  const busy = [{ start: t('11:00'), end: t('11:30') }]
  it('a 60-minute meeting in a free hour is free (was always false before)', () => {
    expect(isMeetingTimeFree(t('09:00'), 60 * M, day, busy)).toBe(true)
  })
  it('detects overlap anywhere in the meeting, not just at its start', () => {
    expect(isMeetingTimeFree(t('10:30'), 60 * M, day, busy)).toBe(false)
  })
  it('must fit inside the window and pass accept', () => {
    expect(isMeetingTimeFree(t('11:30'), 60 * M, day, [])).toBe(false)
    expect(isMeetingTimeFree(t('09:00'), 30 * M, day, [], () => false)).toBe(false)
  })
})
