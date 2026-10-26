-- Separate notification types for proposal-based scheduling (previously all stored as MEETING_SCHEDULED).
-- New enum values must be committed before use, so the backfill is the next migration.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MEETING_PROPOSED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MEETING_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MEETING_TIME_SUGGESTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MEETING_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SCHEDULE_UPDATED';
