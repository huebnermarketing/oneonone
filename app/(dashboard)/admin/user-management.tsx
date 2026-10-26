'use client'

import { useState, useMemo, useId } from 'react'
import { useRouter } from 'next/navigation'
import { Edit2, Trash2, UserPlus, Users, Building2, ChevronUp, ChevronDown, Globe, Clock, AlertTriangle, Loader2 } from 'lucide-react'
import { UserRole } from '@prisma/client'
import { useToast } from '@/components/ui/toast'
import { Avatar } from '@/components/ui/avatar'
import { Pill, type PillTone } from '@/components/ui/pill'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { StatCard } from '@/components/ui/stat-card'
import { COUNTRY_OPTIONS, TIMEZONE_OPTIONS, getDefaultTimeZoneForCountry, getDefaultWorkHoursForCountry, DEFAULT_WORK_START, DEFAULT_WORK_END } from '@/lib/timezones'

type SortKey = 'name' | 'role' | 'department' | 'reportsTo' | 'status'
type SortDir = 'asc' | 'desc'

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

const ActivePill = ({ active }: { active: boolean }) => <Pill tone={active ? 'green' : 'red'}>{active ? 'Active' : 'Inactive'}</Pill>

const FIELD = 'w-full rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal px-4 py-3 text-dark-gray dark:text-white focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20'
const LABEL = 'block text-sm font-medium text-dark-gray dark:text-white mb-1'

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'role', label: 'Role' },
  { key: 'department', label: 'Department' },
  { key: 'reportsTo', label: 'Reports To' },
  { key: 'status', label: 'Status' },
]

interface UserManagementProps {
  users: User[]
  departments: Department[]
  reporters: User[]
}

