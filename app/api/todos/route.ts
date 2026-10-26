import { NextRequest, NextResponse } from 'next/server'
import { forbidden, notFound, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { logTodoCreated } from '@/lib/audit'
import { getTeamUserIds, canActOnUser } from '@/lib/team'
import { canViewMeeting } from '@/lib/meeting-access'
import * as notify from '@/lib/notify'
import { createTodoSchema } from '@/lib/validation/todos'

export const dynamic = 'force-dynamic'

const todoInclude = {
  createdBy: { select: { name: true } },
  assignedTo: { select: { name: true, email: true } },
  meeting: { select: { id: true, meetingDate: true } },
} as const

/**
 * GET /api/todos
 * EMPLOYEE: todos assigned to or created by me.
 * REPORTER: todos assigned to or created by me or my direct reports.
 * SUPER_ADMIN: everything.
 */
export const GET = withApiAuth(async (_req: NextRequest, { user }) => {
  const teamIds = await getTeamUserIds(user)
  const todos = await prisma.todo.findMany({
    where: teamIds ? { OR: [{ assignedToId: { in: teamIds } }, { createdById: { in: teamIds } }] } : undefined,
    include: todoInclude,
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { priority: 'desc' }],
  })
  return NextResponse.json(todos)
})

/**
 * POST /api/todos
 * Assignee must be yourself, a direct report, or your own manager. A linked meeting must be one you can view.
 */
export const POST = withApiAuth(async (req: NextRequest, { user }) => {
  const body = await parseBody(req, createTodoSchema)

  if (!(await canActOnUser(user, body.assignedToId))) {
    throw forbidden('You can only assign tasks to yourself, your direct reports, or your manager')
  }

  if (body.meetingId) {
    const meeting = await prisma.meeting.findUnique({
      where: { id: body.meetingId },
      select: { id: true, employeeId: true, reporterId: true },
    })
    if (!meeting) throw notFound('Meeting')
    if (!canViewMeeting(user, meeting)) throw forbidden('You cannot attach tasks to a meeting you are not part of')
  }

  const todo = await prisma.todo.create({
    data: {
      title: body.title,
      description: body.description ?? null,
      assignedToId: body.assignedToId,
      createdById: user.id,
      meetingId: body.meetingId ?? null,
      dueDate: body.dueDate ?? null,
      priority: body.priority,
      status: 'NOT_STARTED',
    },
    include: { ...todoInclude, createdBy: { select: { name: true, email: true } } },
  })

  await logTodoCreated(user.id, todo.id, {
    title: todo.title,
    assignedTo: todo.assignedTo?.name,
    priority: todo.priority,
  })

  if (todo.assignedToId !== user.id && todo.assignedTo?.email) {
    await notify.todoAssigned({ todo, assignee: { ...todo.assignedTo, id: todo.assignedToId }, creatorName: todo.createdBy.name })
  }

  return NextResponse.json(todo, { status: 201 })
})
