-- History of check-in form answers (employee submits + owner/admin edits)
-- CreateEnum
CREATE TYPE "FormRevisionKind" AS ENUM ('SUBMITTED', 'RESUBMITTED', 'EDITED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FORM_EDITED';

-- CreateTable
CREATE TABLE "MeetingFormRevision" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "editedById" TEXT,
    "kind" "FormRevisionKind" NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingFormRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingFormRevision_meetingId_createdAt_idx" ON "MeetingFormRevision"("meetingId", "createdAt");

-- AddForeignKey
ALTER TABLE "MeetingFormRevision" ADD CONSTRAINT "MeetingFormRevision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingFormRevision" ADD CONSTRAINT "MeetingFormRevision_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

