-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'LEAVE_CONFLICT';
ALTER TYPE "NotificationType" ADD VALUE 'MEETING_SKIPPED';

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "leaveAlertedAt" TIMESTAMP(3);
