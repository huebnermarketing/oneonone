'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  Shield, 
  User, 
  Settings, 
  Trash2, 
  Download, 
  Upload, 
  LogIn, 
  LogOut,
  Edit,
  Plus,
  Loader2,
  ChevronLeft,
  ChevronRight,
  RefreshCw
} from 'lucide-react'
import { AuditAction } from '@prisma/client'
import { DatePicker } from '@/components/ui/date-picker'
import { useFormat } from '@/components/providers/timezone-provider'

interface AuditLog {
  id: string
  userId: string
  user: {
    id: string
    name: string
    email: string
    avatar: string | null
  }
  action: AuditAction
  entityType: string
  entityId: string | null
  details: Record<string, string | number | boolean | null> | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

const actionIcons: Record<AuditAction, typeof Plus> = {
  CREATE: Plus,
  UPDATE: Edit,
  DELETE: Trash2,
  LOGIN: LogIn,
  LOGOUT: LogOut,
  EXPORT: Download,
  IMPORT: Upload,
  CLEAR_DATA: Trash2,
  SETTINGS_CHANGE: Settings,
}

const actionColors: Record<AuditAction, string> = {
  CREATE: 'text-green-500 bg-green-500/10',
  UPDATE: 'text-blue-500 bg-blue-500/10',
  DELETE: 'text-red-500 bg-red-500/10',
  LOGIN: 'text-blue-500 bg-blue-500/10',
  LOGOUT: 'text-gray-500 bg-gray-500/10',
  EXPORT: 'text-amber-500 bg-amber-500/10',
  IMPORT: 'text-teal-500 bg-teal-500/10',
  CLEAR_DATA: 'text-red-500 bg-red-500/10',
  SETTINGS_CHANGE: 'text-indigo-500 bg-indigo-500/10',
}

export function AuditLogsClient() {
  const f = useFormat()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState({
    action: '',
    entityType: '',
    startDate: '',
    endDate: '',
  })
  const limit = 20

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('limit', String(limit))
      params.append('offset', String(page * limit))
      if (filters.action) params.append('action', filters.action)
      if (filters.entityType) params.append('entityType', filters.entityType)
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)

