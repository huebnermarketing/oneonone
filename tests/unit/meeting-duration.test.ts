import { describe, it, expect } from 'vitest'
import { DEFAULT_MEETING_DURATION, MAX_MEETING_DURATION, formatDuration, slotStepMinutes, toMeetingDuration } from '@/lib/meeting-duration'
import { meetingDuration, meetingDurationWithDefault } from '@/lib/validation/common'

describe('meeting duration', () => {
  it('defaults to 15, max 30', () => {
    expect(DEFAULT_MEETING_DURATION).toBe(15)
    expect(MAX_MEETING_DURATION).toBe(30)
  })
  it('slots step by the meeting length', () => {
    expect(slotStepMinutes(15)).toBe(15)
    expect(slotStepMinutes(30)).toBe(30)
  })
  it('coerces unknown values to the default', () => {
    expect(toMeetingDuration(30)).toBe(30)
    expect(toMeetingDuration('15')).toBe(15)
    expect(toMeetingDuration(45)).toBe(15)
    expect(toMeetingDuration(undefined)).toBe(15)
  })
  it('formats', () => expect(formatDuration(30)).toBe('30 min'))
  it('validation accepts 15/30 (also as query strings), rejects others, defaults to 15', () => {
    expect(meetingDuration.parse('30')).toBe(30)
    expect(meetingDuration.safeParse(45).success).toBe(false)
    expect(meetingDurationWithDefault.parse(undefined)).toBe(15)
  })
})
