import { requirePageRole } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import Link from 'next/link'
import { Users, Mic, ChevronRight, CheckCircle2, XCircle } from 'lucide-react'
import { StatCard } from '@/components/ui/stat-card'
import { Avatar } from '@/components/ui/avatar'
import { Pill } from '@/components/ui/pill'

export default async function EmployeesPage() {
  const user = await requirePageRole([UserRole.REPORTER, UserRole.SUPER_ADMIN])

  // Reporters see their direct reports; Super Admin sees ALL users (employees + reporters)
  const whereClause =
    user.role === UserRole.REPORTER
      ? { reportsToId: user.id, isActive: true }
      : { isActive: true, role: { in: [UserRole.EMPLOYEE, UserRole.REPORTER] as UserRole[] } }

  const people = await prisma.user.findMany({
    where: whereClause,
    include: {
      department: true,
      reportsTo: { select: { name: true } },
      meetingsAsEmployee: {
        select: {
          id: true,
          status: true,
          meetingDate: true,
          formSubmittedAt: true,
          recording: { select: { id: true, status: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  const now = new Date()

  // Compute stats per person
  const peopleWithStats = people.map((p) => {
    const totalMeetings = p.meetingsAsEmployee.length
    const completed = p.meetingsAsEmployee.filter((m) => m.status === 'COMPLETED').length
    const missed = p.meetingsAsEmployee.filter(
      (m) =>
        new Date(m.meetingDate) < now &&
        m.status !== 'COMPLETED'
    ).length
    const recordings = p.meetingsAsEmployee.filter(
      (m) => m.recording && m.recording.status === 'COMPLETED'
    ).length

    return { ...p, totalMeetings, completed, missed, recordings }
  })

  const totalRecordings = peopleWithStats.reduce((s, p) => s + p.recordings, 0)
  const totalCompleted = peopleWithStats.reduce((s, p) => s + p.completed, 0)
  const totalMissed = peopleWithStats.reduce((s, p) => s + p.missed, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white mb-1">
          Team Members
        </h1>
        <p className="text-sm sm:text-base text-medium-gray">
          {user.role === UserRole.SUPER_ADMIN
            ? 'All employees and reporters in the organization'
            : 'Your direct reports and their progress'}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Members" value={peopleWithStats.length} icon={Users} accent="blue" />
        <StatCard label="Attended" value={totalCompleted} icon={CheckCircle2} accent="green" />
        <StatCard label="Missed" value={totalMissed} icon={XCircle} accent="red" />
        <StatCard label="Recordings" value={totalRecordings} icon={Mic} accent="neutral" />
      </div>

      {/* People List */}
      {peopleWithStats.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-12 text-center">
          <Users className="w-16 h-16 text-light-gray mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-dark-gray dark:text-white mb-2">No team members</h3>
          <p className="text-medium-gray">No direct reports assigned yet.</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
          <div className="divide-y divide-off-white dark:divide-medium-gray/20">
            {peopleWithStats.map((person) => (
              <Link
                key={person.id}
                href={`/employees/${person.id}`}
                className="flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3 sm:py-4 even:bg-off-white/40 dark:even:bg-charcoal/40 hover:bg-off-white/70 dark:hover:bg-charcoal/60 active:bg-off-white dark:active:bg-charcoal active:scale-[0.98] transition-colors"
              >
                <Avatar name={person.name} src={person.image} size="md" alt="" />

                {/* Name + Role */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-dark-gray dark:text-white text-sm sm:text-base truncate">
                      {person.name}
                    </p>
                    {person.role === UserRole.REPORTER && (
                      <Pill tone="purple" className="flex-shrink-0 px-1.5 py-0.5">Reporter</Pill>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-medium-gray truncate">
                    {person.department?.name || 'No department'}
                    {person.reportsTo && ` · ${person.reportsTo.name}`}
                  </p>
                </div>

                {/* Stats badges */}
                <div className="hidden sm:flex items-center gap-3 text-xs text-medium-gray flex-shrink-0">
                  <div className="flex items-center gap-1" title="Attended">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                    <span>{person.completed}</span>
                  </div>
                  <div className="flex items-center gap-1" title="Missed">
                    <XCircle className="w-3.5 h-3.5 text-red-500" />
                    <span>{person.missed}</span>
                  </div>
                  <div className="flex items-center gap-1" title="Recordings">
                    <Mic className="w-3.5 h-3.5 text-purple-500" />
                    <span>{person.recordings}</span>
                  </div>
                </div>

                {/* Mobile compact stats */}
                <div className="flex sm:hidden items-center gap-2 text-xs text-medium-gray flex-shrink-0">
                  <span className="text-green-500 font-medium">{person.completed}</span>
                  <span>/</span>
                  <span className="text-red-500 font-medium">{person.missed}</span>
                  <Mic className="w-3 h-3 text-purple-500 ml-1" />
                  <span>{person.recordings}</span>
                </div>

                <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-light-gray flex-shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