      const response = await fetch(`/api/admin/audit-logs?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setLogs(data.logs)
        setTotal(data.total)
      }
    } catch (error) {
      // Error handled by toast
    } finally {
      setLoading(false)
    }
  }, [page, filters, limit])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-dark-gray dark:text-white mb-2">Audit Logs</h1>
          <p className="text-medium-gray">Track all admin actions and system changes</p>
        </div>
        <button
          onClick={fetchLogs}
          className="flex items-center gap-2 px-4 py-2 text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
        <h3 className="font-semibold text-dark-gray dark:text-white mb-4">Filters</h3>
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              Action
            </label>
            <div className="relative">
              <select
                value={filters.action}
                onChange={(e) => {
                  setFilters({ ...filters, action: e.target.value })
                  setPage(0)
                }}
                className="w-full appearance-none rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal px-4 py-3.5 pr-10 text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20 cursor-pointer"
              >
                <option value="">All Actions</option>
                {Object.values(AuditAction).map((action) => (
                  <option key={action} value={action}>
                    {action.replace('_', ' ')}
                  </option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="w-4 h-4 text-medium-gray" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              Entity Type
            </label>
            <div className="relative">
              <select
                value={filters.entityType}
                onChange={(e) => {
                  setFilters({ ...filters, entityType: e.target.value })
                  setPage(0)
                }}
                className="w-full appearance-none rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal px-4 py-3.5 pr-10 text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20 cursor-pointer"
              >
                <option value="">All Types</option>
                <option value="User">User</option>
                <option value="Meeting">Meeting</option>
                <option value="Department">Department</option>
                <option value="SystemSettings">System Settings</option>
                <option value="Session">Session</option>
                <option value="System">System</option>
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="w-4 h-4 text-medium-gray" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          <DatePicker
            label="Start Date"
            value={filters.startDate}
            onChange={(date) => {
              setFilters({ ...filters, startDate: date })
              setPage(0)
            }}
            placeholder="From date"
          />

          <DatePicker
            label="End Date"
            value={filters.endDate}
            onChange={(date) => {
              setFilters({ ...filters, endDate: date })
              setPage(0)
            }}
            placeholder="To date"
          />
        </div>
      </div>

      {/* Logs Table */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="p-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-medium-gray mx-auto mb-4" />
            <p className="text-medium-gray">Loading audit logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <Shield className="w-16 h-16 text-light-gray mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-dark-gray dark:text-white mb-2">No Logs Found</h3>
            <p className="text-medium-gray">No audit logs match your filters.</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-off-white dark:bg-charcoal border-b border-off-white dark:border-medium-gray/20">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-medium-gray uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-medium-gray uppercase tracking-wider">
                      Action
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-medium-gray uppercase tracking-wider">
                      Entity
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-medium-gray uppercase tracking-wider">
                      Details
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-medium-gray uppercase tracking-wider">
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-off-white dark:divide-medium-gray/20">
                  {logs.map((log) => {
                    const Icon = actionIcons[log.action] || Shield
                    const colorClass = actionColors[log.action] || 'text-gray-500 bg-gray-500/10'

                    return (
                      <tr key={log.id} className="even:bg-off-white/40 dark:even:bg-charcoal/40 hover:bg-off-white/70 dark:hover:bg-charcoal/60 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-charcoal to-medium-gray flex items-center justify-center text-white text-sm font-medium">
                              {log.user.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-dark-gray dark:text-white">
                                {log.user.name}
                              </p>
                              <p className="text-xs text-medium-gray">{log.user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colorClass}`}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <span className="text-sm font-medium text-dark-gray dark:text-white">
                              {log.action.replace('_', ' ')}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-dark-gray dark:text-white">
                            {log.entityType}
                          </span>
                          {log.entityId && (
                            <span className="text-xs text-medium-gray ml-1">
                              ({log.entityId.slice(0, 8)}...)
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {log.details ? (
                            <span className="text-xs text-medium-gray font-mono bg-off-white dark:bg-charcoal px-2 py-1 rounded">
                              {JSON.stringify(log.details).slice(0, 50)}
                              {JSON.stringify(log.details).length > 50 && '...'}
                            </span>
                          ) : (
                            <span className="text-xs text-light-gray">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-medium-gray">
                            {f.dateTime(log.createdAt, 'short')}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-off-white dark:divide-medium-gray/20">
              {logs.map((log) => {
                const Icon = actionIcons[log.action] || Shield
                const colorClass = actionColors[log.action] || 'text-gray-500 bg-gray-500/10'
                return (
                  <div key={log.id} className="p-4 space-y-2 even:bg-off-white/40 dark:even:bg-charcoal/40">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${colorClass}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span className="font-medium text-sm text-dark-gray dark:text-white">
                          {log.action.replace('_', ' ')}
                        </span>
                      </div>
                      <span className="text-xs text-medium-gray">{f.dateTime(log.createdAt, 'short')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-charcoal to-medium-gray flex items-center justify-center text-white text-xs font-medium">
                        {log.user.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm text-dark-gray dark:text-white">{log.user.name}</span>
                      <span className="text-xs text-medium-gray">{log.entityType}</span>
                    </div>
                    {log.details && (
                      <p className="text-xs text-medium-gray font-mono bg-off-white dark:bg-charcoal px-2 py-1 rounded truncate">
                        {JSON.stringify(log.details).slice(0, 80)}
                        {JSON.stringify(log.details).length > 80 && '...'}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Pagination */}
            <div className="px-6 py-4 border-t border-off-white dark:border-medium-gray/20 flex items-center justify-between">
              <p className="text-sm text-medium-gray">
                Showing {page * limit + 1} - {Math.min((page + 1) * limit, total)} of {total} logs
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-off-white dark:hover:bg-charcoal disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-5 h-5 text-medium-gray" />
                </button>
                <span className="text-sm text-dark-gray dark:text-white px-3">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-off-white dark:hover:bg-charcoal disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-5 h-5 text-medium-gray" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
