'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Calendar,
  CheckSquare,
  Users,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  ChevronRight,
  BarChart3,
  UserCircle,
  Building2,
  Shield,
  HardDrive,
  Mic,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { UserRole } from '@prisma/client'
import { useTheme } from './theme-provider'
import { Avatar } from '@/components/ui/avatar'
import { NotificationCenter, useNotifications } from '@/components/notifications/notification-center'

interface NavItem {
  name: string
  href: string
  icon: LucideIcon
  roles?: UserRole[]
  /** Exact-match only (e.g. /admin must not light up on /admin/settings) */
  exact?: boolean
}

const REPORTER_UP: UserRole[] = ['REPORTER', 'SUPER_ADMIN']

const NAV_ITEMS: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Meetings', href: '/meetings', icon: Calendar },
  { name: 'To-Dos', href: '/todos', icon: CheckSquare },
  { name: 'Team', href: '/employees', icon: Users, roles: REPORTER_UP },
  { name: 'Reports', href: '/reports', icon: FileText, roles: REPORTER_UP },
  { name: 'Insights', href: '/insights', icon: BarChart3, roles: REPORTER_UP },
]

const ADMIN_NAV_ITEMS: NavItem[] = [
  { name: 'User Management', href: '/admin', icon: Users, exact: true },
  { name: 'Departments', href: '/admin/departments', icon: Building2 },
  { name: 'Audit Logs', href: '/admin/audit-logs', icon: Shield },
  { name: 'Backup & Restore', href: '/admin/backup', icon: HardDrive },
  { name: 'Recording Storage', href: '/admin/storage', icon: Mic },
  { name: 'Settings', href: '/admin/settings', icon: Settings },
]

