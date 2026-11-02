/**
 * Admin → Backup & Restore: a JSON copy of the app's data, e.g. to load production data into a
 * local database. Not a disaster-recovery backup (use database snapshots for that): audio files in
 * S3, sessions, OAuth tokens, notifications and audit logs are never included.
 *
 * Restore matches by natural keys so it works on a database that already has data:
 * departments by name, users by email (case-insensitive); meetings, todos and schedules by id.
 * Every reference (manager, department, meeting parties, todo owners) is remapped to the local
 * row. It runs in ONE transaction: either everything is restored or nothing changes. Rows that
 * can't be restored (e.g. a meeting whose employee is missing from the file) are skipped and
 * listed as warnings — they never abort the run.
 */
import { randomUUID } from 'crypto'
import { FormRevisionKind, MeetingStatus, MeetingType, Prisma, RecordingStatus, RecurringFrequency, TodoPriority, TodoStatus, UserRole } from '@prisma/client'
import { prisma } from './prisma'

export const BACKUP_VERSION = '1.1'

// ── Export ──────────────────────────────────────────────────────────

const userExportSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  departmentId: true,
  reportsToId: true,
  phone: true,
  title: true,
  bio: true,
  isActive: true,
  country: true,
  timeZone: true,
  workDayStart: true,
  workDayEnd: true,
  kekaEmployeeId: true,
  employeeNumber: true,
  joiningDate: true,
  createdAt: true,
} as const

export async function exportBackup() {
  const [departments, users, recurringSchedules, meetings, todos, formRevisions] = await Promise.all([
    prisma.department.findMany(),
    prisma.user.findMany({ select: userExportSelect }),
    prisma.recurringSchedule.findMany({
      select: {
        id: true, reporterId: true, employeeId: true, frequency: true, dayOfWeek: true, timeOfDay: true, durationMinutes: true,
        meetingType: true, meetingLink: true, isActive: true, nextMeetingDate: true, lastGeneratedAt: true, createdAt: true,
      },
    }),
    prisma.meeting.findMany({
      include: {
        recording: {
          select: {
            transcript: true,
            speakerTurns: true,
            language: true,
            duration: true,
            summary: true,
            keyPoints: true,
            autoTodos: true,
            sentiment: true,
            qualityScore: true,
            qualityDetails: true,
            status: true,
            recordedAt: true,
            processedAt: true,
          },
        },
      },
    }),
    prisma.todo.findMany(),
    prisma.meetingFormRevision.findMany(),
  ])
  return {
    exportedAt: new Date().toISOString(),
    version: BACKUP_VERSION,
    data: { departments, users, recurringSchedules, meetings, todos, formRevisions },
  }
}

// ── Restore ─────────────────────────────────────────────────────────

type Row = Record<string, unknown>

export interface RestoreOptions {
  /** Delete meetings, todos, recordings, schedules and notifications first (users/departments are always merged) */
  clearExisting: boolean
  restoreUsers: boolean
  restoreMeetings: boolean
}

export interface RestoreResult {
  departments: { created: number; updated: number }
  users: { created: number; updated: number }
  recurringSchedules: number
  meetings: number
  recordings: number
  todos: number
  formRevisions: number
  warnings: string[]
}

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)
const date = (v: unknown) => (typeof v === 'string' || v instanceof Date ? new Date(v as string) : null)
const oneOf = <T extends string>(v: unknown, values: Record<string, T>, fallback: T): T =>
  typeof v === 'string' && (Object.values(values) as string[]).includes(v) ? (v as T) : fallback
const json = (v: unknown) => (v === undefined || v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue))
const MAX_WARNINGS = 50

/** v1.0 files keep todos inside meetings; v1.1 has a top-level list (incl. todos without a meeting). */
function collectTodos(data: { todos?: Row[]; meetings?: Row[] }): Row[] {
  if (Array.isArray(data.todos)) return data.todos
  return (data.meetings ?? []).flatMap((m) => (Array.isArray(m.todos) ? (m.todos as Row[]) : []))
}

