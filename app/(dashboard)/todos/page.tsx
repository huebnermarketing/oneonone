import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import { isTodoOverdue } from '@/lib/dates'
import { DEFAULT_TIMEZONE } from '@/lib/constants'
import { TodoList } from './todo-list'
import { CheckSquare, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react'

export default async function TodosPage() {
  const user = await getCurrentUser()
  if (!user) return null

  const todos = await prisma.todo.findMany({
    where: {
      OR: [
        { assignedToId: user.id },
        user.role !== UserRole.EMPLOYEE
          ? { createdById: user.id }
          : {},
      ],
    },
    include: {
      assignedTo: { select: { name: true, email: true } },
      createdBy: { select: { name: true, email: true } },
      meeting: { select: { id: true, meetingDate: true } },
    },
    orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
  })

  const now = new Date()
  const notStarted = todos.filter(t => t.status === 'NOT_STARTED')
  const inProgress = todos.filter(t => t.status === 'IN_PROGRESS')
  const done = todos.filter(t => t.status === 'DONE')
  const tz = user.timeZone ?? DEFAULT_TIMEZONE
  const overdue = todos.filter(t => isTodoOverdue(t.dueDate, now, t.status, tz))

  return (
    <div className="space-y-5 sm:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white mb-1">To-Dos</h1>
        <p className="text-sm sm:text-base text-medium-gray">Track your tasks and action items</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-3 sm:p-5">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gray-500/10 flex items-center justify-center flex-shrink-0">
              <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold text-dark-gray dark:text-white">{notStarted.length}</p>
              <p className="text-xs sm:text-sm text-medium-gray truncate">Not Started</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-3 sm:p-5">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold text-dark-gray dark:text-white">{inProgress.length}</p>
              <p className="text-xs sm:text-sm text-medium-gray truncate">In Progress</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-3 sm:p-5">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold text-dark-gray dark:text-white">{done.length}</p>
              <p className="text-xs sm:text-sm text-medium-gray truncate">Completed</p>
            </div>
          </div>
        </div>
        {overdue.length > 0 && (
          <div className="rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 sm:p-5">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-red-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xl sm:text-2xl font-bold text-red-600 dark:text-red-400">{overdue.length}</p>
                <p className="text-xs sm:text-sm text-red-600/70 dark:text-red-400/70 truncate">Overdue</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Todo List */}
      <TodoList todos={todos} currentUserId={user.id} userRole={user.role} />
    </div>
  )
}