// Bottom tab bar items (mobile only — max 5 for thumb reach)
const BOTTOM_TABS: NavItem[] = [
  { name: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Meetings', href: '/meetings', icon: Calendar },
  { name: 'Tasks', href: '/todos', icon: CheckSquare },
  { name: 'Reports', href: '/reports', icon: FileText, roles: REPORTER_UP },
  { name: 'More', href: '__more__', icon: Menu },
]

const LINK_CLASSES = {
  mobile: {
    base: 'flex items-center gap-3 rounded-xl px-4 py-3.5 text-sm font-medium transition-all focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none',
    active: 'bg-off-white dark:bg-dark-gray text-dark-gray dark:text-white',
    idle: 'text-medium-gray active:bg-off-white/50 dark:active:bg-dark-gray/50',
    icon: '',
  },
  desktop: {
    base: 'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 group relative focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none',
    active: 'bg-off-white dark:bg-dark-gray text-dark-gray dark:text-white',
    idle: 'text-medium-gray hover:bg-off-white/50 dark:hover:bg-dark-gray/50 hover:text-dark-gray dark:hover:text-white',
    icon: 'group-hover:text-dark-gray dark:group-hover:text-white',
  },
} as const

const isItemActive = (item: NavItem, pathname: string | null) =>
  item.exact ? pathname === item.href : pathname === item.href || !!pathname?.startsWith(item.href + '/')

const visibleTo = (items: NavItem[], role: UserRole | undefined) =>
  items.filter((item) => !item.roles || (!!role && item.roles.includes(role)))

const LogoMark = ({ className }: { className: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()
  // Single poller shared by the mobile and desktop bells
  const notificationStore = useNotifications()

  const userRole = session?.user?.role as UserRole | undefined
  const isAdmin = userRole === UserRole.SUPER_ADMIN

  const mainItems = visibleTo(NAV_ITEMS, userRole)
  const bottomTabs = visibleTo(BOTTOM_TABS, userRole)

  const closeMobile = () => setIsMobileOpen(false)

  /** Menu + Admin sections; identical markup for both layouts, differing only in classes. */
  const renderNav = (variant: keyof typeof LINK_CLASSES) => {
    const c = LINK_CLASSES[variant]
    const renderItem = (item: NavItem) => {
      const isActive = isItemActive(item, pathname)
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={variant === 'mobile' ? closeMobile : undefined}
          aria-current={isActive ? 'page' : undefined}
          className={cn(c.base, isActive ? c.active : c.idle)}
        >
          {variant === 'desktop' && isActive && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-orange rounded-r-full" aria-hidden="true" />
          )}
          <item.icon className={cn('h-5 w-5', isActive ? 'text-orange' : c.icon)} aria-hidden="true" />
          <span className="flex-1">{item.name}</span>
          {isActive && <ChevronRight className="h-4 w-4 text-orange" aria-hidden="true" />}
        </Link>
      )
    }
    return (
      <>
        <div className="mb-2 px-3">
          <span className="text-xs font-semibold text-medium-gray uppercase tracking-wider">Menu</span>
        </div>
        {mainItems.map(renderItem)}
        {isAdmin && (
          <>
            <div className={cn('mb-2 px-3', variant === 'mobile' ? 'mt-6' : 'mt-8')}>
              <span className="text-xs font-semibold text-medium-gray uppercase tracking-wider">Admin</span>
            </div>
            {ADMIN_NAV_ITEMS.map(renderItem)}
          </>
        )}
      </>
    )
  }

  /** Bell + theme toggle, profile card, sign out; shared by both layouts. */
  const renderFooter = (variant: keyof typeof LINK_CLASSES) => (
    <div className="p-4 border-t border-off-white dark:border-dark-gray space-y-3">
      <div className="flex items-center justify-between px-2">
        <NotificationCenter store={notificationStore} />
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-off-white dark:hover:bg-dark-gray transition-colors"
          title={theme === 'light' ? 'Dark Mode' : 'Light Mode'}
        >
          {theme === 'light' ? <Moon className="h-5 w-5 text-medium-gray" aria-hidden="true" /> : <Sun className="h-5 w-5 text-medium-gray" aria-hidden="true" />}
        </button>
      </div>

      <Link
        href="/profile"
        onClick={variant === 'mobile' ? closeMobile : undefined}
        aria-label="View profile"
        aria-current={pathname === '/profile' ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 px-4 py-3 rounded-xl bg-off-white dark:bg-dark-gray',
          variant === 'desktop' && 'hover:bg-off-white/80 dark:hover:bg-dark-gray/80 transition-colors'
        )}
      >
        <Avatar name={session?.user?.name} src={session?.user?.image} alt="" className="bg-gradient-to-br from-charcoal to-medium-gray dark:from-medium-gray dark:to-charcoal text-white dark:text-white" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-dark-gray dark:text-white truncate">
            {session?.user?.name}
          </p>
          <p className="text-xs text-medium-gray truncate capitalize">
            {session?.user?.role?.toLowerCase().replace('_', ' ')}
          </p>
        </div>
        <UserCircle className="w-4 h-4 text-medium-gray" aria-hidden="true" />
      </Link>

      <button
        type="button"
        onClick={() => signOut({ callbackUrl: '/auth/signin' })}
        className={cn(
          'w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10',
          variant === 'desktop' ? 'transition-all duration-200' : 'transition-colors'
        )}
      >
        <LogOut className="h-5 w-5" aria-hidden="true" />
        <span>Sign out</span>
      </button>
    </div>
  )

  return (
    <>
      {/* ================================================================
          MOBILE: Bottom Tab Bar (visible below lg breakpoint)
          ================================================================ */}
      <nav aria-label="Main navigation" className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-charcoal border-t border-off-white dark:border-medium-gray/20 safe-area-bottom">
        <div className="flex items-stretch justify-around h-16">
          {bottomTabs.map((tab) => {
            const isMore = tab.href === '__more__'
            const isActive = !isMore && isItemActive(tab, pathname)

            if (isMore) {
              return (
                <button
                  key={tab.name}
                  type="button"
                  onClick={() => setIsMobileOpen(true)}
                  aria-label="Open menu"
                  aria-expanded={isMobileOpen}
                  className="flex flex-col items-center justify-center flex-1 gap-0.5 text-medium-gray active:bg-off-white/60 dark:active:bg-dark-gray/60 transition-colors focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none"
                >
                  <tab.icon className="w-5 h-5" aria-hidden="true" />
                  <span className="text-[11px] font-medium">{tab.name}</span>
                </button>
              )
            }

            return (
              <Link
                key={tab.name}
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center flex-1 gap-0.5 transition-colors active:bg-off-white/60 dark:active:bg-dark-gray/60 focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none',
                  isActive ? 'text-orange' : 'text-medium-gray'
                )}
              >
                <tab.icon className="w-5 h-5" aria-hidden="true" />
                <span className="text-[11px] font-medium">{tab.name}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      {/* ================================================================
          MOBILE: Slide-over panel ("More" menu)
          ================================================================ */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      <aside
        role="dialog"
        aria-label="Navigation menu"
        aria-hidden={!isMobileOpen}
        className={cn(
          'fixed inset-y-0 right-0 z-[70] w-[85vw] max-w-sm bg-white dark:bg-charcoal shadow-2xl transform transition-transform duration-300 ease-out lg:hidden flex flex-col',
          isMobileOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Mobile panel header */}
        <div className="flex items-center justify-between h-16 px-5 border-b border-off-white dark:border-dark-gray">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-dark-gray dark:bg-white/10 rounded-lg flex items-center justify-center">
              <LogoMark className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-dark-gray dark:text-white">AMI One-on-One</span>
          </div>
          <button
            type="button"
            onClick={closeMobile}
            aria-label="Close menu"
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-off-white dark:hover:bg-dark-gray"
          >
            <X className="w-5 h-5 text-dark-gray dark:text-white" aria-hidden="true" />
          </button>
        </div>

        {/* Mobile nav items */}
        <nav aria-label="Menu" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {renderNav('mobile')}
        </nav>

        {renderFooter('mobile')}
      </aside>

      {/* ================================================================
          DESKTOP: Traditional left sidebar (visible at lg+)
          ================================================================ */}
      <aside aria-label="Sidebar navigation" className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-72 bg-white dark:bg-charcoal border-r border-off-white dark:border-dark-gray flex-col">
        {/* Logo */}
        <div className="h-20 flex items-center px-6 border-b border-off-white dark:border-dark-gray">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-dark-gray dark:bg-white/10 rounded-xl flex items-center justify-center">
              <LogoMark className="w-5 h-5 text-white dark:text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-dark-gray dark:text-white">AMI</h1>
              <p className="text-xs text-medium-gray -mt-0.5">One-on-One</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav aria-label="Menu" className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {renderNav('desktop')}
        </nav>

        {renderFooter('desktop')}
      </aside>
    </>
  )
}
