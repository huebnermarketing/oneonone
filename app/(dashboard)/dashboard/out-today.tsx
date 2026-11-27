import { UserRole } from '@prisma/client'
import { CalendarOff } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { isKekaConfigured } from '@/lib/keka'
import { whoIsOutToday } from '@/lib/absences'
import { formatDateOnly, toDateKey } from '@/lib/dates'
import { DEFAULT_TIMEZONE } from '@/lib/constants'
import { Avatar } from '@/components/ui/avatar'
import { Pill } from '@/components/ui/pill'

/**
 * Whose "Out today" a viewer sees: admin → everyone; manager → themselves + direct reports;
 * employee → themselves, their manager and teammates (same manager).
 */
async function outTodayScope(user: { id: string; role: UserRole; reportsToId?: string | null }): Promise<string[] | null> {
  if (user.role === UserRole.SUPER_ADMIN) return null
  if (user.role === UserRole.REPORTER) {
    const reports = await prisma.user.findMany({ where: { reportsToId: user.id, isActive: true }, select: { id: true } })
    return [user.id, ...reports.map((r) => r.id)]
  }
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { reportsToId: true } })
  if (!me?.reportsToId) return [user.id]
  const team = await prisma.user.findMany({ where: { reportsToId: me.reportsToId, isActive: true }, select: { id: true } })
  return [user.id, me.reportsToId, ...team.map((t) => t.id)]
}

function Card({ children, count, today }: { children: React.ReactNode; count?: number; today: string }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
      <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-dark-gray dark:text-white">
          Out today{count ? <span className="ml-2 text-sm font-normal text-medium-gray">({count})</span> : null}
        </h2>
        <span className="text-sm text-medium-gray">{today} · Keka</span>
      </div>
      {children}
    </div>
  )
}

/** Dashboard card: people on approved leave today (full / half day) from Keka. */
export async function OutToday({ user }: { user: { id: string; role: UserRole; timeZone?: string | null } }) {
  const now = new Date()
  const today = formatDateOnly(toDateKey(now, user.timeZone ?? DEFAULT_TIMEZONE), 'short')

  if (!isKekaConfigured()) {
    return (
      <Card today={today}>
        <p className="px-6 py-12 text-center text-sm text-medium-gray">Keka is not connected, so leave can&apos;t be shown.</p>
      </Card>
    )
  }

  const people = await whoIsOutToday(await outTodayScope(user), now)

  if (people.length === 0) {
    return (
      <Card today={today}>
        <div className="px-6 py-12 text-center">
          <CalendarOff className="w-12 h-12 text-light-gray mx-auto mb-3" aria-hidden="true" />
          <p className="font-medium text-dark-gray dark:text-white mb-1">Everyone is in today</p>
          <p className="text-sm text-medium-gray">No approved leave in Keka for {user.role === UserRole.SUPER_ADMIN ? 'anyone' : 'your team'} today.</p>
        </div>
      </Card>
    )
  }

  return (
    <Card today={today} count={people.length}>
      <ul className="divide-y divide-off-white dark:divide-medium-gray/20 max-h-[420px] overflow-y-auto">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-6 py-3 even:bg-off-white/40 dark:even:bg-charcoal/40">
            <Avatar name={p.name} src={p.image} size="sm" alt="" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-dark-gray dark:text-white truncate">
                {p.name ?? 'Unknown'}
                {p.id === user.id && <span className="ml-1.5 text-sm font-normal text-medium-gray">(you)</span>}
              </p>
              {(p.title || p.department) && (
                <p className="text-sm text-medium-gray truncate">{[p.title, p.department].filter(Boolean).join(' · ')}</p>
              )}
            </div>
            {p.absence.half ? (
              <Pill tone="amber" className="flex-shrink-0">Half day · {p.absence.half === 'FIRST' ? 'first half' : 'second half'}</Pill>
            ) : (
              <Pill tone="red" className="flex-shrink-0">On leave</Pill>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function OutTodaySkeleton() {
  return (
    <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden" aria-busy="true">
      <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20">
        <h2 className="font-semibold text-dark-gray dark:text-white">Out today</h2>
      </div>
      <div className="p-6 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 rounded-xl bg-off-white dark:bg-dark-gray animate-pulse" />
        ))}
      </div>
    </div>
  )
}
