import { UserRole } from '@prisma/client'
import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name: string
      image?: string | null
      role: UserRole
      departmentId?: string | null
      reportsToId?: string | null
      timeZone?: string | null
    }
  }

  interface User {
    role: UserRole
    departmentId?: string | null
    reportsToId?: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string
    refreshToken?: string
    role: UserRole
  }
}
