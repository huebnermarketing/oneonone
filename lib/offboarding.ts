/**
 * Offboarding: when someone is deactivated (left the company per Keka, CSV status=Inactive, or an
 * admin), their upcoming meetings and recurring schedules are wound down so nobody keeps getting
 * invites or reminders for 1:1s that can't happen.
 *
 * - Every future PROPOSED/SCHEDULED meeting where they are employee or reporter is cancelled through
 *   lib/meeting-state.cancelMeeting (Google Calendar event removed, the other person notified).
 * - Every active recurring schedule they are part of is switched off and its Google series removed.
 * - History (past meetings, recordings, notes, todos) is untouched; reactivating does not restore anything.
 * Best effort: a failure on one meeting is logged and the rest continue. Never throws.
 */
import { MeetingStatus } from '@prisma/client'
import { prisma } from './prisma'
import { cancelMeeting, meetingWithParties } from './meeting-state'
import { deleteCalendarEvent } from './google-calendar'
import { createAuditLog } from './audit'

/** Who triggered it. `null` = the system (Keka sync); the audit entry is then recorded on the leaver. */
export type OffboardingActor = { id: string; name: string | null } | null

const SYSTEM_ACTOR_NAME = 'HR (Keka)'

const upcomingWhere = (userId: string, now: Date) => ({
  status: { in: [MeetingStatus.PROPOSED, MeetingStatus.SCHEDULED] },
  meetingDate: { gte: now },
  OR: [{ employeeId: userId }, { reporterId: userId }],
})

export interface OffboardingImpact {
  meetings: number
  schedules: number
}

/** What deactivating these users would cancel — for previews and confirm dialogs. */
export async function offboardingImpact(userIds: string[], now = new Date()): Promise<Map<string, OffboardingImpact>> {
  const out = new Map<string, OffboardingImpact>()
  await Promise.all(
    userIds.map(async (id) => {
      const [meetings, schedules] = await Promise.all([
        prisma.meeting.count({ where: upcomingWhere(id, now) }),
        prisma.recurringSchedule.count({ where: { isActive: true, OR: [{ employeeId: id }, { reporterId: id }] } }),
      ])
      out.set(id, { meetings, schedules })
    })
  )
  return out
}

export function impactText({ meetings, schedules }: OffboardingImpact): string | null {
  const parts = [
    meetings > 0 ? `${meetings} upcoming meeting${meetings === 1 ? '' : 's'}` : null,
    schedules > 0 ? `${schedules} recurring schedule${schedules === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return parts.length ? `${parts.join(' and ')} will be cancelled` : null
}

export interface OffboardingResult {
  cancelledMeetings: number
  stoppedSchedules: number
  failed: number
}

export async function offboardUser(userId: string, actor: OffboardingActor, now = new Date()): Promise<OffboardingResult> {
  const result: OffboardingResult = { cancelledMeetings: 0, stoppedSchedules: 0, failed: 0 }
  try {
    const leaver = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
    if (!leaver) return result
    const reason = `${leaver.name || 'This person'} is no longer with the company`
    const by = actor ?? { id: leaver.id, name: SYSTEM_ACTOR_NAME }

    // 1. Recurring schedules: switch off and remove the Google series (so no new meetings are generated)
    const schedules = await prisma.recurringSchedule.findMany({
      where: { isActive: true, OR: [{ employeeId: userId }, { reporterId: userId }] },
      select: { id: true, reporterId: true, googleRecurringEventId: true },
    })
    for (const s of schedules) {
      try {
        if (s.googleRecurringEventId) {
          await deleteCalendarEvent(s.googleRecurringEventId, s.reporterId).catch((e) => console.warn('[offboarding] series delete failed', s.id, e instanceof Error ? e.message : e))
        }
        await prisma.recurringSchedule.update({ where: { id: s.id }, data: { isActive: false, googleRecurringEventId: null, googleCalendarLink: null } })
        result.stoppedSchedules++
      } catch (e) {
        result.failed++
        console.error('[offboarding] schedule', s.id, e instanceof Error ? e.message : e)
      }
    }

    // 2. Upcoming meetings: cancel (calendar event removed, the other person notified; the leaver is not)
    const meetings = await prisma.meeting.findMany({ where: upcomingWhere(userId, now), ...meetingWithParties })
    for (const m of meetings) {
      try {
        await cancelMeeting(m, by, reason, { excludeUserIds: [userId] })
        result.cancelledMeetings++
      } catch (e) {
        result.failed++
        console.error('[offboarding] meeting', m.id, e instanceof Error ? e.message : e)
      }
    }

    if (result.cancelledMeetings || result.stoppedSchedules || result.failed) {
      await createAuditLog({
        userId: by.id,
        action: 'UPDATE',
        entityType: 'User',
        entityId: userId,
        details: { offboarded: true, by: actor ? 'admin' : 'keka-sync', ...result },
      })
    }
  } catch (e) {
    console.error('[offboarding] failed for user', userId, e instanceof Error ? e.message : e)
  }
  return result
}

/** Offboard several users (sequentially — each cancels meetings and calls Google). */
export async function offboardUsers(userIds: string[], actor: OffboardingActor): Promise<OffboardingResult> {
  const total: OffboardingResult = { cancelledMeetings: 0, stoppedSchedules: 0, failed: 0 }
  for (const id of userIds) {
    const r = await offboardUser(id, actor)
    total.cancelledMeetings += r.cancelledMeetings
    total.stoppedSchedules += r.stoppedSchedules
    total.failed += r.failed
  }
  return total
}

/** Add "N upcoming meetings … will be cancelled" to preview rows that deactivate an existing user. */
export async function annotateOffboarding(rows: { action: string; existingId?: string; data: { isActive?: boolean }; warnings: string[] }[]) {
  const leavers = rows.filter((r) => r.action === 'update' && r.existingId && r.data.isActive === false)
  if (leavers.length === 0) return
  const impact = await offboardingImpact(leavers.map((r) => r.existingId!))
  for (const r of leavers) {
    const text = impactText(impact.get(r.existingId!) ?? { meetings: 0, schedules: 0 })
    if (text) r.warnings.push(`Deactivated: ${text}`)
  }
}
