'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Calendar,
  Clock,
  Circle,
  CheckCircle2,
  AlertTriangle,
  User,
  FileText,
  Trash2,
  LinkIcon,
} from 'lucide-react'
import { UserRole, TodoStatus, TodoPriority } from '@prisma/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-modal'
import { useFormat } from '@/components/providers/timezone-provider'
import { Pill, TodoPriorityPill, TodoStatusPill, TODO_PRIORITY_META, TODO_STATUS_META } from '@/components/ui/pill'
import { Select } from '@/components/ui/select'

interface Todo {
  id: string
  title: string
  description: string | null
  status: TodoStatus
  priority: TodoPriority
  dueDate: Date | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
  assignedTo: { id: string; name: string; email: string }
  createdBy: { id: string; name: string; email: string }
  meeting: {
    id: string
    meetingDate: Date
    employee: { name: string } | null
    reporter: { name: string } | null
  } | null
}

interface TodoDetailProps {
  todo: Todo
  currentUserId: string
  userRole: UserRole
}

/** Icon + text colour for the status field row (chip visuals come from TODO_STATUS_META). */
const statusIcons: Record<TodoStatus, { icon: typeof Circle; color: string }> = {
  NOT_STARTED: { icon: Circle, color: 'text-gray-500' },
  IN_PROGRESS: { icon: Clock, color: 'text-blue-500' },
  DONE: { icon: CheckCircle2, color: 'text-green-500' },
}

const priorityColor: Record<TodoPriority, string> = { HIGH: 'text-red-500', MEDIUM: 'text-orange', LOW: 'text-gray-500' }

export function TodoDetail({ todo, currentUserId, userRole }: TodoDetailProps) {
  const router = useRouter()
  const { toastError } = useToast()
  const confirm = useConfirm()
  const f = useFormat()
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(todo.status)

  const status = statusIcons[currentStatus]
  const now = new Date()
  const isOverdue = f.isTodoOverdue(todo.dueDate, currentStatus, now)
  const canEdit = todo.assignedTo.id === currentUserId || userRole === 'SUPER_ADMIN'
  const canDelete = todo.createdBy.id === currentUserId || userRole === 'SUPER_ADMIN'

  const updateStatus = async (newStatus: TodoStatus) => {
    setUpdating(true)
    try {
      const res = await fetch(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed to update')
      setCurrentStatus(newStatus)
      router.refresh()
    } catch {
      toastError('Failed to update task status.')
    } finally {
      setUpdating(false)
    }
  }

  const handleDelete = async () => {
    if (!await confirm('Are you sure you want to delete this task? This cannot be undone.', { variant: 'danger' })) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/todos/${todo.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      router.push('/todos')
      router.refresh()
    } catch {
      toastError('Failed to delete task.')
      setDeleting(false)
    }
  }

  return (
    <div className="w-full max-w-4xl mx-auto min-w-0 space-y-5">
      {/* Back Button */}
      <button
        type="button"
        onClick={() => router.back()}
        className="flex items-center gap-2 text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors text-sm font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Tasks
      </button>

      {/* Title Section */}
      <div>
        <h1 className={`text-xl sm:text-2xl font-bold ${currentStatus === 'DONE' ? 'text-medium-gray line-through' : 'text-dark-gray dark:text-white'}`}>
          {todo.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 mt-2.5">
          <TodoPriorityPill priority={todo.priority} />
          <TodoStatusPill status={currentStatus} />
          {isOverdue && (
            <Pill tone="red">
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              Overdue
            </Pill>
          )}
        </div>
      </div>

      {/* Fields Card */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden divide-y divide-off-white dark:divide-medium-gray/20">
        {/* Description */}
        {todo.description && (
          <FieldRow icon={FileText} label="Description">
            <p className="text-sm text-dark-gray dark:text-white/90 whitespace-pre-wrap leading-relaxed">
              {todo.description}
            </p>
          </FieldRow>
        )}

        {/* Status */}
        <FieldRow icon={status.icon} label="Status">
          {canEdit ? (
            <Select
              value={currentStatus}
              onChange={(e) => updateStatus(e.target.value as TodoStatus)}
              disabled={updating}
              aria-label="Task status"
              wrapperClassName="inline-block"
              className="pl-3 pr-8 py-1.5 text-sm font-medium rounded-lg cursor-pointer"
            >
              <option value="NOT_STARTED">Not Started</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="DONE">Done</option>
            </Select>
          ) : (
            <span className={`text-sm font-medium ${status.color}`}>{TODO_STATUS_META[currentStatus].label}</span>
          )}
        </FieldRow>

        {/* Priority */}
        <FieldRow icon={AlertTriangle} label="Priority">
          <span className={`text-sm font-medium ${priorityColor[todo.priority]}`}>{TODO_PRIORITY_META[todo.priority].label}</span>
        </FieldRow>

        {/* Assigned To */}
        <FieldRow icon={User} label="Assigned To">
          <p className="text-sm font-medium text-dark-gray dark:text-white">{todo.assignedTo.name}</p>
          <p className="text-xs text-medium-gray">{todo.assignedTo.email}</p>
        </FieldRow>

        {/* Created By */}
        <FieldRow icon={User} label="Created By">
          <p className="text-sm font-medium text-dark-gray dark:text-white">{todo.createdBy.name}</p>
          <p className="text-xs text-medium-gray">{todo.createdBy.email}</p>
        </FieldRow>

        {/* Due Date */}
        {todo.dueDate && (
          <FieldRow icon={Calendar} label="Due Date">
            <p className={`text-sm font-medium ${isOverdue ? 'text-red-600 dark:text-red-400' : 'text-dark-gray dark:text-white'}`}>
              {f.dateOnly(todo.dueDate, 'short')}
              {isOverdue && <span className="ml-2 text-xs font-normal text-red-500">(Overdue)</span>}
            </p>
          </FieldRow>
        )}

        {/* Completed At */}
        {todo.completedAt && (
          <FieldRow icon={CheckCircle2} label="Completed">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">{f.dateTime(todo.completedAt, 'short')}</p>
          </FieldRow>
        )}

        {/* Created At */}
        <FieldRow icon={Clock} label="Created">
          <p className="text-sm font-medium text-dark-gray dark:text-white">{f.dateTime(todo.createdAt, 'short')}</p>
        </FieldRow>

        {/* Linked Meeting */}
        {todo.meeting && (
          <FieldRow icon={LinkIcon} label="Linked Meeting">
            <Link
              href={`/meetings/${todo.meeting.id}`}
              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              {todo.meeting.employee?.name ?? 'Unknown'} &amp; {todo.meeting.reporter?.name ?? 'Unknown'} &middot;{' '}
              {f.monthDay(todo.meeting.meetingDate)}
            </Link>
          </FieldRow>
        )}
      </div>

      {/* Actions */}
      {canDelete && (
        <div>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            title="Permanently delete this task"
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-500/20 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            {deleting ? (
              <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Delete Task
          </button>
        </div>
      )}
    </div>
  )
}

function FieldRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 sm:gap-4 px-5 sm:px-6 py-3.5 sm:py-4">
      <div className="w-8 h-8 rounded-lg bg-off-white dark:bg-dark-gray flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-medium-gray" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-medium-gray mb-0.5">{label}</p>
        {children}
      </div>
    </div>
  )
}
