import { NextRequest, NextResponse } from 'next/server'
import { MeetingStatus, Prisma, TodoPriority, TodoStatus, UserRole } from '@prisma/client'
import { ADMIN, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { restoreSchema } from '@/lib/validation/admin'

export const dynamic = 'force-dynamic'

type Tx = Prisma.TransactionClient

/** Shapes as written by POST /api/admin/backup. Backup rows are untyped JSON, so everything is optional. */
interface BackupDepartment {
  id: string
  name: string
}
interface BackupUser {
  id: string
  email: string
  name?: string
  role?: unknown
  departmentId?: string | null
  reportsToId?: string | null
  phone?: string | null
  title?: string | null
  bio?: string | null
  isActive?: boolean
}
interface BackupTodo {
  id: string
  title: string
  description?: string | null
  status?: TodoStatus
  priority?: TodoPriority
  dueDate?: string | null
  assignedToId: string
  createdById: string
}
interface BackupMeeting {
  id: string
  employeeId: string
  reporterId: string
  meetingDate: string
  status?: MeetingStatus
  notes?: string | null
  checkInPersonal?: string | null
  checkInProfessional?: string | null
  priorityGoalProfessional?: string | null
  priorityGoalAgency?: string | null
  progressReport?: string | null
  goodNews?: string | null
  supportNeeded?: string | null
  priorityDiscussions?: string | null
  headsUp?: string | null
  anythingElse?: string | null
  todos?: BackupTodo[]
}

interface RestoreResults {
  departments: number
  users: number
  meetings: number
  todos: number
  errors: string[]
}

const VALID_ROLES = new Set<string>(Object.values(UserRole))

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Unknown error')

async function restoreDepartments(tx: Tx, rows: BackupDepartment[], results: RestoreResults) {
  for (const dept of rows) {
    try {
      await tx.department.upsert({
        where: { id: dept.id },
        update: { name: dept.name },
        create: { id: dept.id, name: dept.name },
      })
      results.departments++
    } catch (e) {
      results.errors.push(`Department ${dept.name}: ${errMsg(e)}`)
    }
  }
}

async function restoreUsers(tx: Tx, rows: BackupUser[], results: RestoreResults) {
  for (const u of rows) {
    // Role must be a real UserRole; anything else is downgraded to EMPLOYEE and reported.
    let role: UserRole = 'EMPLOYEE'
    if (typeof u.role === 'string' && VALID_ROLES.has(u.role)) {
      role = u.role as UserRole
    } else {
      results.errors.push(`User ${u.email}: invalid role "${String(u.role)}" replaced with EMPLOYEE`)
    }

    const fields = {
      name: u.name,
      role,
      departmentId: u.departmentId,
      reportsToId: u.reportsToId,
      phone: u.phone,
      title: u.title,
      bio: u.bio,
    }
    try {
      await tx.user.upsert({
        where: { id: u.id },
        update: { ...fields, isActive: u.isActive },
        create: { id: u.id, email: u.email, ...fields, isActive: u.isActive ?? true },
      })
      results.users++
    } catch (e) {
      results.errors.push(`User ${u.email}: ${errMsg(e)}`)
    }
  }
}

async function restoreTodos(tx: Tx, meetingId: string, rows: BackupTodo[], results: RestoreResults) {
  for (const todo of rows) {
    const fields = {
      title: todo.title,
      description: todo.description,
      status: todo.status,
      priority: todo.priority,
      dueDate: todo.dueDate ? new Date(todo.dueDate) : null,
    }
    try {
      await tx.todo.upsert({
        where: { id: todo.id },
        update: fields,
        create: { id: todo.id, meetingId, assignedToId: todo.assignedToId, createdById: todo.createdById, ...fields },
      })
      results.todos++
    } catch (e) {
      results.errors.push(`Todo ${todo.title}: ${errMsg(e)}`)
    }
  }
}

async function restoreMeetings(tx: Tx, rows: BackupMeeting[], results: RestoreResults) {
  for (const m of rows) {
    const fields = {
      meetingDate: new Date(m.meetingDate),
      status: m.status,
      notes: m.notes,
      checkInPersonal: m.checkInPersonal,
      checkInProfessional: m.checkInProfessional,
      priorityGoalProfessional: m.priorityGoalProfessional,
      priorityGoalAgency: m.priorityGoalAgency,
      progressReport: m.progressReport,
      goodNews: m.goodNews,
      supportNeeded: m.supportNeeded,
      priorityDiscussions: m.priorityDiscussions,
      headsUp: m.headsUp,
      anythingElse: m.anythingElse,
    }
    try {
      await tx.meeting.upsert({
        where: { id: m.id },
        update: fields,
        create: { id: m.id, employeeId: m.employeeId, reporterId: m.reporterId, ...fields },
      })
      results.meetings++
      if (Array.isArray(m.todos)) await restoreTodos(tx, m.id, m.todos, results)
    } catch (e) {
      results.errors.push(`Meeting ${m.id}: ${errMsg(e)}`)
    }
  }
}

/**
 * POST /api/admin/restore { data: <backup file>, options } (admin only)
 * Upserts departments, users, meetings and todos from a backup produced by POST /api/admin/backup.
 */
export const POST = withApiAuth(ADMIN, async (req: NextRequest, { user }) => {
  const { data, options } = await parseBody(req, restoreSchema)
  // zod applies these defaults at runtime; the fallbacks only narrow the type (parseBody infers the input type)
  const clearExisting = options.clearExisting
  const doUsers = options?.restoreUsers ?? true
  const doMeetings = options?.restoreMeetings ?? true

  const results: RestoreResults = { departments: 0, users: 0, meetings: 0, todos: 0, errors: [] }

  await prisma.$transaction(
    async (tx) => {
      if (clearExisting) {
        await tx.todo.deleteMany()
        await tx.meetingRecording.deleteMany()
        await tx.calendarEvent.deleteMany()
        await tx.meeting.deleteMany()
        await tx.notification.deleteMany()
        // Users and departments are kept; they are upserted below.
      }

      await restoreDepartments(tx, data.data.departments as unknown as BackupDepartment[], results)
      if (doUsers) await restoreUsers(tx, data.data.users as unknown as BackupUser[], results)
      if (doMeetings) await restoreMeetings(tx, data.data.meetings as unknown as BackupMeeting[], results)
    },
    { timeout: 120_000 }
  )

  await createAuditLog({
    userId: user.id,
    action: 'IMPORT',
    entityType: 'Restore',
    details: { ...results, errors: results.errors.slice(0, 10), options: { clearExisting, restoreUsers: doUsers, restoreMeetings: doMeetings } },
  })

  return NextResponse.json(results)
})
