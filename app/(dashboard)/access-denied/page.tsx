import Link from 'next/link'
import { ShieldAlert, Home } from 'lucide-react'

export const metadata = { title: 'No access' }

/** Where page-level role checks send signed-in users who lack the required role. */
export default function AccessDeniedPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-orange/10 flex items-center justify-center mx-auto mb-6" aria-hidden="true">
          <ShieldAlert className="w-8 h-8 text-orange" />
        </div>
        <h1 className="text-2xl font-bold text-dark-gray dark:text-white mb-2">You don&apos;t have access to that page</h1>
        <p className="text-medium-gray mb-6">It&apos;s available to managers or admins. If you think you should have access, ask an admin to update your role.</p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-orange text-white rounded-xl hover:bg-orange/90 transition-colors"
        >
          <Home className="w-4 h-4" aria-hidden="true" />
          Go to Dashboard
        </Link>
      </div>
    </div>
  )
}
