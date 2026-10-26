'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckSquare, AlertTriangle, Circle, CheckCircle2, Clock, Calendar, ChevronRight } from 'lucide-react'
import { UserRole, TodoStatus, TodoPriority } from '@prisma/client'
import { useToast } from '@/components/ui/toast'
import { useFormat } from '@/components/providers/timezone-provider'
import { TodoPriorityPill, TODO_STATUS_META } from '@/components/ui/pill'
import { Select } from '@/components/ui/select'
import { Pagination } from '@/components/ui/pagination'

interface Todo {
  id: string
  title: string
  description: string | null
  status: TodoStatus
  priority: TodoPriority
  dueDate: Date | null
  assignedTo: { name: string; email: string }
  createdBy: { name: string; email: string }
  meeting: { id: string; meetingDate: Date } | null
}

interface TodoListProps {
  todos: Todo[]
  currentUserId: string
  userRole: UserRole
}

/** Icon + colours for the status toggle button (chip visuals come from TODO_STATUS_META). */
const statusIcons: Record<TodoStatus, { icon: typeof Circle; color: string; bg: string }> = {
  NOT_STARTED: { icon: Circle, color: 'text-gray-500', bg: 'bg-gray-500/10' },
  IN_PROGRESS: { icon: Clock, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  DONE: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10' },
}

export function TodoList({ todos, currentUserId, userRole }: TodoListProps) {
  const router = useRouter()
  const { toastError } = useToast()
  const f = useFormat()
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')
  const [updating, setUpdating] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const ITEMS_PER_PAGE = 15

  const filteredTodos = todos.filter((todo) => {
    if (filter === 'active') return todo.status !== 'DONE'
    if (filter === 'completed') return todo.status === 'DONE'
    return true
  })

  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const paginatedTodos = filteredTodos.slice(startIndex, endIndex)

  const updateStatus = async (todoId: string, newStatus: TodoStatus) => {
    setUpdating(todoId)
    try {
      const response = await fetch(`/api/todos/${todoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })

      if (!response.ok) throw new Error('Failed to update')
      router.refresh()
    } catch (error) {
      toastError('Failed to update task. Please try again.')
    } finally {
      setUpdating(null)
    }
  }

  const now = new Date()

  if (todos.length === 0) {
    return (
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-12 text-center">
        <CheckSquare className="w-16 h-16 text-light-gray mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-dark-gray dark:text-white mb-2">No tasks yet</h3>
        <p className="text-medium-gray max-w-md mx-auto">
          Tasks will appear here when they are assigned during one-on-one meetings.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex gap-2" role="tablist" aria-label="Task filter">
        {(['all', 'active', 'completed'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={filter === tab}
            onClick={() => { setFilter(tab); setCurrentPage(1) }}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none ${
              filter === tab
                ? 'bg-dark-gray dark:bg-white text-white dark:text-dark-gray'
                : 'text-medium-gray hover:bg-off-white dark:hover:bg-dark-gray'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Todo Items */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        <div className="divide-y divide-off-white dark:divide-medium-gray/20">
          {filteredTodos.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-medium-gray">No {filter} tasks</p>
            </div>
          ) : (
            paginatedTodos.map((todo) => {
              const status = statusIcons[todo.status]
              const isOverdue = f.isTodoOverdue(todo.dueDate, todo.status, now)
              const StatusIcon = status.icon

              const nextStatus: TodoStatus =
                todo.status === 'NOT_STARTED' ? 'IN_PROGRESS' :
                todo.status === 'IN_PROGRESS' ? 'DONE' : 'NOT_STARTED'
              const nextStatusLabel = TODO_STATUS_META[nextStatus].label

              return (
                <div
                  key={todo.id}
                  className={`relative transition-colors even:bg-off-white/40 dark:even:bg-charcoal/40 hover:bg-off-white/70 dark:hover:bg-dark-gray/30 ${isOverdue ? 'bg-red-50/50 dark:bg-red-500/5' : ''}`}
                >
                  <div className="flex items-center gap-3 sm:gap-4 p-4 sm:p-5">
                    {/* Status Toggle — interactive, kept outside the link */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        updateStatus(todo.id, nextStatus)
                      }}
                      type="button"
                      disabled={updating === todo.id}
                      title={`Mark as ${nextStatusLabel}`}
                      aria-label={`Mark "${todo.title}" as ${nextStatusLabel}`}
                      className={`relative z-10 w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${status.bg} flex items-center justify-center flex-shrink-0 transition-all hover:scale-105 disabled:opacity-50`}
                    >
                      {updating === todo.id ? (
                        <div className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-current border-t-transparent rounded-full animate-spin text-medium-gray" />
                      ) : (
                        <StatusIcon className={`w-4 h-4 sm:w-5 sm:h-5 ${status.color}`} />
                      )}
                    </button>

                    {/* Content — clickable link to detail page */}
                    <Link href={`/todos/${todo.id}`} className="flex-1 min-w-0 cursor-pointer">
                      <div className="min-w-0">
                        <h3 className={`font-medium text-sm sm:text-base ${
                          todo.status === 'DONE' 
                            ? 'text-medium-gray line-through' 
                            : 'text-dark-gray dark:text-white'
                        }`}>
                          {todo.title}
                        </h3>
                        {todo.description && (
                          <p className="text-xs sm:text-sm text-medium-gray mt-1 line-clamp-2">
                            {todo.description}
                          </p>
                        )}
                      </div>

                      {/* Meta Info */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:gap-4 mt-2 sm:mt-3 text-xs text-medium-gray">
                        <span className="flex items-center gap-1">
                          <span className="font-medium">Assigned to:</span> {todo.assignedTo.name}
                        </span>
                        {todo.dueDate && (
                          <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
                            <Calendar className="w-3 h-3" />
                            {isOverdue && <AlertTriangle className="w-3 h-3" />}
                            {f.dateOnly(todo.dueDate, 'weekday')}
                          </span>
                        )}
                      </div>
                    </Link>

                    {/* Priority Badge — center-aligned with status */}
                    <TodoPriorityPill priority={todo.priority} className="flex-shrink-0" />

                    {/* Status Dropdown (desktop) — interactive, kept outside the link */}
                    <div className="relative z-10 hidden sm:block flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={todo.status}
                        onChange={(e) => updateStatus(todo.id, e.target.value as TodoStatus)}
                        disabled={updating === todo.id}
                        aria-label={`Status of "${todo.title}"`}
                        className="pl-3 pr-8 py-2 text-xs font-medium rounded-lg cursor-pointer"
                      >
                        <option value="NOT_STARTED">Not Started</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="DONE">Done</option>
                      </Select>
                    </div>

                    {/* Chevron indicator — clickable link to detail */}
                    <Link href={`/todos/${todo.id}`} title="View task details" aria-label={`View details for "${todo.title}"`} className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 hover:bg-off-white dark:hover:bg-charcoal transition-colors">
                      <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-light-gray" />
                    </Link>
                  </div>
                </div>
              )
            })
          )}
        </div>
        <Pagination
          offset={startIndex}
          limit={ITEMS_PER_PAGE}
          total={filteredTodos.length}
          onChange={(offset) => setCurrentPage(Math.floor(offset / ITEMS_PER_PAGE) + 1)}
          noun="tasks"
          className="px-4 py-3 border-t border-off-white dark:border-medium-gray/20"
        />
      </div>
    </div>
  )
}
