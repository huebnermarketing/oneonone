import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { OneOnOneForm } from '@/components/forms/one-on-one-form'
import { notFound, redirect } from 'next/navigation'
import { canAccessEmployeeData } from '@/lib/auth-helpers'
import { MeetingFormClient } from './form-client'

export default async function MeetingFormPage({
  params: paramsPromise,
}: {
  params: Promise<{ id: string }>
}) {
  const params = await paramsPromise
  const user = await getCurrentUser()
  if (!user) redirect('/auth/signin')

  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    include: { employee: true },
  })

  if (!meeting) return notFound()

  const canAccess = canAccessEmployeeData(
    user.role,
    user.id,
    meeting.employeeId,
    meeting.employee.reportsToId
  )

  if (!canAccess || user.id !== meeting.employeeId) {
    return notFound()
  }

  // Allow form when: SCHEDULED, or COMPLETED but meeting is still in the future (can edit)
  const meetingDate = new Date(meeting.meetingDate)
  const isPastMeeting = meetingDate.getTime() < Date.now()
  const canEdit =
    meeting.status === 'SCHEDULED' ||
    (meeting.status === 'COMPLETED' && !!meeting.formSubmittedAt && !isPastMeeting)
  const isReadOnly = !!meeting.formSubmittedAt && isPastMeeting

  if (meeting.status !== 'SCHEDULED' && !canEdit && !isReadOnly) {
    redirect(`/meetings/${meeting.id}`)
  }

  const initialData = {
    checkInPersonal: meeting.checkInPersonal || '',
    checkInProfessional: meeting.checkInProfessional || '',
    priorityGoalProfessional: meeting.priorityGoalProfessional || '',
    priorityGoalAgency: meeting.priorityGoalAgency || '',
    progressReport: meeting.progressReport || '',
    goodNews: meeting.goodNews || '',
    supportNeeded: meeting.supportNeeded || '',
    priorityDiscussions: meeting.priorityDiscussions || '',
    headsUp: meeting.headsUp || '',
    anythingElse: meeting.anythingElse || '',
  }

  return (
    <MeetingFormClient
      meetingId={meeting.id}
      initialData={initialData}
      isReadOnly={isReadOnly}
      isSubmitted={!!meeting.formSubmittedAt}
    />
  )
}
