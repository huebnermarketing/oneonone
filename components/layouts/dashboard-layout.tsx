'use client'

import { Sidebar, type SidebarUser } from './sidebar'
import { ToastProvider } from '@/components/ui/toast'
import { ConfirmProvider } from '@/components/ui/confirm-modal'

export function DashboardLayout({ children, user }: { children: React.ReactNode; user?: SidebarUser }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="flex min-h-screen min-h-[100dvh] bg-off-white dark:bg-dark-gray">
          <Sidebar initialUser={user} />
          <main className="flex-1 min-w-0 lg:ml-72 overflow-x-hidden">
            {/* pb-24 on mobile: space above the bottom tab bar; safe-area for notched devices */}
            <div className="px-4 py-4 pb-24 lg:px-10 lg:py-10 lg:pb-10">{children}</div>
          </main>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  )
}
