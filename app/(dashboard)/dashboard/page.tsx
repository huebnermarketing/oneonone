import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import { formatMeetingShort, isTodoOverdue } from '@/lib/dates'
import { DEFAULT_TIMEZONE } from '@/lib/constants'
import Link from 'next/link'
import { Calendar, CheckSquare, Users, TrendingUp, Clock, AlertCircle, ChevronRight } from 'lucide-react'
import { WeekCalendar } from './week-calendar'
import { PendingRequests } from './pending-requests'

export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) return null
  const tz = user.timeZone ?? DEFAULT_TIMEZONE

  const stats = {
    upcomingMeetings: 0,
    pendingTodos: 0,
    overdueTodos: 0,
    directReports: 0,
    completedMeetings: 0,
  }

  const now = new Date()

  if (user.role === UserRole.EMPLOYEE) {
    const [meetings, todos, completedMeetings] = await Promise.all([
      prisma.meeting.count({
        where: {
          employeeId: user.id,
          status: 'SCHEDULED',
          meetingDate: { gte: now },
        },
      }),
      prisma.todo.findMany({
        where: {
          assignedToId: user.id,
          status: { not: 'DONE' },
        },
      }),
      prisma.meeting.count({
        where: {
          employeeId: user.id,
          status: 'COMPLETED',
        },
      }),
    ])
    // Also count PROPOSED meetings (may fail if enum not yet migrated)
    let proposedCount = 0
    try {
      proposedCount = await prisma.meeting.count({
        where: { employeeId: user.id, status: 'PROPOSED', meetingDate: { gte: now } },
      })
    } catch { /* PROPOSED enum not yet in DB */ }
    stats.upcomingMeetings = meetings + proposedCount
    stats.pendingTodos = todos.length
    stats.overdueTodos = todos.filter(t => isTodoOverdue(t.dueDate, now, t.status, tz)).length
    stats.completedMeetings = completedMeetings
  } else {
    const directReports = user.role === UserRole.SUPER_ADMIN
      ? await prisma.user.count({ where: { isActive: true } })
      : await prisma.user.count({ where: { reportsToId: user.id, isActive: true } })

    const baseMeetingFilter = user.role === UserRole.SUPER_ADMIN
      ? { status: 'SCHEDULED' as const, meetingDate: { gte: now } }
      : { OR: [
          { employeeId: user.id, status: 'SCHEDULED' as const, meetingDate: { gte: now } },
          { reporterId: user.id, status: 'SCHEDULED' as const, meetingDate: { gte: now } },
        ] }

    const [meetings, todos, completedMeetings] = await Promise.all([
      prisma.meeting.count({ where: baseMeetingFilter }),
      prisma.todo.findMany({
        where: {
          assignedToId: user.id,
          status: { not: 'DONE' },
        },
      }),
      prisma.meeting.count({
        where: user.role === UserRole.SUPER_ADMIN
          ? { status: 'COMPLETED' }
          : { reporterId: user.id, status: 'COMPLETED' },
      }),
    ])
    let proposedCount = 0
    try {
      const proposedFilter = user.role === UserRole.SUPER_ADMIN
        ? { status: 'PROPOSED' as const, meetingDate: { gte: now } }
        : { OR: [
            { employeeId: user.id, status: 'PROPOSED' as const, meetingDate: { gte: now } },
            { reporterId: user.id, status: 'PROPOSED' as const, meetingDate: { gte: now } },
          ] }
      proposedCount = await prisma.meeting.count({ where: proposedFilter })
    } catch { /* PROPOSED enum not yet in DB */ }
    stats.upcomingMeetings = meetings + proposedCount
    stats.pendingTodos = todos.length
    stats.overdueTodos = todos.filter(t => isTodoOverdue(t.dueDate, now, t.status, tz)).length
    stats.directReports = directReports
    stats.completedMeetings = completedMeetings
  }

  // ── Pending proposal requests (where user is receiver) ──────────
  type ProposalMeeting = {
    id: string
    meetingDate: Date
    proposedById: string | null
    employeeId: string
    reporterId: string
    employee: { id: string; name: string | null }
    reporter: { id: string; name: string | null }
  }
  let pendingRequestsForMe: ProposalMeeting[] = []
  let awaitingAcceptance: ProposalMeeting[] = []
  try {
    pendingRequestsForMe = await prisma.meeting.findMany({
      where: {
        status: 'PROPOSED',
        OR: [
          { employeeId: user.id, proposedById: { not: user.id } },
          { reporterId: user.id, proposedById: { not: user.id } },
        ],
      },
      include: {
        employee: { select: { id: true, name: true } },
        reporter: { select: { id: true, name: true } },
      },
      orderBy: { meetingDate: 'asc' },
    })

    awaitingAcceptance = await prisma.meeting.findMany({
      where: {
        status: 'PROPOSED',
        proposedById: user.id,
      },
      include: {
        employee: { select: { id: true, name: true } },
        reporter: { select: { id: true, name: true } },
      },
      orderBy: { meetingDate: 'asc' },
    })
  } catch {
    // proposedById column may not exist yet if migration hasn't run
  }

  // ── Week calendar meetings (1 year ahead so calendar shows full year) ─────
  const dayOfWeek = now.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const weekStart = new Date(now)
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(weekStart.getDate() + mondayOffset)
  const calendarEnd = new Date(weekStart)
  calendarEnd.setDate(calendarEnd.getDate() + 365)

  const weekMeetingsWhere = user.role === UserRole.EMPLOYEE
    ? { employeeId: user.id, meetingDate: { gte: weekStart, lt: calendarEnd }, status: { in: ['SCHEDULED', 'PROPOSED', 'COMPLETED'] as ('SCHEDULED' | 'PROPOSED' | 'COMPLETED')[] } }
    : user.role === UserRole.REPORTER
      ? { OR: [{ employeeId: user.id }, { reporterId: user.id }], meetingDate: { gte: weekStart, lt: calendarEnd }, status: { in: ['SCHEDULED', 'PROPOSED', 'COMPLETED'] as ('SCHEDULED' | 'PROPOSED' | 'COMPLETED')[] } }
      : { meetingDate: { gte: weekStart, lt: calendarEnd }, status: { in: ['SCHEDULED', 'PROPOSED', 'COMPLETED'] as ('SCHEDULED' | 'PROPOSED' | 'COMPLETED')[] } }

  let weekMeetings: { id: string; meetingDate: Date; status: string; employee: { name: string | null }; reporter: { name: string | null } }[] = []
  try {
    weekMeetings = await prisma.meeting.findMany({
      where: weekMeetingsWhere,
      include: {
        employee: { select: { name: true } },
        reporter: { select: { name: true } },
      },
      orderBy: { meetingDate: 'asc' },
    })
  } catch {
    // PROPOSED status may not exist yet; fallback to simpler query
    const fallbackWhere = user.role === UserRole.EMPLOYEE
      ? { employeeId: user.id, meetingDate: { gte: weekStart, lt: calendarEnd } }
      : user.role === UserRole.REPORTER
        ? { OR: [{ employeeId: user.id }, { reporterId: user.id }], meetingDate: { gte: weekStart, lt: calendarEnd } }
        : { meetingDate: { gte: weekStart, lt: calendarEnd } }
    weekMeetings = await prisma.meeting.findMany({
      where: fallbackWhere,
      include: {
        employee: { select: { name: true } },
        reporter: { select: { name: true } },
      },
      orderBy: { meetingDate: 'asc' },
    })
  }

  // Get recent meetings
  const recentMeetings = await prisma.meeting.findMany({
    where: user.role === UserRole.EMPLOYEE
      ? { employeeId: user.id }
      : user.role === UserRole.REPORTER
        ? { OR: [{ employeeId: user.id }, { reporterId: user.id }] }
        : {},
    include: {
      employee: { select: { name: true } },
      reporter: { select: { name: true } },
    },
    orderBy: { meetingDate: 'desc' },
    take: 5,
  })

  const greeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white mb-1">
          {greeting()}, {user.name?.split(' ')[0]}
        </h1>
        <p className="text-sm sm:text-base text-medium-gray">Here&apos;s what&apos;s happening with your one-on-ones</p>
      </div>

      {/* (1) Pending requests – receiver first */}
      {pendingRequestsForMe.length > 0 && (
        <PendingRequests
          type="receiver"
          meetings={pendingRequestsForMe.map((m) => ({
            id: m.id,
            meetingDate: m.meetingDate.toISOString(),
            proposerName:
              (m.proposedById === m.reporterId ? m.reporter.name : m.employee.name) || 'Someone',
            otherPartyName:
              (user.id === m.employeeId ? m.reporter.name : m.employee.name) || 'the other party',
          }))}
        />
      )}

      {/* (2) Awaiting acceptance – proposer */}
      {awaitingAcceptance.length > 0 && (
        <PendingRequests
          type="proposer"
          meetings={awaitingAcceptance.map((m) => ({
            id: m.id,
            meetingDate: m.meetingDate.toISOString(),
            proposerName: user.name || 'You',
            otherPartyName:
              (user.id === m.reporterId ? m.employee.name : m.reporter.name) || 'the other party',
          }))}
        />
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Link href="/meetings" aria-label="View upcoming meetings">
          <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 sm:p-5 hover:border-blue-500/30 transition-colors active:scale-[0.98]">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-dark-gray dark:text-white">{stats.upcomingMeetings}</p>
                <p className="text-xs sm:text-sm text-medium-gray">Upcoming</p>
              </div>
            </div>
          </div>
        </Link>

        <Link href="/todos" aria-label="View pending tasks">
          <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 sm:p-5 hover:border-amber-500/30 transition-colors active:scale-[0.98]">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <CheckSquare className="w-5 h-5 sm:w-6 sm:h-6 text-amber-500" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-dark-gray dark:text-white">{stats.pendingTodos}</p>
                <p className="text-xs sm:text-sm text-medium-gray">Pending Tasks</p>
              </div>
            </div>
          </div>
        </Link>

        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 sm:p-5">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-green-500" />
            </div>
            <div>
              <p className="text-xl sm:text-2xl font-bold text-dark-gray dark:text-white">{stats.completedMeetings}</p>
              <p className="text-xs sm:text-sm text-medium-gray">Completed</p>
            </div>
          </div>
        </div>

        {(user.role === UserRole.REPORTER || user.role === UserRole.SUPER_ADMIN) && (
          <Link href="/employees" aria-label="View team members">
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 sm:p-5 hover:border-medium-gray/50 transition-colors active:scale-[0.98]">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-off-white dark:bg-dark-gray flex items-center justify-center flex-shrink-0">
                  <Users className="w-5 h-5 sm:w-6 sm:h-6 text-dark-gray dark:text-white" />
                </div>
                <div>
                  <p className="text-xl sm:text-2xl font-bold text-dark-gray dark:text-white">{stats.directReports}</p>
                  <p className="text-xs sm:text-sm text-medium-gray">Team Members</p>
                </div>
              </div>
            </div>
          </Link>
        )}
      </div>

      {/* (3) Week Calendar */}
      <WeekCalendar
        initialMeetings={weekMeetings.map((m) => ({
          id: m.id,
          meetingDate: m.meetingDate.toISOString(),
          status: m.status,
          employee: m.employee,
          reporter: m.reporter,
        }))}
        initialWeekStart={weekStart.toISOString()}
        initialRangeEnd={calendarEnd.toISOString()}
        userRole={user.role}
      />

      {/* Recent Meetings & Quick Actions */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Meetings */}
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
          <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center justify-between">
            <h2 className="font-semibold text-dark-gray dark:text-white">Recent Meetings</h2>
            <Link href="/meetings" className="text-sm text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors">
              View all
            </Link>
          </div>
          {recentMeetings.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Calendar className="w-12 h-12 text-light-gray mx-auto mb-3" />
              <p className="font-medium text-dark-gray dark:text-white mb-1">No meetings yet</p>
              <p className="text-sm text-medium-gray">
                {(user.role === UserRole.REPORTER || user.role === UserRole.SUPER_ADMIN)
                  ? 'Schedule your first one-on-one meeting.'
                  : 'Your manager will schedule meetings with you.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-off-white dark:divide-medium-gray/20">
              {recentMeetings.map((meeting) => (
                <Link 
                  key={meeting.id} 
                  href={`/meetings/${meeting.id}`} 
                  className="flex items-center gap-4 px-6 py-4 even:bg-off-white/40 dark:even:bg-charcoal/40 hover:bg-off-white/70 dark:hover:bg-charcoal/60 transition-colors active:scale-[0.98]"
                >
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-dark-gray dark:text-white truncate">
                      {user.role === UserRole.EMPLOYEE ? meeting.reporter.name : meeting.employee.name}
                    </p>
                    <p className="text-sm text-medium-gray">
                      {formatMeetingShort(meeting.meetingDate, tz)}
                    </p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    meeting.status === 'COMPLETED' 
                      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                      : meeting.status === 'PROPOSED'
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  }`}>
                    {meeting.status === 'COMPLETED' ? 'Completed' : meeting.status === 'PROPOSED' ? 'Proposed' : 'Scheduled'}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
          <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20">
            <h2 className="font-semibold text-dark-gray dark:text-white">Quick Actions</h2>
          </div>
          <div className="p-4 space-y-2">
            {(user.role === UserRole.REPORTER || user.role === UserRole.SUPER_ADMIN) && (
              <Link 
                href="/meetings/new" 
                aria-label="Propose a new meeting"
                className="flex items-center gap-4 p-4 rounded-xl hover:bg-off-white/50 dark:hover:bg-charcoal/50 transition-colors group active:scale-[0.98]"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-dark-gray dark:text-white">Propose Meeting</p>
                  <p className="text-sm text-medium-gray">Set up a new one-on-one</p>
                </div>
                <ChevronRight className="w-5 h-5 text-light-gray group-hover:text-medium-gray transition-colors" />
              </Link>
            )}

            <Link 
              href="/todos" 
              aria-label="View your pending to-dos"
              className="flex items-center gap-4 p-4 rounded-xl hover:bg-off-white/50 dark:hover:bg-charcoal/50 transition-colors group active:scale-[0.98]"
            >
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <CheckSquare className="w-5 h-5 text-amber-500" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-dark-gray dark:text-white">View Tasks</p>
                <p className="text-sm text-medium-gray">Check your pending to-dos</p>
              </div>
              <ChevronRight className="w-5 h-5 text-light-gray group-hover:text-medium-gray transition-colors" />
            </Link>

            {(user.role === UserRole.REPORTER || user.role === UserRole.SUPER_ADMIN) && (
              <Link 
                href="/reports" 
                aria-label="View team reports and analytics"
                className="flex items-center gap-4 p-4 rounded-xl hover:bg-off-white/50 dark:hover:bg-charcoal/50 transition-colors group active:scale-[0.98]"
              >
                <div className="w-10 h-10 rounded-xl bg-off-white dark:bg-dark-gray flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-dark-gray dark:text-white" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-dark-gray dark:text-white">View Reports</p>
                  <p className="text-sm text-medium-gray">Team insights and analytics</p>
                </div>
                <ChevronRight className="w-5 h-5 text-light-gray group-hover:text-medium-gray transition-colors" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
