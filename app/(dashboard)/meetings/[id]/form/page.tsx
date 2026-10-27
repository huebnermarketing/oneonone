import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { notFound, redirect } from 'next/navigation'
import { canAccessEmployeeData } from '@/lib/auth-helpers'
import { MeetingFormClient } from './form-client'
import { canEditFormAnswers } from '@/lib/meeting-access'
import { FORM_FIELDS, type FormFieldKey } from '@/lib/form-fields'

const answersFor = (m: Record<FormFieldKey, string | null>) => Object.fromEntries(FORM_FIELDS.map((f) => [f.key, m[f.key] || '']))

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

  // Meeting owner / admin correcting the employee's submitted answers (recorded in the history)
  if (user.id !== meeting.employeeId) {
    if (!canEditFormAnswers(user, meeting)) return notFound()
    return (
      <MeetingFormClient
        meetingId={meeting.id}
        initialData={answersFor(meeting)}
        isSubmitted
        mode="edit"
        employeeName={meeting.employee.name || 'the employee'}
      />
    )
  }
  if (!canAccess) return notFound()

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

  const initialData = answersFor(meeting)

  return (
    <MeetingFormClient
      meetingId={meeting.id}
      initialData={initialData}
      isReadOnly={isReadOnly}
      isSubmitted={!!meeting.formSubmittedAt}
    />
  )
}
