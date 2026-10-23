import { NextResponse } from 'next/server'
import { ADMIN, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { getLocalStorageStats, getLocalStorageDir, isS3Configured } from '@/lib/s3'

export const dynamic = 'force-dynamic'

const toMB = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 100) / 100

// GET /api/admin/storage - storage usage (admin only)
export const GET = withApiAuth(ADMIN, async () => {
  const [s3Configured, { fileCount, totalBytes }, agg] = await Promise.all([
    isS3Configured(),
    getLocalStorageStats(),
    prisma.meetingRecording.aggregate({ _sum: { fileSize: true }, _count: true }),
  ])
  const totalRecordingsBytes = agg._sum.fileSize ?? 0

  return NextResponse.json({
    storageType: s3Configured ? 's3' : 'local',
    localStorage: {
      path: getLocalStorageDir(),
      fileCount,
      totalBytes,
      totalMB: toMB(totalBytes),
    },
    recordings: {
      count: agg._count,
      totalBytes: totalRecordingsBytes,
      totalMB: toMB(totalRecordingsBytes),
    },
  })
})
