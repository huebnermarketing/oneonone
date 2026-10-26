import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { TodoDetail } from './todo-detail'

export default async function TodoDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const user = await getCurrentUser()
  if (!user) return null

  const todo = await prisma.todo.findUnique({
    where: { id: params.id },
    include: {
      assignedTo: { select: { id: true, name: true, email: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      meeting: {
        select: {
          id: true,
          meetingDate: true,
          employee: { select: { name: true } },
          reporter: { select: { name: true } },
        },
      },
    },
  })

  if (!todo) notFound()

  if (
    todo.assignedToId !== user.id &&
    todo.createdById !== user.id &&
    user.role !== 'SUPER_ADMIN'
  ) {
    notFound()
  }

  return (
    <TodoDetail
      todo={todo}
      currentUserId={user.id}
      userRole={user.role}
    />
  )
}