export function UserManagement({ users, departments, reporters }: UserManagementProps) {
  const router = useRouter()
  const { toastError } = useToast()
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [emailError, setEmailError] = useState('')
  const ALLOWED_EMAIL_DOMAIN = '@whitelabeliq.com'
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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedUsers = useMemo(() => {
    const list = [...users]
    list.sort((a, b) => {
      let aVal: string | number, bVal: string | number
      switch (sortKey) {
        case 'name':
          aVal = a.name.toLowerCase()
          bVal = b.name.toLowerCase()
          break
        case 'role':
          aVal = a.role
          bVal = b.role
          break
        case 'department':
          aVal = (a.department?.name ?? '').toLowerCase()
          bVal = (b.department?.name ?? '').toLowerCase()
          break
        case 'reportsTo':
          aVal = (a.reportsTo?.name ?? '').toLowerCase()
          bVal = (b.reportsTo?.name ?? '').toLowerCase()
          break
        case 'status':
          aVal = a.isActive ? 'active' : 'inactive'
          bVal = b.isActive ? 'active' : 'inactive'
          break
        default:
          return 0
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return list
  }, [users, sortKey, sortDir])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)) {
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
        body: JSON.stringify({
          ...formData,
          departmentId: formData.departmentId || null,
          reportsToId: formData.reportsToId || null,
          country: formData.country || null,
          timeZone: formData.timeZone || null,
          workDayStart: formData.workDayStart || null,
          workDayEnd: formData.workDayEnd || null,
          kekaEmployeeId: formData.kekaEmployeeId?.trim() || null,
        }),
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
      className="flex items-center gap-1 hover:text-dark-gray dark:hover:text-white transition-colors"
    >
      {label}
      {sortKey === col && (sortDir === 'asc' ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />)}
    </button>
  )

  const ariaSort = (col: SortKey) => (sortKey === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined)

  const rowActions = (user: User, large?: boolean) => (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => openEditModal(user)}
        aria-label={`Edit ${user.name}`}
        className={`p-2 ${large ? 'min-w-[44px] min-h-[44px] ' : ''}flex items-center justify-center hover:bg-off-white dark:hover:bg-charcoal rounded-lg transition-colors`}
      >
        <Edit2 className="w-4 h-4 text-medium-gray" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setDeletingUser(user)}
        aria-label={`Delete ${user.name}`}
        className={`p-2 ${large ? 'min-w-[44px] min-h-[44px] ' : ''}flex items-center justify-center hover:bg-red-500/10 rounded-lg transition-colors`}
      >
        <Trash2 className="w-4 h-4 text-medium-gray hover:text-red-500" aria-hidden="true" />
      </button>
    </div>
  )

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-dark-gray dark:text-white mb-2">
            User Management
          </h1>
          <p className="text-medium-gray">Manage employees, roles, and reporting structure</p>
        </div>
        <button
          type="button"
          onClick={openAddModal}
          className="flex items-center gap-2 px-5 py-3 bg-orange text-white rounded-xl font-medium hover:bg-orange/90 transition-all shadow-lg shadow-orange/25"
        >
          <UserPlus className="w-5 h-5" aria-hidden="true" />
          Add User
        </button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <StatCard label="Total Users" value={users.length} icon={Users} accent="blue" />
        <StatCard label="Active" value={users.filter((u) => u.isActive).length} icon={Users} accent="green" />
        <StatCard label="Departments" value={departments.length} icon={Building2} accent="neutral" />
      </div>

      {/* Users Table */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20">
          <h2 className="font-semibold text-dark-gray dark:text-white">All Users</h2>
        </div>
        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-off-white dark:border-medium-gray/20 bg-off-white/50 dark:bg-charcoal/50">
                <th scope="col" aria-sort={ariaSort('name')} className="text-left py-3 px-6 text-sm font-medium text-medium-gray">
                  {sortButton('name', 'Name')}
                </th>
                <th scope="col" className="text-left py-3 px-6 text-sm font-medium text-medium-gray">Email</th>
                {SORT_COLUMNS.map((c) => (
                  <th key={c.key} scope="col" aria-sort={ariaSort(c.key)} className="text-left py-3 px-6 text-sm font-medium text-medium-gray">
                    {sortButton(c.key, c.label)}
                  </th>
                ))}
                <th scope="col" className="text-left py-3 px-6 text-sm font-medium text-medium-gray">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-off-white/50 dark:border-medium-gray/10 even:bg-off-white/40 dark:even:bg-charcoal/40 hover:bg-off-white/70 dark:hover:bg-charcoal/60 transition-colors"
                >
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <Avatar name={user.name} size="sm" alt="" className="bg-transparent dark:bg-transparent bg-gradient-to-br from-orange/20 to-orange/10 text-orange dark:text-orange font-medium" />
                      <span className="font-medium text-dark-gray dark:text-white">{user.name}</span>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm text-medium-gray">{user.email}</td>
                  <td className="py-4 px-6"><RolePill role={user.role} /></td>
                  <td className="py-4 px-6 text-sm text-medium-gray">
                    {user.department?.name || '-'}
                  </td>
                  <td className="py-4 px-6 text-sm text-medium-gray">
                    {user.reportsTo?.name || '-'}
                  </td>
                  <td className="py-4 px-6"><ActivePill active={user.isActive} /></td>
                  <td className="py-4 px-6">{rowActions(user, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden divide-y divide-off-white dark:divide-medium-gray/20">
          {sortedUsers.map((user) => (
            <div key={user.id} className="p-4 space-y-2 even:bg-off-white/40 dark:even:bg-charcoal/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar name={user.name} size="sm" alt="" className="bg-transparent dark:bg-transparent bg-gradient-to-br from-orange/20 to-orange/10 text-orange dark:text-orange font-medium" />
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-dark-gray dark:text-white">{user.name}</span>
                    <RolePill role={user.role} />
                  </div>
                </div>
                {rowActions(user)}
              </div>
              <p className="text-sm text-medium-gray">{user.email}</p>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-medium-gray">{user.department?.name || 'No department'}</span>
                <ActivePill active={user.isActive} />
              </div>
            </div>
          ))}
        </div>
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
          <div>
            <label htmlFor={fid('name')} className={LABEL}>Full Name *</label>
            <input
              id={fid('name')}
              type="text"
              value={formData.name}
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
    </>
  )
}
