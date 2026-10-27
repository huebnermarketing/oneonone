'use client'

import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { Users, Loader2 } from 'lucide-react'

function SignInContent() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard'
  const error = searchParams.get('error')
  const [redirecting, setRedirecting] = useState(false)

  return (
    <div className="min-h-screen bg-off-white dark:bg-dark-gray flex flex-col">
      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-[22px] bg-dark-gray dark:bg-white mb-6 shadow-lg">
              <Users className="w-10 h-10 text-white dark:text-dark-gray" />
            </div>
            <h1 className="text-[32px] font-semibold text-dark-gray dark:text-white tracking-tight">
              One-on-One
            </h1>
            <p className="text-medium-gray mt-1 text-[17px]">
              Sign in to continue
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-4 py-3">
              <p className="text-sm text-red-600 dark:text-red-400 text-center">
                {error === 'AccountInactive'
                  ? 'Your account has been deactivated. Please contact your administrator.'
                  : error === 'NotInKeka'
                  ? "We couldn't find you as an active employee in Keka. If you joined recently, ask HR to finish your Keka profile, then try again."
                  : error === 'KekaUnavailable'
                  ? "We couldn't reach Keka to set up your account. Please try again in a few minutes."
                  : error === 'NotRegistered'
                  ? "You haven't been added to One-on-One yet. Please ask your administrator to add you."
                  : error === 'AccessDenied'
                  ? 'Access denied. Please use your company email.'
                  : error === 'OAuthAccountNotLinked'
                  ? 'This email is already linked to another account.'
                  : error === 'OAuthCallback' || error === 'Callback'
                  ? 'Google sign-in could not complete. Ensure the server NEXTAUTH_URL matches this site and the Google Cloud Console redirect URI is exactly: [your-site]/api/auth/callback/google. Clear cookies and try again.'
                  : error === 'OAuthSignin'
                  ? 'Could not start Google sign-in. Check that GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set on the server.'
                  : error === 'Configuration'
                  ? 'Server auth is misconfigured. Administrator: set NEXTAUTH_URL, NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, and GOOGLE_CLIENT_SECRET in .env on the server.'
                  : error === 'Verification'
                  ? 'Sign-in link expired or already used. Please try again.'
                  : `Sign-in failed (${error}). Please try again or contact your administrator.`}
              </p>
            </div>
          )}

          {/* Google Sign In */}
          <button
            onClick={() => {
              setRedirecting(true)
              signIn('google', { callbackUrl })
            }}
            disabled={redirecting}
            className="w-full disabled:opacity-70 flex items-center justify-center gap-3 bg-white dark:bg-charcoal text-dark-gray dark:text-white font-medium rounded-xl px-6 py-4 transition-all duration-200 shadow-sm hover:shadow-md border border-light-gray/20 dark:border-medium-gray/20"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {redirecting ? 'Redirecting to Google…' : 'Continue with Google'}
          </button>

          {/* Footer Note */}
          <p className="mt-8 text-center text-[13px] text-medium-gray">
            Use your company Google account. First time here? Your profile is set up from Keka automatically.
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-6 text-center">
        <p className="text-[12px] text-medium-gray">
          AMI Agency Advantage • One-on-One Meeting System
        </p>
      </footer>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-off-white dark:bg-dark-gray flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-medium-gray animate-spin" />
      </div>
    }>
      <SignInContent />
    </Suspense>
  )
}
