'use client'

import { useState, useMemo, useId } from 'react'
import { useRouter } from 'next/navigation'
import {
  Edit2, Trash2, UserPlus, ChevronUp, ChevronDown, Globe, Clock, AlertTriangle, Loader2, MoreHorizontal, Search, RefreshCw,
  Upload, Download, UserX, UserCheck, X,
} from 'lucide-react'
import { UserRole } from '@prisma/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-modal'
import { Avatar } from '@/components/ui/avatar'
import { Pill, type PillTone } from '@/components/ui/pill'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { Menu } from '@/components/ui/menu'
import { Pagination } from '@/components/ui/pagination'
import { BulkImport } from '@/components/admin/bulk-import'
import { KekaSync } from '@/components/admin/keka-sync'
import { useFormat } from '@/components/providers/timezone-provider'
import { plural } from '@/lib/ui'
import { cn } from '@/lib/utils'
import { COUNTRY_OPTIONS, TIMEZONE_OPTIONS, getDefaultTimeZoneForCountry, getDefaultWorkHoursForCountry, DEFAULT_WORK_START, DEFAULT_WORK_END } from '@/lib/timezones'

type SortKey = 'name' | 'role' | 'department' | 'reportsTo'
type SortDir = 'asc' | 'desc'
type StatusFilter = 'active' | 'inactive' | 'all'

interface User {
  id: string
  name: string
  email: string
  role: UserRole
  isActive: boolean
  departmentId: string | null
  reportsToId: string | null
  country: string | null
  timeZone: string | null
  workDayStart: string | null
  workDayEnd: string | null
  kekaEmployeeId?: string | null
  kekaSyncedAt?: Date | string | null
  department: { name: string } | null
  reportsTo: { name: string } | null
}

interface Department {
  id: string
  name: string
}

const ROLE_META: Record<UserRole, { label: string; tone: PillTone }> = {
  SUPER_ADMIN: { label: 'Super Admin', tone: 'orange' },
  REPORTER: { label: 'Reporter', tone: 'green' },
  EMPLOYEE: { label: 'Employee', tone: 'blue' },
}

const RolePill = ({ role }: { role: UserRole }) => {
  const meta = ROLE_META[role] ?? { label: String(role).replace('_', ' '), tone: 'neutral' as PillTone }
  return <Pill tone={meta.tone}>{meta.label}</Pill>
}

const FIELD = 'w-full rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal px-4 py-3 text-dark-gray dark:text-white focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20 disabled:opacity-60 disabled:cursor-not-allowed'
const LABEL = 'block text-sm font-medium text-dark-gray dark:text-white mb-1'
const BTN_SECONDARY =
  'inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-sm font-medium text-dark-gray dark:text-white hover:bg-off-white dark:hover:bg-dark-gray transition-colors'
const ICON_BTN = 'inline-flex items-center justify-center w-10 h-10 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white hover:bg-off-white dark:hover:bg-dark-gray transition-colors'

const PAGE_SIZE = 25
const STATUS_LABEL: Record<StatusFilter, string> = { active: 'Active', inactive: 'Inactive', all: 'All' }

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'role', label: 'Role' },
  { key: 'department', label: 'Department' },
  { key: 'reportsTo', label: 'Reports to' },
]

interface UserManagementProps {
  users: User[]
  departments: Department[]
  reporters: User[]
  currentUserId: string
  /** e.g. "@whitelabeliq.com" — new users must use it */
  emailDomain: string
  /** Keka configured on the server: synced users' HR fields are read-only */
  kekaConfigured?: boolean
  kekaLastSyncAt?: string | null
}

