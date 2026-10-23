import { NextResponse } from 'next/server'
import { withPublicRoute } from '@/lib/api'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/health - liveness + DB connectivity. 503 when the database is unreachable.
export const GET = withPublicRoute(async () => {
  const timestamp = new Date().toISOString()
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (error) {
    console.error('Health check failed:', error)
    return NextResponse.json({ status: 'unhealthy', timestamp }, { status: 503 })
  }
  return NextResponse.json({ status: 'healthy', timestamp })
})
