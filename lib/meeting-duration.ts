/**
 * Meeting length options (client-safe). Each meeting and recurring schedule stores its own
 * `durationMinutes`; rows created before the option existed are 30.
 */
export const MEETING_DURATIONS = [15, 30] as const
export type MeetingDuration = (typeof MEETING_DURATIONS)[number]

export const DEFAULT_MEETING_DURATION: MeetingDuration = 15

/** Longest option — bounds how far back an overlapping meeting can start. */
export const MAX_MEETING_DURATION = Math.max(...MEETING_DURATIONS)

/** Candidate start times step by the meeting length: 15 → 9:00, 9:15 …; 30 → 9:00, 9:30 … */
export const slotStepMinutes = (duration: number) => duration

/** "15 min" */
export const formatDuration = (minutes: number) => `${minutes} min`

/** Coerce anything stored or sent to a supported length (unknown → default). */
export function toMeetingDuration(v: unknown): MeetingDuration {
  const n = Number(v)
  return (MEETING_DURATIONS as readonly number[]).includes(n) ? (n as MeetingDuration) : DEFAULT_MEETING_DURATION
}
