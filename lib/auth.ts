import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import type { Adapter, AdapterAccount } from 'next-auth/adapters'
import { saveGoogleTokens, sealAccountTokens } from './oauth-tokens'
import { maskEmail } from './redact'
import { UserRole } from '@prisma/client'
import { prisma } from './prisma'
import { logLogin } from './audit'
import { initialAdminEmails, signInGate } from './sign-in-gate'

// Validate Google OAuth env vars so we fail fast with a clear error instead of "client_id is required"
const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET
if (!googleClientId || !googleClientSecret) {
  throw new Error(
    'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env or .env.local. See SETUP_GUIDE.md Step 3.'
  )
}

// In production an unrestricted Google sign-in would let any Google account in. Refuse to boot.
if (process.env.NODE_ENV === 'production' && !process.env.GOOGLE_WORKSPACE_DOMAIN) {
  throw new Error(
    'GOOGLE_WORKSPACE_DOMAIN is not set. In production, sign-in must be restricted to your Workspace domain. See docs/ENV_VARIABLES.md.'
  )
}

// Comma-separated list of emails that are promoted to SUPER_ADMIN on sign-in.
// Replaces the "run an UPDATE in psql" bootstrap step. Only ever promotes, never demotes.
const initialAdmins = initialAdminEmails()

async function promoteIfInitialAdmin(userId: string, email?: string | null) {
  if (!email || !initialAdmins.has(email.toLowerCase())) return
  const updated = await prisma.user.updateMany({
    where: { id: userId, role: { not: UserRole.SUPER_ADMIN } },
    data: { role: UserRole.SUPER_ADMIN },
  })
  if (updated.count > 0) {
    console.info(`[NextAuth] Promoted ${maskEmail(email)} to SUPER_ADMIN via INITIAL_ADMIN_EMAILS`)
  }
}

/** PrismaAdapter whose linkAccount stores OAuth tokens encrypted (lib/oauth-tokens.ts). */
const baseAdapter = PrismaAdapter(prisma)
const encryptingAdapter: Adapter = {
  ...baseAdapter,
  linkAccount: (account: AdapterAccount) => baseAdapter.linkAccount!(sealAccountTokens(account)),
}

export const authOptions: NextAuthOptions = {
  adapter: encryptingAdapter,
  events: {
    // Runs once, right after the adapter inserts a new user
    createUser: async ({ user }) => {
      if (!user.name || user.name === '') {
        const name = user.email?.split('@')[0] || 'User'
        await prisma.user.update({
          where: { id: user.id },
          data: { name },
        })
      }
      await promoteIfInitialAdmin(user.id, user.email)
    },
    // Runs on every sign-in (new and existing users)
    signIn: async ({ user, account }) => {
      if (user?.id) {
        await promoteIfInitialAdmin(user.id, user.email)
        await logLogin(user.id)
        // The adapter only writes tokens when the account is first linked. Store the fresh ones on every
        // sign-in so a revoked/expired refresh token is replaced (prompt=consent makes Google resend it).
        if (account?.provider === 'google') {
          await saveGoogleTokens(user.id, account).catch((err) =>
            console.error('[auth] failed to store Google tokens:', err instanceof Error ? err.message : err)
          )
        }
      }
    },
  },
  providers: [
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      // Allow same email to sign in again (e.g. after sign-out); only Google is used and domain is restricted
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code',
          scope: 'openid email profile https://www.googleapis.com/auth/calendar',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      try {
        // Restrict to company domain only
        const allowedDomain = process.env.GOOGLE_WORKSPACE_DOMAIN
        if (!allowedDomain) {
          console.warn('GOOGLE_WORKSPACE_DOMAIN not set, allowing all domains')
          return true
        }

        const email = user.email || profile?.email
        if (!email) {
          return '/auth/signin?error=AccessDenied'
        }

        const domain = email.split('@')[1]
        if (domain?.toLowerCase() !== allowedDomain.toLowerCase()) {
          return '/auth/signin?error=AccessDenied'
        }

        // Inactive users are blocked; unknown emails are provisioned from Keka or refused (lib/sign-in-gate.ts)
        return await signInGate(email)
      } catch (err) {
        console.error('[NextAuth] signIn callback error:', err)
        return '/auth/signin?error=Callback'
      }
    },
    async session({ session, user }) {
      if (session.user) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email! },
          select: {
            id: true,
            role: true,
            name: true,
            email: true,
            avatar: true,
            departmentId: true,
            reportsToId: true,
            timeZone: true,
            isActive: true,
          },
        })

        if (dbUser && !dbUser.isActive) {
          // Purge all sessions for this inactive user so they are forced out
          await prisma.session.deleteMany({ where: { userId: dbUser.id } })
          // Return session without user data — auth helpers will treat as unauthenticated
          session.user = undefined as never
          return session
        }

        if (dbUser) {
          session.user.id = dbUser.id
          session.user.role = dbUser.role
          session.user.departmentId = dbUser.departmentId
          session.user.reportsToId = dbUser.reportsToId
          session.user.timeZone = dbUser.timeZone
        }
      }

      return session
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  session: {
    strategy: 'database',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  // Allow cookies to work on HTTP (non-HTTPS) in non-production
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production' && process.env.NEXTAUTH_URL?.startsWith('https') 
        ? '__Secure-next-auth.session-token' 
        : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production' && process.env.NEXTAUTH_URL?.startsWith('https'),
      },
    },
  },
}
