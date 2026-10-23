import { NextRequest, NextResponse } from 'next/server'
import { forbidden, notFound, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import { logTodoUpdated, logTodoDeleted } from '@/lib/audit'
import { updateTodoSchema } from '@/lib/validation/todos'

export const dynamic = 'force-dynamic'

type TodoRef = { assignedToId: string; createdById: string }
const isAdmin = (role: UserRole) => role === UserRole.SUPER_ADMIN
const canView = (user: { id: string; role: UserRole }, t: TodoRef) =>
  isAdmin(user.role) || t.assignedToId === user.id || t.createdById === user.id
const canDelete = (user: { id: string; role: UserRole }, t: TodoRef) => isAdmin(user.role) || t.createdById === user.id

export const GET = withApiAuth(async (_req: NextRequest, { user, params }) => {
  const todo = await prisma.todo.findUnique({
    where: { id: params.id },
    include: {
      assignedTo: { select: { id: true, name: true, email: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      meeting: { select: { id: true, meetingDate: true, employee: { select: { name: true } }, reporter: { select: { name: true } } } },
    },
  })
  if (!todo) throw notFound('Todo')
  if (!canView(user, todo)) throw forbidden()
  return NextResponse.json(todo)
})

/** Assignee, creator or admin. Only the creator/admin may change title/description. */
export const PATCH = withApiAuth(async (req: NextRequest, { user, params }) => {
  const body = await parseBody(req, updateTodoSchema)

  const todo = await prisma.todo.findUnique({ where: { id: params.id } })
  if (!todo) throw notFound('Todo')
  if (!canView(user, todo)) throw forbidden()
  if ((body.title !== undefined || body.description !== undefined) && !canDelete(user, todo)) {
    throw forbidden('Only the task creator can edit its title or description')
  }

  const data: Record<string, string | Date | null> = {}
  if (body.title !== undefined) data.title = body.title
  if (body.description !== undefined) data.description = body.description
  if (body.priority !== undefined) data.priority = body.priority
  if (body.dueDate !== undefined) data.dueDate = body.dueDate
  if (body.status !== undefined) {
    data.status = body.status
    if (body.status === 'DONE' && todo.status !== 'DONE') data.completedAt = new Date()
    if (body.status !== 'DONE' && todo.status === 'DONE') data.completedAt = null
  }

  const updatedTodo = await prisma.todo.update({
    where: { id: params.id },
    data,
    include: {
      assignedTo: { select: { name: true, email: true } },
      createdBy: { select: { name: true } },
      meeting: { select: { id: true, meetingDate: true } },
    },
  })

  await logTodoUpdated(user.id, params.id, { title: todo.title, changes: data })
  return NextResponse.json(updatedTodo)
})

export const DELETE = withApiAuth(async (_req: NextRequest, { user, params }) => {
  const todo = await prisma.todo.findUnique({ where: { id: params.id } })
  if (!todo) throw notFound('Todo')
  if (!canDelete(user, todo)) throw forbidden('Only the task creator or an admin can delete it')

  await prisma.todo.delete({ where: { id: params.id } })
  await logTodoDeleted(user.id, params.id, { title: todo.title })
  return NextResponse.json({ success: true })
})
