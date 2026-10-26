import { DashboardLayout } from '@/components/layouts/dashboard-layout'
import { requireAuth } from '@/lib/auth-helpers'
import { redirect } from 'next/navigation'
import { UserRole } from '@prisma/client'
import { TimeZoneProvider } from '@/components/providers/timezone-provider'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth()
  
  // Onboarding only for EMPLOYEEs who don't have a reporting manager yet.
  // REPORTER and SUPER_ADMIN can use the app without selecting a manager.
  if (user.role === UserRole.EMPLOYEE && !user.reportsToId) {
    redirect('/onboarding')
  }
  
  return (
    <TimeZoneProvider timeZone={user.timeZone}>
      <DashboardLayout>{children}</DashboardLayout>
    </TimeZoneProvider>
  )
}
