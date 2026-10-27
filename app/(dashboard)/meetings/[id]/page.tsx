import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Calendar, User, FileText, CheckSquare, Clock, ArrowLeft, Mic, Video, MapPin, ExternalLink } from 'lucide-react'
import { UserRole } from '@prisma/client'
import { formatDateOnly, formatMeetingLong, timeZoneAbbrev } from '@/lib/dates'
import { DEFAULT_TIMEZONE } from '@/lib/constants'
import { getSettings } from '@/lib/settings'
import { AddTodoForm } from './add-todo-form'
import { MeetingRecorder } from './meeting-recorder'
import { MarkCompletedButton } from './mark-completed-button'
import { FORM_REQUIRED_MESSAGE } from './messages'
import { TranscriptViewer } from './transcript-viewer'
import { MeetingNotes } from './meeting-notes'
import { FileAttachments } from './file-attachments'
import { ProposalActions } from './proposal-actions'
import { formatDuration } from '@/lib/meeting-duration'
import { getPolicies } from '@/lib/settings'
import { CancelMeetingButton } from './cancel-meeting-button'
import { RescheduleBanner, RescheduleButton } from './reschedule'
import { rescheduleRole } from '@/lib/reschedule'
import { canCancel, canManageMeeting, canViewMeeting, canViewNotes, canViewRecording } from '@/lib/meeting-access'
import { MeetingStatusPill, Pill, TodoPriorityPill, TodoStatusPill } from '@/components/ui/pill'