export async function restoreBackup(
  data: { departments?: Row[]; users?: Row[]; recurringSchedules?: Row[]; meetings?: Row[]; todos?: Row[]; formRevisions?: Row[] },
  options: RestoreOptions,
  actorId: string
): Promise<RestoreResult> {
  const result: RestoreResult = {
    departments: { created: 0, updated: 0 },
    users: { created: 0, updated: 0 },
    recurringSchedules: 0,
    meetings: 0,
    recordings: 0,
    todos: 0,
    formRevisions: 0,
    warnings: [],
  }
  const warn = (msg: string) => {
    if (result.warnings.length < MAX_WARNINGS) result.warnings.push(msg)
    else if (result.warnings.length === MAX_WARNINGS) result.warnings.push('More rows were skipped (list truncated).')
  }

  await prisma.$transaction(
    async (tx) => {
      if (options.clearExisting) {
        await tx.todo.deleteMany()
        await tx.meeting.deleteMany() // cascades recordings, jobs, calendar events, form history
        await tx.recurringSchedule.deleteMany()
        await tx.notification.deleteMany()
      }

      // Departments: by name
      const deptMap = new Map<string, string>() // backup id → local id
      const localDepts = new Map((await tx.department.findMany({ select: { id: true, name: true } })).map((d) => [d.name.toLowerCase(), d.id]))
      for (const d of data.departments ?? []) {
        const name = str(d.name)
        const id = str(d.id)
        if (!name || !id) continue
        const local = localDepts.get(name.toLowerCase())
        if (local) {
          deptMap.set(id, local)
          result.departments.updated++
        } else {
          const taken = await tx.department.findUnique({ where: { id }, select: { id: true } })
          const created = await tx.department.create({ data: { id: taken ? randomUUID() : id, name } })
          deptMap.set(id, created.id)
          localDepts.set(name.toLowerCase(), created.id)
          result.departments.created++
        }
      }

      // Users: by email; managers linked in a second pass (a manager can come later in the file)
      const userMap = new Map<string, string>()
      const localUsers = await tx.user.findMany({ select: { id: true, email: true, kekaEmployeeId: true } })
      const byEmail = new Map(localUsers.map((u) => [u.email.toLowerCase(), u]))
      const kekaIds = new Map(localUsers.filter((u) => u.kekaEmployeeId).map((u) => [u.kekaEmployeeId!, u.id]))
      for (const u of data.users ?? []) {
        const email = str(u.email)?.toLowerCase()
        const id = str(u.id)
        if (!email || !id) continue
        const local = byEmail.get(email)
        if (!options.restoreUsers) {
          if (local) userMap.set(id, local.id)
          continue
        }
        const kekaId = str(u.kekaEmployeeId)
        const kekaFree = kekaId && (!kekaIds.has(kekaId) || kekaIds.get(kekaId) === local?.id)
        const fields = {
          name: str(u.name) ?? '',
          role: oneOf(u.role, UserRole, UserRole.EMPLOYEE),
          departmentId: str(u.departmentId) ? (deptMap.get(str(u.departmentId)!) ?? null) : null,
          phone: str(u.phone),
          title: str(u.title),
          bio: str(u.bio),
          isActive: u.isActive !== false,
          ...(u.country !== undefined && { country: str(u.country) }),
          ...(u.timeZone !== undefined && { timeZone: str(u.timeZone) }),
          ...(u.workDayStart !== undefined && { workDayStart: str(u.workDayStart) }),
          ...(u.workDayEnd !== undefined && { workDayEnd: str(u.workDayEnd) }),
          ...(u.employeeNumber !== undefined && { employeeNumber: str(u.employeeNumber) }),
          ...(u.joiningDate !== undefined && { joiningDate: date(u.joiningDate) }),
          ...(kekaFree && { kekaEmployeeId: kekaId }),
        }
        if (local) {
          // Never lock yourself out: the admin running the restore stays active and an admin
          const self = local.id === actorId ? { isActive: true, role: UserRole.SUPER_ADMIN } : {}
          await tx.user.update({ where: { id: local.id }, data: { ...fields, ...self } })
          userMap.set(id, local.id)
          result.users.updated++
        } else {
          const taken = await tx.user.findUnique({ where: { id }, select: { id: true } })
          const created = await tx.user.create({ data: { id: taken ? randomUUID() : id, email, ...fields } })
          userMap.set(id, created.id)
          result.users.created++
        }
        if (kekaFree) kekaIds.set(kekaId!, userMap.get(id)!)
      }
      if (options.restoreUsers) {
        for (const u of data.users ?? []) {
          const id = str(u.id)
          const local = id ? userMap.get(id) : undefined
          if (!local || u.reportsToId === undefined) continue
          const manager = str(u.reportsToId) ? userMap.get(str(u.reportsToId)!) : null
          if (str(u.reportsToId) && !manager) warn(`${str(u.email)}: manager not in the file — left unchanged`)
          else await tx.user.update({ where: { id: local }, data: { reportsToId: manager === local ? null : manager } })
        }
      }
      const person = (v: unknown) => (str(v) ? userMap.get(str(v)!) : undefined)

      if (!options.restoreMeetings) return

      // Recurring schedules (v1.1); Google series ids are never copied — calendars differ per environment
      const scheduleMap = new Map<string, string>()
      for (const s of data.recurringSchedules ?? []) {
        const id = str(s.id)
        const reporterId = person(s.reporterId)
        const employeeId = person(s.employeeId)
        if (!id) continue
        if (!reporterId || !employeeId) {
          warn(`Recurring schedule ${id}: a participant is not in the file — skipped`)
          continue
        }
        const fields = {
          reporterId,
          employeeId,
          frequency: oneOf(s.frequency, RecurringFrequency, RecurringFrequency.BIWEEKLY),
          dayOfWeek: Number(s.dayOfWeek) || 0,
          timeOfDay: str(s.timeOfDay) ?? '10:00',
          durationMinutes: Number(s.durationMinutes) || 30,
          meetingType: oneOf(s.meetingType, MeetingType, MeetingType.IN_PERSON),
          meetingLink: str(s.meetingLink),
          isActive: s.isActive !== false,
          nextMeetingDate: date(s.nextMeetingDate),
          lastGeneratedAt: date(s.lastGeneratedAt),
        }
        await tx.recurringSchedule.upsert({ where: { id }, update: fields, create: { id, ...fields } })
        scheduleMap.set(id, id)
        result.recurringSchedules++
      }

      // Meetings (+ recording analysis)
      const meetingIds = new Set<string>()
      for (const m of data.meetings ?? []) {
        const id = str(m.id)
        const employeeId = person(m.employeeId)
        const reporterId = person(m.reporterId)
        if (!id) continue
        if (!employeeId || !reporterId) {
          warn(`Meeting ${id}: employee or manager is not in the file — skipped`)
          continue
        }
        const fields = {
          employeeId,
          reporterId,
          proposedById: person(m.proposedById) ?? null,
          recurringScheduleId: str(m.recurringScheduleId) ? (scheduleMap.get(str(m.recurringScheduleId)!) ?? null) : null,
          meetingDate: date(m.meetingDate) ?? new Date(),
          durationMinutes: Number(m.durationMinutes) || 30,
          status: oneOf(m.status, MeetingStatus, MeetingStatus.SCHEDULED),
          meetingType: oneOf(m.meetingType, MeetingType, MeetingType.IN_PERSON),
          meetingLink: str(m.meetingLink),
          zoomMeetingId: str(m.zoomMeetingId),
          notes: str(m.notes),
          checkInPersonal: str(m.checkInPersonal),
          checkInProfessional: str(m.checkInProfessional),
          priorityGoalProfessional: str(m.priorityGoalProfessional),
          priorityGoalAgency: str(m.priorityGoalAgency),
          progressReport: str(m.progressReport),
          goodNews: str(m.goodNews),
          supportNeeded: str(m.supportNeeded),
          priorityDiscussions: str(m.priorityDiscussions),
          headsUp: str(m.headsUp),
          anythingElse: str(m.anythingElse),
          formSubmittedAt: date(m.formSubmittedAt),
          rescheduleDate: date(m.rescheduleDate),
          rescheduleDuration: m.rescheduleDuration == null ? null : Number(m.rescheduleDuration),
          rescheduleRequestedById: person(m.rescheduleRequestedById) ?? null,
          rescheduleRequestedAt: date(m.rescheduleRequestedAt),
          rescheduleReason: str(m.rescheduleReason),
          // Reminders for a copied meeting must never go out from the restored environment
          reminder24hSent: true,
          reminderSent: true,
          formReminderSent: true,
        }
        await tx.meeting.upsert({ where: { id }, update: fields, create: { id, ...fields } })
        meetingIds.add(id)
        result.meetings++

        const r = m.recording as Row | null | undefined
        if (r && typeof r === 'object') {
          const rec = {
            transcript: str(r.transcript),
            speakerTurns: json(r.speakerTurns),
            language: str(r.language),
            duration: r.duration == null ? null : Number(r.duration),
            summary: str(r.summary),
            keyPoints: json(r.keyPoints),
            autoTodos: json(r.autoTodos),
            sentiment: json(r.sentiment),
            qualityScore: r.qualityScore == null ? null : Number(r.qualityScore),
            qualityDetails: json(r.qualityDetails),
            status: oneOf(r.status, RecordingStatus, RecordingStatus.COMPLETED),
            recordedAt: date(r.recordedAt),
            processedAt: date(r.processedAt),
            // the audio lives in the other environment's S3 bucket — not copied
            audioKey: null,
            audioUrl: null,
          }
          await tx.meetingRecording.upsert({ where: { meetingId: id }, update: rec, create: { meetingId: id, ...rec } })
          result.recordings++
        }
      }

      // Todos
      for (const t of collectTodos(data)) {
        const id = str(t.id)
        const assignedToId = person(t.assignedToId)
        const createdById = person(t.createdById)
        if (!id) continue
        if (!assignedToId || !createdById) {
          warn(`To-do "${str(t.title) ?? id}": assignee or creator is not in the file — skipped`)
          continue
        }
        const meetingId = str(t.meetingId)
        const fields = {
          title: str(t.title) ?? 'Untitled',
          description: str(t.description),
          status: oneOf(t.status, TodoStatus, TodoStatus.NOT_STARTED),
          priority: oneOf(t.priority, TodoPriority, TodoPriority.MEDIUM),
          dueDate: date(t.dueDate),
          completedAt: date(t.completedAt),
          assignedToId,
          createdById,
          meetingId: meetingId && meetingIds.has(meetingId) ? meetingId : null,
        }
        await tx.todo.upsert({ where: { id }, update: fields, create: { id, ...fields } })
        result.todos++
      }

      // Form answer history (v1.1)
      const revisions = (data.formRevisions ?? []).flatMap((f) => {
        const id = str(f.id)
        const meetingId = str(f.meetingId)
        if (!id || !meetingId || !meetingIds.has(meetingId)) return []
        return [
          {
            id,
            meetingId,
            editedById: person(f.editedById) ?? null,
            kind: oneOf(f.kind, FormRevisionKind, FormRevisionKind.EDITED),
            changes: (f.changes ?? []) as Prisma.InputJsonValue,
            createdAt: date(f.createdAt) ?? new Date(),
          },
        ]
      })
      if (revisions.length) result.formRevisions = (await tx.meetingFormRevision.createMany({ data: revisions, skipDuplicates: true })).count
    },
    { timeout: 300_000, maxWait: 20_000 }
  )

  return result
}
