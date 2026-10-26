import { requirePageAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import { UserManagement } from './user-management'
import Link from 'next/link'
import { Settings, Building2, Shield, HardDrive, Users, ChevronRight, Mic } from 'lucide-react'
import { BulkImport } from '@/components/admin/bulk-import'
import { isS3Configured } from '@/lib/s3'

export default async function AdminPage() {
  await requirePageAdmin()

  const [users, departments, recordingStats, s3Configured] = await Promise.all([
    prisma.user.findMany({
      include: {
        department: true,
        reportsTo: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.department.findMany({
      orderBy: { name: 'asc' },
    }),
    prisma.meetingRecording.aggregate({
      _sum: { fileSize: true },
      _count: true,
    }),
    isS3Configured(),
  ])

  const recordingsTotalMB = Math.round(((recordingStats._sum.fileSize ?? 0) / (1024 * 1024)) * 100) / 100
  const recordingsCount = recordingStats._count
  const storageLocation = s3Configured ? 'S3' : 'Local'

  // Get reporters and admins who can be managers
  const reporters = users.filter(u => 
    u.role === UserRole.REPORTER || u.role === UserRole.SUPER_ADMIN
  )

  const activeUsers = users.filter(u => u.isActive)
  const employeeCount = users.filter(u => u.role === UserRole.EMPLOYEE).length
  const reporterCount = users.filter(u => u.role === UserRole.REPORTER).length

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white mb-1">Admin</h1>
        <p className="text-sm sm:text-base text-medium-gray">Manage users, departments, and system settings</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Users className="w-6 h-6 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-dark-gray dark:text-white">{activeUsers.length}</p>
              <p className="text-sm text-medium-gray">Active Users</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
              <Users className="w-6 h-6 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-dark-gray dark:text-white">{employeeCount}</p>
              <p className="text-sm text-medium-gray">Employees</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-off-white dark:bg-dark-gray flex items-center justify-center">
              <Users className="w-6 h-6 text-dark-gray dark:text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-dark-gray dark:text-white">{reporterCount}</p>
              <p className="text-sm text-medium-gray">Reporters</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-dark-gray dark:text-white">{departments.length}</p>
              <p className="text-sm text-medium-gray">Departments</p>
            </div>
          </div>
        </div>
        <Link
          href="/admin/storage"
          className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5 hover:border-orange/30 transition-colors block"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-orange/10 flex items-center justify-center">
              <Mic className="w-6 h-6 text-orange" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-2xl font-bold text-dark-gray dark:text-white">{recordingsTotalMB} MB</p>
              <p className="text-sm text-medium-gray">Recording storage · {storageLocation}</p>
              <p className="text-xs text-orange mt-1">View usage &amp; location →</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Quick Actions */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20">
          <h2 className="font-semibold text-dark-gray dark:text-white">Quick Actions</h2>
        </div>
        <div className="divide-y divide-off-white dark:divide-medium-gray/20">
          <Link
            href="/admin/departments"
            className="flex items-center gap-4 px-6 py-4 hover:bg-off-white/50 dark:hover:bg-charcoal/50 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-amber-500" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-dark-gray dark:text-white">Departments</p>
              <p className="text-sm text-medium-gray">Manage department structure</p>
            </div>
            <ChevronRight className="w-5 h-5 text-light-gray" />
          </Link>
          <Link
            href="/admin/audit-logs"
            className="flex items-center gap-4 px-6 py-4 hover:bg-off-white/50 dark:hover:bg-charcoal/50 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-off-white dark:bg-dark-gray flex items-center justify-center">
              <Shield className="w-5 h-5 text-dark-gray dark:text-white" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-dark-gray dark:text-white">Audit Logs</p>
              <p className="text-sm text-medium-gray">View system activity history</p>
            </div>
            <ChevronRight className="w-5 h-5 text-light-gray" />
          </Link>
          <Link
            href="/admin/backup"
            className="flex items-center gap-4 px-6 py-4 hover:bg-off-white/50 dark:hover:bg-charcoal/50 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
              <HardDrive className="w-5 h-5 text-green-500" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-dark-gray dark:text-white">Backup & Restore</p>
              <p className="text-sm text-medium-gray">Manage data backups</p>
            </div>
            <ChevronRight className="w-5 h-5 text-light-gray" />
          </Link>
          <Link
            href="/admin/storage"
            className="flex items-center gap-4 px-6 py-4 hover:bg-off-white/50 dark:hover:bg-charcoal/50 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-orange/10 flex items-center justify-center">
              <Mic className="w-5 h-5 text-orange" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-dark-gray dark:text-white">Recording Storage</p>
              <p className="text-sm text-medium-gray">View usage and delete test recordings</p>
            </div>
            <ChevronRight className="w-5 h-5 text-light-gray" />
          </Link>
          <Link
            href="/admin/settings"
            className="flex items-center gap-4 px-6 py-4 hover:bg-off-white/50 dark:hover:bg-charcoal/50 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Settings className="w-5 h-5 text-blue-500" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-dark-gray dark:text-white">Settings</p>
              <p className="text-sm text-medium-gray">Configure system settings</p>
            </div>
            <ChevronRight className="w-5 h-5 text-light-gray" />
          </Link>
        </div>
      </div>

      {/* Bulk Import */}
      <div className="flex justify-end">
        <BulkImport />
      </div>

      {/* User Management */}
      <UserManagement 
        users={users} 
        departments={departments} 
        reporters={reporters}
      />
    </div>
  )
}