export function UserManagement({ users, departments, reporters, currentUserId, emailDomain, kekaConfigured = false, kekaLastSyncAt = null }: UserManagementProps) {
  const router = useRouter()
  const f = useFormat()
  const { toastError, toastSuccess } = useToast()
  const confirm = useConfirm()
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'' | UserRole>('')
  const [deptFilter, setDeptFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [offset, setOffset] = useState(0)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  // Name, email, department, manager, country and Keka ID of Keka-synced users are owned by Keka
  const locked = !!editingUser && kekaConfigured && !!editingUser.kekaSyncedAt
  const [isLoading, setIsLoading] = useState(false)
  const [emailError, setEmailError] = useState('')
  const ALLOWED_EMAIL_DOMAIN = emailDomain
  const formId = useId()
  const fid = (name: string) => `${formId}-${name}`
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'EMPLOYEE' as UserRole,
    departmentId: '',
    reportsToId: '',
    isActive: true,
    country: '',
    timeZone: '',
    workDayStart: DEFAULT_WORK_START,
    workDayEnd: DEFAULT_WORK_END,
    kekaEmployeeId: '',
  })

  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      role: 'EMPLOYEE',
      departmentId: '',
      reportsToId: '',
      isActive: true,
      country: '',
      timeZone: '',
      workDayStart: DEFAULT_WORK_START,
      workDayEnd: DEFAULT_WORK_END,
      kekaEmployeeId: '',
    })
  }

  const openAddModal = () => {
    resetForm()
    setEditingUser(null)
    setIsAddOpen(true)
  }

  const openEditModal = (user: User) => {
    setFormData({
      name: user.name,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId || '',
      reportsToId: user.reportsToId || '',
      isActive: user.isActive,
      country: user.country || '',
      timeZone: user.timeZone || '',
      workDayStart: user.workDayStart || DEFAULT_WORK_START,
      workDayEnd: user.workDayEnd || DEFAULT_WORK_END,
      kekaEmployeeId: user.kekaEmployeeId || '',
    })
    setEditingUser(user)
    setIsAddOpen(true)
  }

  const [deletingUser, setDeletingUser] = useState<User | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const closeModal = () => {
    setIsAddOpen(false)
    setEditingUser(null)
    resetForm()
    setEmailError('')
  }

  const handleDelete = async () => {
    if (!deletingUser) return
    setIsDeleting(true)

    try {
      const response = await fetch(`/api/users/${deletingUser.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete user')
      }
      setDeletingUser(null)
      router.refresh()
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Failed to delete user')
    } finally {
      setIsDeleting(false)
    }
  }

  const setActive = async (user: User, isActive: boolean) => {
    if (!isActive) {
      // Deactivating cancels their upcoming meetings and recurring schedules — say how many first
      let detail = ''
      try {
        const res = await fetch(`/api/users/${user.id}/offboarding`)
        if (res.ok) {
          const { meetings, schedules } = (await res.json()) as { meetings: number; schedules: number }
          const parts = [meetings ? plural(meetings, 'upcoming meeting') : '', schedules ? plural(schedules, 'recurring schedule') : ''].filter(Boolean)
          if (parts.length) detail = ` ${parts.join(' and ')} will be cancelled and the other person notified.`
        }
      } catch {
        // count is informational; the confirm still shows
      }
      const ok = await confirm(`${user.name} won't be able to sign in.${detail} Past meetings and recordings are kept.`, {
        title: `Deactivate ${user.name}?`,
        confirmText: 'Deactivate',
        variant: 'danger',
      })
      if (!ok) return
    }
    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update user')
      }
      toastSuccess(`${user.name} ${isActive ? 'reactivated' : 'deactivated'}`)
      router.refresh()
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Failed to update user')
    }
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const counts = useMemo(() => {
    const active = users.filter((u) => u.isActive)
    return {
      active: active.length,
      inactive: users.length - active.length,
      managers: active.filter((u) => u.role === 'REPORTER').length,
      admins: active.filter((u) => u.role === 'SUPER_ADMIN').length,
    }
  }, [users])

  const visibleUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = users.filter(
      (u) =>
        (statusFilter === 'all' || u.isActive === (statusFilter === 'active')) &&
        (!roleFilter || u.role === roleFilter) &&
        (!deptFilter || (deptFilter === 'none' ? !u.departmentId : u.departmentId === deptFilter)) &&
        (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    )
    const key = (u: User): string => {
      switch (sortKey) {
        case 'role':
          return u.role
        case 'department':
          return (u.department?.name ?? '').toLowerCase()
        case 'reportsTo':
          return (u.reportsTo?.name ?? '').toLowerCase()
        default:
          return u.name.toLowerCase()
      }
    }
    list.sort((a, b) => {
      const av = key(a)
      const bv = key(b)
      if (av !== bv) return (av < bv ? -1 : 1) * (sortDir === 'asc' ? 1 : -1)
      return a.name.localeCompare(b.name)
    })
    return list
  }, [users, query, roleFilter, deptFilter, statusFilter, sortKey, sortDir])

  const filtered = query.trim() !== '' || roleFilter !== '' || deptFilter !== '' || statusFilter !== 'active'
  const clearFilters = () => {
    setQuery('')
    setRoleFilter('')
    setDeptFilter('')
    setStatusFilter('active')
    setOffset(0)
  }
  // Filter changes reset to page 1 (set together with the filter, not in an effect)
  const onFilter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setOffset(0)
  }
  const page = visibleUsers.slice(offset, offset + PAGE_SIZE)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!locked && !formData.email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)) {
      setEmailError(`Only ${ALLOWED_EMAIL_DOMAIN} email addresses are allowed`)
      return
    }
    setEmailError('')
    setIsLoading(true)

    try {
      const url = editingUser ? `/api/users/${editingUser.id}` : '/api/users'
      const method = editingUser ? 'PATCH' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          locked
            ? {
                role: formData.role,
                isActive: formData.isActive,
                timeZone: formData.timeZone || null,
                workDayStart: formData.workDayStart || null,
                workDayEnd: formData.workDayEnd || null,
              }
            : {
                ...formData,
                departmentId: formData.departmentId || null,
                reportsToId: formData.reportsToId || null,
                country: formData.country || null,
                timeZone: formData.timeZone || null,
                workDayStart: formData.workDayStart || null,
                workDayEnd: formData.workDayEnd || null,
                kekaEmployeeId: formData.kekaEmployeeId?.trim() || null,
              }
        ),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save user')
      }

      closeModal()
      router.refresh()
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Failed to save user')
    } finally {
      setIsLoading(false)
    }
  }

  // Render helpers, not components: an inline component remounts on every render and drops keyboard focus
  const sortButton = (col: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => handleSort(col)}
      aria-label={`Sort by ${label}`}
      className="inline-flex items-center gap-1 hover:text-dark-gray dark:hover:text-white transition-colors"
    >
      {label}
      {sortKey === col && (sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />)}
    </button>
  )

  const ariaSort = (col: SortKey) => (sortKey === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined)

  const rowMenu = (user: User) => (
    <Menu
      label={`Actions for ${user.name}`}
      triggerClassName="inline-flex items-center justify-center w-9 h-9 rounded-lg text-medium-gray hover:text-dark-gray dark:hover:text-white hover:bg-off-white dark:hover:bg-dark-gray transition-colors"
      trigger={<MoreHorizontal className="w-4 h-4" aria-hidden="true" />}
      items={[
        { label: 'Edit', icon: Edit2, onSelect: () => openEditModal(user) },
        user.isActive
          ? { label: 'Deactivate', icon: UserX, onSelect: () => setActive(user, false), disabled: user.id === currentUserId }
          : { label: 'Reactivate', icon: UserCheck, onSelect: () => setActive(user, true) },
        { label: 'Delete', icon: Trash2, onSelect: () => setDeletingUser(user), danger: true, disabled: user.id === currentUserId },
      ]}
    />
  )

  const nameCell = (user: User) => (
    <div className="flex items-center gap-3 min-w-0">
      <Avatar name={user.name} size="sm" alt="" className="bg-transparent dark:bg-transparent bg-gradient-to-br from-orange/20 to-orange/10 text-orange dark:text-orange font-medium shrink-0" />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-dark-gray dark:text-white truncate">{user.name}</span>
          {!user.isActive && <Pill tone="red">Inactive</Pill>}
        </div>
        <div className="text-xs text-medium-gray truncate">{user.email}</div>
      </div>
    </div>
  )

  const summary = [
    `${counts.active} active`,
    plural(counts.managers, 'reporter'),
    plural(counts.admins, 'admin'),
    plural(departments.length, 'department'),
  ].join(' · ')

  return (
    <div className="space-y-6">
      {/* Header: title + the page's only actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white">User Management</h1>
          <p className="mt-1 text-sm text-medium-gray">
            {summary}
            {kekaConfigured && (
              <>
                {' · '}
                {kekaLastSyncAt ? `Synced from Keka ${f.dateTime(kekaLastSyncAt, 'short')}` : 'Not synced from Keka yet'}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {kekaConfigured && (
            <KekaSync
              trigger={(open) => (
                <button type="button" onClick={open} className={BTN_SECONDARY}>
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                  Sync from Keka
                </button>
              )}
            />
          )}
          <BulkImport
            trigger={(openImport) => (
              <Menu
                label="More user actions"
                triggerClassName={ICON_BTN}
                trigger={<MoreHorizontal className="w-4 h-4" aria-hidden="true" />}
                items={[
                  { label: 'Import from CSV', icon: Upload, onSelect: openImport },
                  { label: 'Export users (CSV)', icon: Download, href: '/api/admin/import-users?format=export', download: true },
                ]}
              />
            )}
          />
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-2 h-10 px-4 bg-orange text-white rounded-xl text-sm font-medium hover:bg-orange/90 transition-colors"
          >
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            Add user
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-medium-gray pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => onFilter(setQuery)(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search users"
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-sm text-dark-gray dark:text-white placeholder:text-medium-gray focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center">
          <Select aria-label="Filter by role" value={roleFilter} onChange={(e) => onFilter(setRoleFilter)(e.target.value as '' | UserRole)} wrapperClassName="sm:w-40">
            <option value="">All roles</option>
            <option value="EMPLOYEE">Employee</option>
            <option value="REPORTER">Reporter</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </Select>
          <Select aria-label="Filter by department" value={deptFilter} onChange={(e) => onFilter(setDeptFilter)(e.target.value)} wrapperClassName="sm:w-48">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
            <option value="none">No department</option>
          </Select>
          <div role="tablist" aria-label="Status" className="col-span-2 inline-flex h-10 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal p-1">
            {(['active', 'inactive', 'all'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={statusFilter === s}
                onClick={() => onFilter(setStatusFilter)(s)}
                className={cn(
                  'flex-1 sm:flex-none px-3 rounded-lg text-sm font-medium transition-colors',
                  statusFilter === s ? 'bg-dark-gray text-white dark:bg-white dark:text-dark-gray' : 'text-medium-gray hover:text-dark-gray dark:hover:text-white'
                )}
              >
                {STATUS_LABEL[s]}
                {s === 'inactive' && counts.inactive > 0 && <span className="ml-1 opacity-70">{counts.inactive}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Users */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        {visibleUsers.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-dark-gray dark:text-white font-medium">No users match</p>
            {filtered && (
              <button type="button" onClick={clearFilters} className="mt-2 inline-flex items-center gap-1 text-sm text-blue-500 hover:underline">
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b border-off-white dark:border-medium-gray/20 text-xs uppercase tracking-wide">
                    <th scope="col" aria-sort={ariaSort('name')} className="w-[38%] text-left py-3 px-5 font-medium text-medium-gray">
                      {sortButton('name', 'Name')}
                    </th>
                    {SORT_COLUMNS.map((c) => (
                      <th key={c.key} scope="col" aria-sort={ariaSort(c.key)} className="text-left py-3 px-4 font-medium text-medium-gray">
                        {sortButton(c.key, c.label)}
                      </th>
                    ))}
                    <th scope="col" className="w-14 py-3 px-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-off-white dark:divide-medium-gray/10">
                  {page.map((user) => (
                    <tr
                      key={user.id}
                      onClick={() => openEditModal(user)}
                      className={cn('cursor-pointer hover:bg-off-white/60 dark:hover:bg-dark-gray/40 transition-colors', !user.isActive && 'opacity-70')}
                    >
                      <td className="py-3 px-5">{nameCell(user)}</td>
                      <td className="py-3 px-4"><RolePill role={user.role} /></td>
                      <td className="py-3 px-4 text-sm text-medium-gray truncate">{user.department?.name || '—'}</td>
                      <td className="py-3 px-4 text-sm text-medium-gray truncate">{user.reportsTo?.name || '—'}</td>
                      <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>{rowMenu(user)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <ul className="md:hidden divide-y divide-off-white dark:divide-medium-gray/20">
              {page.map((user) => (
                <li key={user.id} className="flex items-start gap-2 p-4">
                  <button type="button" onClick={() => openEditModal(user)} className="flex-1 min-w-0 text-left space-y-2" aria-label={`Edit ${user.name}`}>
                    {nameCell(user)}
                    <div className="flex flex-wrap items-center gap-2 pl-11 text-xs text-medium-gray">
                      <RolePill role={user.role} />
                      <span>{user.department?.name || 'No department'}</span>
                      {user.reportsTo && <span>· {user.reportsTo.name}</span>}
                    </div>
                  </button>
                  {rowMenu(user)}
                </li>
              ))}
            </ul>

            <Pagination
              offset={offset}
              limit={PAGE_SIZE}
              total={visibleUsers.length}
              onChange={setOffset}
              noun="users"
              className="px-5 py-3 border-t border-off-white dark:border-medium-gray/20"
            />
          </>
        )}
      </div>

      {/* Add / Edit Modal */}
      <Modal
        open={isAddOpen}
        onClose={closeModal}
        title={editingUser ? 'Edit User' : 'Add New User'}
        busy={isLoading}
        footer={
          <>
            <button
              type="button"
              onClick={closeModal}
              disabled={isLoading}
              className="px-5 py-2.5 text-sm font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form={formId}
              disabled={isLoading}
              className="px-5 py-2.5 text-sm font-medium bg-orange text-white rounded-xl hover:bg-orange/90 disabled:opacity-50 transition-colors"
            >
              {isLoading ? 'Saving...' : editingUser ? 'Save Changes' : 'Add User'}
            </button>
          </>
        }
      >
        <form id={formId} onSubmit={handleSubmit} className="space-y-4">
          {locked && (
            <p className="rounded-xl bg-blue-500/10 px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
              Synced from Keka: name, email, department, manager, country and Keka ID are updated from Keka every day. Role, status,
              time zone and working hours can be changed here.
            </p>
          )}
          <div>
            <label htmlFor={fid('name')} className={LABEL}>Full Name *</label>
            <input
              id={fid('name')}
              type="text"
              value={formData.name}
              disabled={locked}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="John Doe"
              className={FIELD}
              required
            />
          </div>

          <div>
            <label htmlFor={fid('email')} className={LABEL}>Email *</label>
            <input
              id={fid('email')}
              type="email"
              value={formData.email}
              disabled={locked}
              onChange={(e) => {
                setFormData({ ...formData, email: e.target.value })
                if (emailError) setEmailError('')
              }}
              placeholder={`john${ALLOWED_EMAIL_DOMAIN}`}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={fid('email-hint')}
              className={`${FIELD} ${emailError ? 'border-red-500' : ''}`}
              required
            />
            {emailError ? (
              <p id={fid('email-hint')} className="text-xs text-red-500 mt-1">{emailError}</p>
            ) : (
              <p id={fid('email-hint')} className="text-xs text-medium-gray mt-1">Only {ALLOWED_EMAIL_DOMAIN} emails are allowed</p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor={fid('role')} className={LABEL}>Role</label>
              <Select
                id={fid('role')}
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                className={FIELD}
              >
                <option value="EMPLOYEE">Employee</option>
                <option value="REPORTER">Reporter / Team Lead</option>
                <option value="SUPER_ADMIN">Super Admin</option>
              </Select>
            </div>

            <div>
              <label htmlFor={fid('department')} className={LABEL}>Department</label>
              <Select
                id={fid('department')}
                value={formData.departmentId}
              disabled={locked}
                onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                className={FIELD}
              >
                <option value="">No Department</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <label htmlFor={fid('reportsTo')} className={LABEL}>Reports To</label>
            <Select
              id={fid('reportsTo')}
              value={formData.reportsToId}
              disabled={locked}
              onChange={(e) => setFormData({ ...formData, reportsToId: e.target.value })}
              className={FIELD}
            >
              <option value="">No Manager</option>
              {reporters.filter(r => r.id !== editingUser?.id).map((reporter) => (
                <option key={reporter.id} value={reporter.id}>
                  {reporter.name} ({reporter.role.replace('_', ' ')})
                </option>
              ))}
            </Select>
          </div>

          <fieldset className="border-t border-off-white dark:border-medium-gray/20 pt-4">
            <legend className="sr-only">Location &amp; Working Hours</legend>
            <p className="text-sm font-medium text-dark-gray dark:text-white mb-3 flex items-center gap-2" aria-hidden="true">
              <Globe className="w-4 h-4 text-medium-gray" />
              Location &amp; Working Hours
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor={fid('country')} className={LABEL}>Country</label>
                <Select
                  id={fid('country')}
                  value={formData.country}
              disabled={locked}
                  onChange={(e) => {
                    const country = e.target.value
                    const next = { ...formData, country }
                    if (!formData.timeZone || formData.timeZone === getDefaultTimeZoneForCountry(formData.country || null)) {
                      next.timeZone = getDefaultTimeZoneForCountry(country || null)
                    }
                    const prevDef = getDefaultWorkHoursForCountry(formData.country || null)
                    if (formData.workDayStart === prevDef.start && formData.workDayEnd === prevDef.end) {
                      const def = getDefaultWorkHoursForCountry(country || null)
                      next.workDayStart = def.start
                      next.workDayEnd = def.end
                    }
                    setFormData(next)
                  }}
                  className={FIELD}
                >
                  <option value="">Select country</option>
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor={fid('timeZone')} className={LABEL}>Time Zone</label>
                <Select
                  id={fid('timeZone')}
                  value={formData.timeZone}
                  onChange={(e) => setFormData({ ...formData, timeZone: e.target.value })}
                  className={FIELD}
                >
                  <option value="">Select time zone</option>
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor={fid('workDayStart')} className={`${LABEL} flex items-center gap-1`}>
                  <Clock className="w-3.5 h-3.5 text-medium-gray" aria-hidden="true" />
                  Work Start (local)
                </label>
                <input
                  id={fid('workDayStart')}
                  type="time"
                  value={formData.workDayStart}
                  onChange={(e) => setFormData({ ...formData, workDayStart: e.target.value })}
                  className={FIELD}
                />
              </div>
              <div>
                <label htmlFor={fid('workDayEnd')} className={`${LABEL} flex items-center gap-1`}>
                  <Clock className="w-3.5 h-3.5 text-medium-gray" aria-hidden="true" />
                  Work End (local)
                </label>
                <input
                  id={fid('workDayEnd')}
                  type="time"
                  value={formData.workDayEnd}
                  onChange={(e) => setFormData({ ...formData, workDayEnd: e.target.value })}
                  className={FIELD}
                />
              </div>
            </div>
          </fieldset>

          {editingUser && (
            <div>
              <label htmlFor={fid('keka')} className={LABEL}>Keka Employee ID (optional)</label>
              <input
                id={fid('keka')}
                type="text"
                value={formData.kekaEmployeeId}
              disabled={locked}
                onChange={(e) => setFormData({ ...formData, kekaEmployeeId: e.target.value })}
                placeholder="UUID from Keka for leave integration"
                aria-describedby={fid('keka-hint')}
                className={`${FIELD} placeholder:text-medium-gray`}
              />
              <p id={fid('keka-hint')} className="mt-1 text-xs text-medium-gray">Used to check leave in Keka when finding available meeting slots.</p>
            </div>
          )}

          {editingUser && (
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id={fid('isActive')}
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="w-4 h-4 rounded border-off-white text-orange focus:ring-orange"
              />
              <label htmlFor={fid('isActive')} className="text-sm text-dark-gray dark:text-white">
                Active user
                {editingUser.isActive && !formData.isActive && (
                  <span className="block text-xs text-amber-600 dark:text-amber-400">Saving will cancel their upcoming meetings and recurring schedules.</span>
                )}
              </label>
            </div>
          )}
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deletingUser}
        onClose={() => setDeletingUser(null)}
        title="Delete User"
        description="This action cannot be undone"
        size="sm"
        busy={isDeleting}
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeletingUser(null)}
              disabled={isDeleting}
              className="px-5 py-2.5 text-sm font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-red-500 text-white rounded-xl hover:bg-red-600 disabled:opacity-50 transition-colors"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  Delete User
                </>
              )}
            </button>
          </>
        }
      >
        {deletingUser && (
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-500" aria-hidden="true" />
            </div>
            <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 flex-1">
              <p className="text-sm text-dark-gray dark:text-white mb-2">
                Are you sure you want to permanently delete <strong>{deletingUser.name}</strong> ({deletingUser.email})?
              </p>
              <p className="text-xs text-medium-gray">
                All associated data including meetings, recordings, to-dos, recurring schedules, and notifications will be permanently removed.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
