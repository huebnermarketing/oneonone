import { describe, it, expect, vi } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'

vi.mock('@/lib/meeting-state', () => ({ cancelMeeting: vi.fn(async () => ({})), meetingWithParties: {} }))

import { annotateOffboarding, impactText, offboardUser } from '@/lib/offboarding'
import { cancelMeeting } from '@/lib/meeting-state'
import { deleteCalendarEvent } from '@/lib/google-calendar'

const now = new Date('2026-11-01T00:00:00Z')

describe('offboardUser', () => {
  it('stops schedules (removing the Google series) and cancels upcoming meetings without notifying the leaver', async () => {
    vi.mocked(prismaMock.user.findUnique).mockImplementation((async () => ({ id: 'u1', name: 'Asha Rao' })) as never)
    vi.mocked(prismaMock.recurringSchedule.findMany).mockImplementation((async () => [{ id: 's1', reporterId: 'r1', googleRecurringEventId: 'g-series' }]) as never)
    vi.mocked(prismaMock.recurringSchedule.update).mockImplementation((async () => ({})) as never)
    vi.mocked(prismaMock.meeting.findMany).mockImplementation((async () => [{ id: 'm1' }, { id: 'm2' }]) as never)
    vi.mocked(prismaMock.auditLog.create).mockImplementation((async () => ({})) as never)

    const res = await offboardUser('u1', { id: 'admin', name: 'Admin' }, now)

    expect(res).toEqual({ cancelledMeetings: 2, stoppedSchedules: 1, failed: 0 })
    expect(deleteCalendarEvent).toHaveBeenCalledWith('g-series', 'r1')
    expect(prismaMock.recurringSchedule.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { isActive: false, googleRecurringEventId: null, googleCalendarLink: null } })
    expect(cancelMeeting).toHaveBeenCalledWith({ id: 'm1' }, { id: 'admin', name: 'Admin' }, 'Asha Rao is no longer with the company', { excludeUserIds: ['u1'] })
    // only future PROPOSED/SCHEDULED meetings involving them
    const where = vi.mocked(prismaMock.meeting.findMany).mock.calls[0][0]!.where as Record<string, unknown>
    expect(where).toMatchObject({ meetingDate: { gte: now }, OR: [{ employeeId: 'u1' }, { reporterId: 'u1' }] })
  })

  it('Keka (system) offboarding is attributed to HR (Keka) and keeps going when one meeting fails', async () => {
    vi.mocked(prismaMock.user.findUnique).mockImplementation((async () => ({ id: 'u1', name: 'Asha' })) as never)
    vi.mocked(prismaMock.recurringSchedule.findMany).mockImplementation((async () => []) as never)
    vi.mocked(prismaMock.meeting.findMany).mockImplementation((async () => [{ id: 'm1' }, { id: 'm2' }]) as never)
    vi.mocked(prismaMock.auditLog.create).mockImplementation((async () => ({})) as never)
    vi.mocked(cancelMeeting).mockRejectedValueOnce(new Error('boom'))

    const res = await offboardUser('u1', null, now)
    expect(res).toEqual({ cancelledMeetings: 1, stoppedSchedules: 0, failed: 1 })
    expect(vi.mocked(cancelMeeting).mock.calls.at(-1)![1]).toEqual({ id: 'u1', name: 'HR (Keka)' })
    expect(vi.mocked(prismaMock.auditLog.create).mock.calls[0][0].data).toMatchObject({ userId: 'u1', details: { by: 'keka-sync' } })
  })
})

describe('preview text', () => {
  it('describes what will be cancelled', () => {
    expect(impactText({ meetings: 2, schedules: 1 })).toBe('2 upcoming meetings and 1 recurring schedule will be cancelled')
    expect(impactText({ meetings: 0, schedules: 0 })).toBeNull()
  })
  it('annotates only rows that deactivate an existing user', async () => {
    vi.mocked(prismaMock.meeting.count).mockImplementation((async () => 3) as never)
    vi.mocked(prismaMock.recurringSchedule.count).mockImplementation((async () => 0) as never)
    const rows = [
      { action: 'update', existingId: 'u1', data: { isActive: false }, warnings: [] as string[] },
      { action: 'update', existingId: 'u2', data: {}, warnings: [] as string[] },
    ]
    await annotateOffboarding(rows)
    expect(rows[0].warnings).toEqual(['Deactivated: 3 upcoming meetings will be cancelled'])
    expect(rows[1].warnings).toEqual([])
  })
})
