import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import { formatMeetingShort, toDateKey, startOfDayInTz, offsetMinutes } from '@/lib/dates'
import { meetingScope } from '@/lib/meeting-list'
import { DEFAULT_TIMEZONE } from '@/lib/constants'
import { greeting } from '@/lib/ui'
import Link from 'next/link'
import { Calendar, CheckSquare, Users, TrendingUp, Clock, ChevronRight } from 'lucide-react'
import { StatCard } from '@/components/ui/stat-card'
import { MeetingStatusPill } from '@/components/ui/pill'
import { WeekCalendar } from './week-calendar'
import { PendingRequests } from './pending-requests'

/** Weeks of meetings sent with the page; navigating past them fetches from /api/meetings. */
const PRELOAD_WEEKS = 8

export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) return null
  const tz = user.timeZone ?? DEFAULT_TIMEZONE

  const now = new Date()
  const isEmployee = user.role === UserRole.EMPLOYEE
  const scope = meetingScope(user)
  const people = { employee: { select: { id: true, name: true } }, reporter: { select: { id: true, name: true } } }
  const names = { employee: { select: { name: true } }, reporter: { select: { name: true } } }

  // ── Week calendar preload: this week + the next PRELOAD_WEEKS-1; the calendar fetches anything else ──
  // Monday of the current week as a calendar day in the VIEWER's zone, then its start instant.
  const [ty, tm, td] = toDateKey(now, tz).split('-').map(Number)
  const todayUtc = new Date(Date.UTC(ty, tm - 1, td))
  const dayOfWeek = todayUtc.getUTCDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  todayUtc.setUTCDate(todayUtc.getUTCDate() + mondayOffset)
  const weekStart = startOfDayInTz(todayUtc.toISOString().slice(0, 10), tz)
  const calendarEnd = new Date(weekStart.getTime() + PRELOAD_WEEKS * 7 * 86_400_000)

  const [
    upcomingMeetings,
    completedMeetings,
    pendingTodos,
    directReports,
    pendingRequestsForMe,
    awaitingAcceptance,
    weekMeetings,
    recentMeetings,
  ] = await Promise.all([
    prisma.meeting.count({
      where: { AND: [scope, { status: { in: ['SCHEDULED', 'PROPOSED'] }, meetingDate: { gte: now } }] },
    }),
    prisma.meeting.count({
      where:
        user.role === UserRole.REPORTER
          ? { reporterId: user.id, status: 'COMPLETED' }
          : { AND: [scope, { status: 'COMPLETED' }] },
    }),
    prisma.todo.count({ where: { assignedToId: user.id, status: { not: 'DONE' } } }),
    isEmployee
      ? Promise.resolve(0)
      : prisma.user.count({
          where: user.role === UserRole.SUPER_ADMIN ? { isActive: true } : { reportsToId: user.id, isActive: true },
        }),
    // Pending proposals where the user is the receiver / the proposer
    prisma.meeting.findMany({
      where: {
        status: 'PROPOSED',
        OR: [
          { employeeId: user.id, proposedById: { not: user.id } },
          { reporterId: user.id, proposedById: { not: user.id } },
        ],
      },
      select: { id: true, meetingDate: true, proposedById: true, employeeId: true, reporterId: true, ...people },
      orderBy: { meetingDate: 'asc' },
    }),
    prisma.meeting.findMany({
      where: { status: 'PROPOSED', proposedById: user.id },
      select: { id: true, meetingDate: true, proposedById: true, employeeId: true, reporterId: true, ...people },
      orderBy: { meetingDate: 'asc' },
    }),
    prisma.meeting.findMany({
      where: {
        AND: [
          scope,
          { meetingDate: { gte: weekStart, lt: calendarEnd }, status: { in: ['SCHEDULED', 'PROPOSED', 'COMPLETED'] } },
        ],
      },
      select: { id: true, meetingDate: true, status: true, ...names },
      orderBy: { meetingDate: 'asc' },
    }),
    prisma.meeting.findMany({
      where: scope,
      select: { id: true, meetingDate: true, status: true, ...names },
      orderBy: { meetingDate: 'desc' },
      take: 5,
    }),
  ])

  const stats = { upcomingMeetings, completedMeetings, pendingTodos, directReports }

  // Hour of day in the viewer's zone (never the server's)
  const viewerHour = Math.floor((((now.getUTCHours() * 60 + now.getUTCMinutes() + offsetMinutes(now, tz)) % 1440) + 1440) % 1440 / 60)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white mb-1">
          {greeting(viewerHour)}, {user.name?.split(' ')[0]}
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
        <StatCard label="Upcoming" value={stats.upcomingMeetings} icon={Clock} accent="blue" href="/meetings" />
        <StatCard label="Pending Tasks" value={stats.pendingTodos} icon={CheckSquare} accent="amber" href="/todos" />
        <StatCard label="Completed" value={stats.completedMeetings} icon={TrendingUp} accent="green" />
        {(user.role === UserRole.REPORTER || user.role === UserRole.SUPER_ADMIN) && (
          <StatCard label="Team Members" value={stats.directReports} icon={Users} accent="neutral" href="/employees" />
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
                  <MeetingStatusPill status={meeting.status} />
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
