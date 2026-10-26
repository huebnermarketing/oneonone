import { describe, it, expect, vi } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import {
  notifyMeetingAccepted,
  notifyMeetingCancelled,
  notifyMeetingCompleted,
  notifyMeetingProposed,
  notifyMeetingSuggested,
} from '@/lib/notifications'
import { NOTIFICATION_META } from '@/components/notifications/notification-meta'
import { NotificationType } from '@prisma/client'

const date = new Date('2026-11-02T10:00:00Z')

function lastType() {
  const call = vi.mocked(prismaMock.notification.create).mock.calls.at(-1)
  return (call?.[0] as { data: { type: string } }).data.type
}

describe('notification types (#23)', () => {
  it('each scheduling event gets its own type instead of MEETING_SCHEDULED', async () => {
    vi.mocked(prismaMock.notification.create).mockImplementation((async () => ({})) as never)
    vi.mocked(prismaMock.user.findUnique).mockImplementation((async () => ({ timeZone: 'Asia/Kolkata' })) as never)

    await notifyMeetingProposed('u1', 'Rep', date, 'm1')
    expect(lastType()).toBe('MEETING_PROPOSED')
    await notifyMeetingAccepted('u1', 'Emp', date, 'm1')
    expect(lastType()).toBe('MEETING_ACCEPTED')
    await notifyMeetingSuggested('u1', 'Emp', date, 'm1')
    expect(lastType()).toBe('MEETING_TIME_SUGGESTED')
    await notifyMeetingCompleted('u1', 'Rep', 'm1')
    expect(lastType()).toBe('MEETING_COMPLETED')
    await notifyMeetingCancelled('u1', 'Rep', date, 'm1')
    expect(lastType()).toBe('MEETING_CANCELLED')
  })

  it('every enum value has an icon and label for the UI', () => {
    for (const t of Object.values(NotificationType)) {
      expect(NOTIFICATION_META[t], t).toBeDefined()
      expect(NOTIFICATION_META[t].label.length).toBeGreaterThan(0)
    }
  })
})
