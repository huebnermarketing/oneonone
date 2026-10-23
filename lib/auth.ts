import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { UserRole } from '@prisma/client'
import { prisma } from './prisma'
import { logLogin } from './audit'

// Validate Google OAuth env vars so we fail fast with a clear error instead of "client_id is required"
const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET
if (!googleClientId || !googleClientSecret) {
  throw new Error(
    'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env or .env.local. See SETUP_GUIDE.md Step 3.'
  )
}

// Comma-separated list of emails that are promoted to SUPER_ADMIN on sign-in.
// Replaces the "run an UPDATE in psql" bootstrap step. Only ever promotes, never demotes.
const initialAdminEmails = new Set(
  (process.env.INITIAL_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
)

async function promoteIfInitialAdmin(userId: string, email?: string | null) {
  if (!email || !initialAdminEmails.has(email.toLowerCase())) return
  const updated = await prisma.user.updateMany({
    where: { id: userId, role: { not: UserRole.SUPER_ADMIN } },
    data: { role: UserRole.SUPER_ADMIN },
  })
  if (updated.count > 0) {
    console.info(`[NextAuth] Promoted ${email} to SUPER_ADMIN via INITIAL_ADMIN_EMAILS`)
  }
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
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
    signIn: async ({ user }) => {
      if (user?.id) {
        await promoteIfInitialAdmin(user.id, user.email)
        await logLogin(user.id)
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

        // Block inactive users from signing in
        const existingUser = await prisma.user.findUnique({
          where: { email },
          select: { isActive: true },
        })
        if (existingUser && !existingUser.isActive) {
          return '/auth/signin?error=AccountInactive'
        }

        return true
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
        }
      }

      return session
    },
    async jwt({ token, account, user }) {
      if (account && user) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        
        // Store tokens in database for Calendar API access
        if (account.access_token && account.refresh_token) {
          await prisma.account.updateMany({
            where: {
              userId: user.id,
              provider: 'google',
            },
            data: {
              access_token: account.access_token,
              refresh_token: account.refresh_token,
              expires_at: account.expires_at,
            },
          })
        }
      }
      return token
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
