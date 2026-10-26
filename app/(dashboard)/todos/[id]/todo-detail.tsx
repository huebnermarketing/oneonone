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
  ChevronDown,
  Trash2,
  LinkIcon,
} from 'lucide-react'
import { UserRole, TodoStatus, TodoPriority } from '@prisma/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-modal'
import { useFormat } from '@/components/providers/timezone-provider'

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

const statusConfig = {
  NOT_STARTED: { label: 'Not Started', icon: Circle, color: 'text-gray-500', bg: 'bg-gray-500/10', border: 'border-gray-300 dark:border-gray-600' },
  IN_PROGRESS: { label: 'In Progress', icon: Clock, color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-300 dark:border-blue-600' },
  DONE: { label: 'Done', icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-300 dark:border-green-600' },
}

const priorityConfig = {
  HIGH: { label: 'High', color: 'text-red-500', bg: 'bg-red-500/10' },
  MEDIUM: { label: 'Medium', color: 'text-orange', bg: 'bg-orange/10' },
  LOW: { label: 'Low', color: 'text-gray-500', bg: 'bg-gray-500/10' },
}

export function TodoDetail({ todo, currentUserId, userRole }: TodoDetailProps) {
  const router = useRouter()
  const { toastError } = useToast()
  const confirm = useConfirm()
  const f = useFormat()
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(todo.status)

  const status = statusConfig[currentStatus]
  const priority = priorityConfig[todo.priority]
  const StatusIcon = status.icon
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
          <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${priority.bg} ${priority.color}`}>
            {priority.label} Priority
          </span>
          <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${status.bg} ${status.color}`}>
            {status.label}
          </span>
          {isOverdue && (
            <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-red-500/10 text-red-500 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Overdue
            </span>
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
        <FieldRow icon={statusConfig[currentStatus].icon} label="Status">
          {canEdit ? (
            <div className="relative inline-block">
              <select
                value={currentStatus}
                onChange={(e) => updateStatus(e.target.value as TodoStatus)}
                disabled={updating}
                className="appearance-none pl-3 pr-8 py-1.5 text-sm font-medium rounded-lg border border-off-white dark:border-medium-gray/20 bg-off-white/50 dark:bg-dark-gray text-dark-gray dark:text-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange/20 disabled:opacity-50 transition-colors"
              >
                <option value="NOT_STARTED">Not Started</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="DONE">Done</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-medium-gray pointer-events-none" />
            </div>
          ) : (
            <span className={`text-sm font-medium ${status.color}`}>{status.label}</span>
          )}
        </FieldRow>

        {/* Priority */}
        <FieldRow icon={AlertTriangle} label="Priority">
          <span className={`text-sm font-medium ${priority.color}`}>{priority.label}</span>
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
