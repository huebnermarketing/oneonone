-- Reschedule requests on SCHEDULED meetings (old time stays until the other participant accepts)
ALTER TABLE "Meeting" ADD COLUMN "rescheduleDate" TIMESTAMP(3);
ALTER TABLE "Meeting" ADD COLUMN "rescheduleDuration" INTEGER;
ALTER TABLE "Meeting" ADD COLUMN "rescheduleRequestedById" TEXT;
ALTER TABLE "Meeting" ADD COLUMN "rescheduleRequestedAt" TIMESTAMP(3);
ALTER TABLE "Meeting" ADD COLUMN "rescheduleReason" TEXT;

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RESCHEDULE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RESCHEDULE_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RESCHEDULE_DECLINED';