export default async function MeetingDetailPage({
  params: paramsPromise,
}: {
  params: Promise<{ id: string }>
}) {
  const params = await paramsPromise
  const user = await getCurrentUser()
  if (!user) return notFound()

  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    include: {
      employee: true,
      reporter: true,
      recording: true,
      attachments: {
        orderBy: { createdAt: 'desc' },
      },
      todos: {
        include: {
          assignedTo: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!meeting) return notFound()

  // Type-safe access for meetingType/meetingLink (Prisma client may be generated from older schema on server)
  const meetingWithType = meeting as typeof meeting & { meetingType?: string; meetingLink?: string | null }

  // Participants (employee/reporter) and Super Admins only — a reporter who is the *employee*
  // in this meeting is treated as the employee, not as a manager.
  if (!canViewMeeting(user, meeting)) return notFound()

  const isReporter = canManageMeeting(user, meeting)
  const isEmployee = user.id === meeting.employeeId
  const settings = isReporter ? await getSettings() : null
  const [canSeeRecording, canSeeNotes, mayCancel] = await Promise.all([
    canViewRecording(user, meeting),
    canViewNotes(user, meeting),
    canCancel(user, meeting),
  ])
  const isCancellable = mayCancel && (meeting.status === 'PROPOSED' || meeting.status === 'SCHEDULED')
  const meetingDate = new Date(meeting.meetingDate)
  const isPast = meetingDate < new Date()
  const hasFormData = meeting.checkInPersonal || meeting.checkInProfessional
  const formSubmitted = !!meeting.formSubmittedAt || (meeting.status === 'COMPLETED' && !!hasFormData)
  const canEditForm = isEmployee && (meeting.status === 'SCHEDULED' || (meeting.status === 'COMPLETED' && !isPast))
  const showFillFormCta = canEditForm && !formSubmitted
  const showEditFormCta = canEditForm && formSubmitted && !isPast

  // Proposal flow
  const isProposed = meeting.status === 'PROPOSED'
  const proposedById = meeting.proposedById
  // When a Super Admin creates the meeting, proposedById is neither reporter nor employee
  const proposerIsThirdParty = !!proposedById && proposedById !== meeting.reporterId && proposedById !== meeting.employeeId
  const isProposalReceiver = isProposed && (
    (proposedById === meeting.reporterId && user.id === meeting.employeeId) ||
    (proposedById === meeting.employeeId && user.id === meeting.reporterId) ||
    (proposerIsThirdParty && user.id === meeting.employeeId)
  )
  const isProposalProposer = isProposed && (
    user.id === proposedById ||
    (proposerIsThirdParty && user.id === meeting.reporterId)
  )
  const proposedByName = proposerIsThirdParty
    ? meeting.reporter.name
    : proposedById === meeting.reporterId ? meeting.reporter.name : meeting.employee.name
  const otherPartyName = user.id === meeting.employeeId ? meeting.reporter.name : meeting.employee.name
  const { workingDays } = await getPolicies()

  // Reschedule of a SCHEDULED meeting (lib/reschedule.ts)
  const isMeetingParticipant = user.id === meeting.employeeId || user.id === meeting.reporterId
  const reschedulePending = meeting.status === 'SCHEDULED' && !!meeting.rescheduleDate && !!meeting.rescheduleRequestedById
  const canRequestReschedule = meeting.status === 'SCHEDULED' && isMeetingParticipant && !reschedulePending
  const rescheduleRequester = meeting.rescheduleRequestedById === meeting.employeeId ? meeting.employee : meeting.reporter
  const tz = user.timeZone ?? DEFAULT_TIMEZONE
  const meetingDateLabel = `${formatMeetingLong(meetingDate, tz)} ${timeZoneAbbrev(meetingDate, tz)}`

  const formSections = [
    { title: 'Check-In: Personal Best', content: meeting.checkInPersonal },
    { title: 'Check-In: Professional Best', content: meeting.checkInProfessional },
    { title: 'Priority Goal: Professional Growth', content: meeting.priorityGoalProfessional },
    { title: 'Priority Goal: Agency Growth', content: meeting.priorityGoalAgency },
    { title: 'Progress Report', content: meeting.progressReport },
    { title: 'Good News', content: meeting.goodNews },
    { title: 'Support Needed', content: meeting.supportNeeded },
    { title: 'Priority Discussions', content: meeting.priorityDiscussions },
    { title: 'Heads Up', content: meeting.headsUp },
    { title: 'Anything Else', content: meeting.anythingElse },
  ].filter(section => section.content)

  return (
    <div className="w-full max-w-4xl mx-auto min-w-0 space-y-8">
      {/* Back Button */}
      <Link
        href="/meetings"
        className="inline-flex items-center gap-2 text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to meetings
      </Link>

      {/* Header */}
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white mb-1">
            One-on-One Meeting
          </h1>
          <p className="text-sm sm:text-base text-medium-gray flex items-center gap-2">
            <Calendar className="w-4 h-4 flex-shrink-0" />
            {meetingDateLabel}
            <span className="text-light-gray" aria-hidden="true">·</span>
            <span>{formatDuration(meeting.durationMinutes)}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-off-white dark:bg-dark-gray text-medium-gray dark:text-light-gray">
              {meetingWithType.meetingType === 'ZOOM' ? (
                <><Video className="w-3.5 h-3.5" /> Over Zoom</>
              ) : (
                <><MapPin className="w-3.5 h-3.5" /> In person</>
              )}
            </span>
            {meetingWithType.meetingLink && (
              <a
                href={meetingWithType.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <Video className="w-4 h-4" />
                Join Zoom meeting
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {isReporter && meeting.status === 'SCHEDULED' && (
            <MarkCompletedButton
              meetingId={meeting.id}
              formSubmitted={formSubmitted}
              requireFormBeforeComplete={settings?.requireFormBeforeComplete ?? true}
            />
          )}
          {canRequestReschedule && (
            <RescheduleButton meetingId={meeting.id} durationMinutes={meeting.durationMinutes} workingDays={workingDays} otherPartyName={otherPartyName || 'the other participant'} />
          )}
          {isCancellable && (
            <CancelMeetingButton meetingId={meeting.id} otherPartyName={otherPartyName || 'the other participant'} />
          )}
          {meeting.status === 'SCHEDULED' && formSubmitted && isPast ? (
            <Pill tone="blue" className="sm:text-sm sm:px-4 sm:py-2">Form submitted</Pill>
          ) : (
            <MeetingStatusPill status={meeting.status} isPast={isPast} className="sm:text-sm sm:px-4 sm:py-2" />
          )}
          {reschedulePending && <Pill tone="amber" dot className="sm:text-sm sm:px-4 sm:py-2">Reschedule pending</Pill>}
        </div>
        {isReporter && meeting.status === 'SCHEDULED' && !formSubmitted && (settings?.requireFormBeforeComplete ?? true) && (
          <p className="text-sm text-amber-600 dark:text-amber-400">{FORM_REQUIRED_MESSAGE}</p>
        )}
      </div>

      {reschedulePending && (
        <RescheduleBanner
          meetingId={meeting.id}
          durationMinutes={meeting.durationMinutes}
          workingDays={workingDays}
          otherPartyName={(user.id === meeting.employeeId ? meeting.reporter.name : meeting.employee.name) || 'the other participant'}
          newDate={meeting.rescheduleDate!.toISOString()}
          newDurationMinutes={meeting.rescheduleDuration ?? meeting.durationMinutes}
          requestedByName={rescheduleRequester.name || 'Someone'}
          reason={meeting.rescheduleReason}
          role={rescheduleRole(user.id, meeting) ?? 'viewer'}
        />
      )}

      {/* Proposal Actions – accept or suggest new time */}
      {isProposed && (
        <ProposalActions
          meetingId={meeting.id}
          meetingDate={meetingDate.toISOString()}
          durationMinutes={meeting.durationMinutes}
          proposedByName={proposedByName || 'Someone'}
          isReceiver={!!isProposalReceiver}
          isProposer={!!isProposalProposer}
          otherPartyName={otherPartyName || 'the other party'}
          workingDays={workingDays}
        />
      )}

      {/* Form CTA – first thing employee sees: fill before meeting, or edit until meeting time */}
      {showFillFormCta && (
        <div className="rounded-2xl bg-amber-500/10 border-2 border-amber-500/30 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <FileText className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="font-semibold text-dark-gray dark:text-white">Submit your form before the meeting</p>
                <p className="text-sm text-medium-gray mt-0.5">
                  {isPast
                    ? 'Please fill out the one-on-one form for this meeting. You can save a draft and finish later.'
                    : `Please fill and submit this form before your meeting on ${meetingDateLabel}. You can save a draft and finish later.`}
                </p>
              </div>
            </div>
            <Link
              href={`/meetings/${meeting.id}/form`}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-amber-500 text-white rounded-xl font-medium hover:bg-amber-600 transition-colors shadow-lg shadow-amber-500/20 flex-shrink-0"
            >
              <FileText className="w-5 h-5" />
              Fill &amp; Submit Form
            </Link>
          </div>
        </div>
      )}
      {showEditFormCta && (
        <div className="rounded-2xl bg-blue-500/10 border-2 border-blue-500/30 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="font-semibold text-dark-gray dark:text-white">Edit your form before the meeting</p>
                <p className="text-sm text-medium-gray mt-0.5">
                  You can update your responses until the meeting time. After the meeting, the form cannot be edited.
                </p>
              </div>
            </div>
            <Link
              href={`/meetings/${meeting.id}/form`}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition-colors shadow-lg shadow-blue-500/20 flex-shrink-0"
            >
              <FileText className="w-5 h-5" />
              Edit Form
            </Link>
          </div>
        </div>
      )}

      {/* Participants */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
              <User className="w-6 h-6 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-medium-gray">Employee</p>
              <p className="font-medium text-dark-gray dark:text-white">{meeting.employee.name}</p>
              <p className="text-sm text-medium-gray">{meeting.employee.email}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <User className="w-6 h-6 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-medium-gray">Reporter</p>
              <p className="font-medium text-dark-gray dark:text-white">{meeting.reporter.name}</p>
              <p className="text-sm text-medium-gray">{meeting.reporter.email}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recording Section - reporter/admin always; employee only when the policy allows (read-only) */}
      {canSeeRecording && meeting.status !== 'CANCELLED' && (isReporter || meeting.recording?.status === 'COMPLETED') && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-dark-gray dark:text-white flex items-center gap-2">
            <Mic className="w-5 h-5" />
            Meeting Recording
          </h2>
          {isReporter && meetingWithType.meetingType === 'ZOOM' && meetingWithType.meetingLink && (
            <p className="text-sm text-medium-gray">
              For Zoom calls, add the Fathom recorder to the meeting; the transcript will sync here automatically after the call ends.
            </p>
          )}
          {isReporter && (
            <MeetingRecorder
              meetingId={meeting.id}
              hasExistingRecording={!!meeting.recording}
              recordingStatus={meeting.recording?.status}
              errorMessage={meeting.recording?.errorMessage}
              meetingStatus={meeting.status}
              maxRecordingMins={settings?.maxRecordingMins ?? 25}
              hasAudio={!!meeting.recording?.audioKey?.endsWith('/final.webm')}
              hasTranscript={!!meeting.recording?.transcript?.trim()}
            />
          )}

          {/* Transcript Viewer */}
          {meeting.recording && meeting.recording.status === 'COMPLETED' && (
            <TranscriptViewer
              recording={{
                id: meeting.recording.id,
                meetingId: meeting.recording.meetingId,
                transcript: meeting.recording.transcript,
                language: meeting.recording.language,
                summary: meeting.recording.summary,
                keyPoints: meeting.recording.keyPoints as string[] | null,
                autoTodos: meeting.recording.autoTodos as Array<{ title: string; description: string; assignTo: string; priority: string }> | null,
                sentiment: meeting.recording.sentiment as { score: number; label: string; employeeMood: string; reporterEngagement: string; overallTone: string } | null,
                qualityScore: meeting.recording.qualityScore,
                qualityDetails: meeting.recording.qualityDetails as { clarity: number; actionability: number; engagement: number; goalAlignment: number; followUp: number; overallFeedback: string } | null,
                duration: meeting.recording.duration,
                audioPlaybackUrl: null, // Will be fetched client-side with signed URL
              }}
              employeeId={meeting.employeeId}
              reporterId={meeting.reporterId}
              canManage={isReporter}
            />
          )}
        </div>
      )}

      {/* Meeting Notes - reporter/admin always; employee only when the policy allows */}
      {canSeeNotes && (
        <MeetingNotes
          meetingId={meeting.id}
          initialNotes={meeting.notes}
          canEdit={isReporter}
        />
      )}

      {/* File Attachments */}
      <FileAttachments
        meetingId={meeting.id}
        initialAttachments={meeting.attachments.map(a => ({
          id: a.id,
          fileName: a.fileName,
          fileType: a.fileType,
          fileSize: a.fileSize,
          createdAt: a.createdAt.toISOString(),
        }))}
        canUpload={isReporter || isEmployee}
      />

      {/* Form Responses – visible to the employee always (including drafts),
           but only shown to reporters / super admins after official submission. */}
      {hasFormData && (isEmployee || formSubmitted) && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-dark-gray dark:text-white flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Form Responses
            {isEmployee && !formSubmitted && (
              <Pill tone="amber" className="ml-2">Draft</Pill>
            )}
          </h2>
          <div className="space-y-4">
            {formSections.map((section, index) => (
              <div
                key={index}
                className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6"
              >
                <h3 className="font-medium text-dark-gray dark:text-white mb-3">{section.title}</h3>
                <p className="text-medium-gray whitespace-pre-wrap">{section.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tasks Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-dark-gray dark:text-white flex items-center gap-2">
            <CheckSquare className="w-5 h-5" />
            Tasks from this Meeting
          </h2>
          {isReporter && (
            <AddTodoForm
              meetingId={meeting.id}
              employeeId={meeting.employeeId}
              employeeName={meeting.employee.name}
              reporterId={meeting.reporterId}
              reporterName={meeting.reporter.name}
            />
          )}
        </div>

        {meeting.todos.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-8 text-center">
            <CheckSquare className="w-12 h-12 text-light-gray mx-auto mb-3" />
            <p className="text-medium-gray">No tasks created for this meeting yet</p>
            {isReporter && (
              <p className="text-sm text-light-gray mt-1">Click Add Task to create action items</p>
            )}
          </div>
        ) : (
          <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
            <div className="divide-y divide-off-white dark:divide-medium-gray/20">
              {meeting.todos.map((todo) => (
                <div key={todo.id} className="p-4 sm:p-5 even:bg-off-white/40 dark:even:bg-charcoal/40">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      todo.status === 'DONE'
                        ? 'bg-green-500/10'
                        : todo.status === 'IN_PROGRESS'
                        ? 'bg-blue-500/10'
                        : 'bg-gray-500/10'
                    }`}>
                      {todo.status === 'DONE' ? (
                        <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
                      ) : (
                        <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium text-sm sm:text-base ${
                        todo.status === 'DONE'
                          ? 'text-medium-gray line-through'
                          : 'text-dark-gray dark:text-white'
                      }`}>
                        {todo.title}
                      </p>
                      {todo.description && (
                        <p className="text-xs sm:text-sm text-medium-gray mt-1">{todo.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-2 text-xs text-medium-gray">
                        <span>Assigned: {todo.assignedTo.name}</span>
                        {todo.dueDate && (
                          <span>Due: {formatDateOnly(todo.dueDate, 'short')}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        <TodoPriorityPill priority={todo.priority} />
                        <TodoStatusPill status={todo.status} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
