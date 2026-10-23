import { NextRequest, NextResponse } from 'next/server'
import { ApiError, notFound, parseBody, parseQuery, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { getSignedUploadUrl, getSignedDownloadUrl, deleteFromS3, isS3Configured } from '@/lib/s3'
import { assertAccess, canViewMeeting } from '@/lib/meeting-access'
import { createAuditLog } from '@/lib/audit'
import { attachmentDeleteQuery, attachmentQuery, createAttachmentSchema } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

const meetingSelect = { id: true, employeeId: true, reporterId: true } as const

/** GET — list attachments, or `?attachmentId=` for a signed download URL. Participants + admin. */
export const GET = withApiAuth(async (req: NextRequest, { user, params }) => {
  const { attachmentId } = parseQuery(req, attachmentQuery)

  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    select: { ...meetingSelect, attachments: { orderBy: { createdAt: 'desc' } } },
  })
  if (!meeting) throw notFound('Meeting')
  assertAccess(canViewMeeting(user, meeting))

  if (attachmentId) {
    const attachment = meeting.attachments.find((a) => a.id === attachmentId)
    if (!attachment) throw notFound('Attachment')
    if (!(await isS3Configured())) throw new ApiError(503, 'File storage is not configured')
    const downloadUrl = await getSignedDownloadUrl(attachment.s3Key)
    return NextResponse.json({ downloadUrl, fileName: attachment.fileName })
  }

  return NextResponse.json(meeting.attachments)
})

/** POST — register an attachment and return a presigned PUT URL. Requires S3. */
export const POST = withApiAuth(async (req: NextRequest, { user, params }) => {
  const { fileName, fileType, fileSize } = await parseBody(req, createAttachmentSchema)

  const meeting = await prisma.meeting.findUnique({ where: { id: params.id }, select: meetingSelect })
  if (!meeting) throw notFound('Meeting')
  assertAccess(canViewMeeting(user, meeting), 'Only meeting participants can upload attachments')

  if (!(await isS3Configured())) {
    throw new ApiError(503, 'File storage is not configured. Ask an admin to set up S3 in Settings.')
  }

  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
  const s3Key = `attachments/${params.id}/${Date.now()}-${sanitizedFileName}`
  const { uploadUrl, key } = await getSignedUploadUrl(s3Key, fileType)

  const attachment = await prisma.attachment.create({
    data: { meetingId: params.id, fileName, fileType, fileSize, s3Key: key, uploadedBy: user.id },
  })
  await createAuditLog({ userId: user.id, action: 'CREATE', entityType: 'Attachment', entityId: attachment.id, details: { meetingId: params.id, fileName } })

  return NextResponse.json({ uploadUrl, attachmentId: attachment.id, skipUpload: false })
})

/** DELETE ?attachmentId= — participants + admin; the attachment must belong to this meeting. */
export const DELETE = withApiAuth(async (req: NextRequest, { user, params }) => {
  const { attachmentId } = parseQuery(req, attachmentDeleteQuery)

  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, meetingId: params.id },
    include: { meeting: { select: meetingSelect } },
  })
  if (!attachment) throw notFound('Attachment')
  assertAccess(canViewMeeting(user, attachment.meeting))

  await deleteFromS3(attachment.s3Key).catch((error) =>
    console.error('Failed to delete from S3 (continuing with DB cleanup):', error)
  )
  await prisma.attachment.delete({ where: { id: attachmentId } })
  await createAuditLog({ userId: user.id, action: 'DELETE', entityType: 'Attachment', entityId: attachmentId, details: { meetingId: params.id, fileName: attachment.fileName } })

  return NextResponse.json({ success: true })
})
