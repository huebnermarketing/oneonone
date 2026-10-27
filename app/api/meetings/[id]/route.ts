import { NextRequest, NextResponse } from 'next/server'
import { ADMIN, notFound, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { logMeetingUpdated, logMeetingDeleted } from '@/lib/audit'
import { parseZoomMeetingId } from '@/lib/zoom'
import { assertAccess, canManageMeeting } from '@/lib/meeting-access'
import { completeMeeting, loadMeeting } from '@/lib/meeting-state'
import { updateCalendarEvent, deleteCalendarEvent } from '@/lib/google-calendar'
import { updateMeetingSchema } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/meetings/[id]
 * Reporter or admin: change date, meeting type/link, or mark COMPLETED.
 * Cancelling is a separate endpoint (POST /cancel) governed by the cancel policy.
 */
export const PATCH = withApiAuth(async (req: NextRequest, { user, params }) => {
  const body = await parseBody(req, updateMeetingSchema)

  const meeting = await loadMeeting(params.id)
  if (!meeting) throw notFound('Meeting')
  assertAccess(canManageMeeting(user, meeting), 'Only the reporter or an admin can update this meeting')

  // Status change is handled by the state machine, separately from field edits
  if (body.status === 'COMPLETED') {
    return NextResponse.json(await completeMeeting(meeting, user.id))
  }

  const updateData: {
    meetingDate?: Date
    meetingType?: 'IN_PERSON' | 'ZOOM'
    meetingLink?: string | null
    zoomMeetingId?: string | null
  } = {}

  if (body.meetingDate) updateData.meetingDate = body.meetingDate

  if (body.meetingType) {
    updateData.meetingType = body.meetingType
    const link = body.meetingType === 'IN_PERSON' ? null : body.meetingLink ?? meeting.meetingLink
    updateData.meetingLink = link
    updateData.zoomMeetingId = link ? parseZoomMeetingId(link) : null
  } else if (body.meetingLink !== undefined && meeting.meetingType === 'ZOOM') {
    updateData.meetingLink = body.meetingLink
    updateData.zoomMeetingId = body.meetingLink ? parseZoomMeetingId(body.meetingLink) : null
  }

  const updatedMeeting = await prisma.meeting.update({
    where: { id: params.id },
    data: updateData,
    include: {
      employee: { select: { name: true, email: true } },
      reporter: { select: { name: true, email: true } },
    },
  })

  await logMeetingUpdated(user.id, params.id, { changes: updateData, employeeName: meeting.employee.name })

  if (meeting.calendarEvent && body.meetingDate) {
    await updateCalendarEvent(
      meeting.calendarEvent.googleEventId,
      meeting.reporterId,
      body.meetingDate,
      meeting.employee.name,
      meeting.reporter.name,
      meeting.durationMinutes
    ).catch((error) => console.error('Failed to update calendar event:', error))
  }

  return NextResponse.json(updatedMeeting)
})

/** DELETE /api/meetings/[id] — hard delete, Super Admin only. Todos linked to it are kept (meetingId → null). */
export const DELETE = withApiAuth(ADMIN, async (_req: NextRequest, { user, params }) => {
  const meeting = await loadMeeting(params.id)
  if (!meeting) throw notFound('Meeting')

  if (meeting.calendarEvent) {
    await deleteCalendarEvent(meeting.calendarEvent.googleEventId, meeting.reporterId).catch((error) =>
      console.error('Failed to delete calendar event:', error)
    )
  }

  await prisma.meeting.delete({ where: { id: params.id } })
  await logMeetingDeleted(user.id, params.id, { meetingDate: meeting.meetingDate })

  return NextResponse.json({ success: true })
})
