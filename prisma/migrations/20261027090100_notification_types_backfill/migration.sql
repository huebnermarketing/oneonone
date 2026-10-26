-- Re-type existing MEETING_SCHEDULED rows by the title each producer always wrote.
-- Rows that match none (e.g. "New Meeting Scheduled") stay MEETING_SCHEDULED.
UPDATE "Notification" SET "type" = 'MEETING_PROPOSED'       WHERE "type" = 'MEETING_SCHEDULED' AND "title" = 'Meeting Request';
UPDATE "Notification" SET "type" = 'MEETING_ACCEPTED'       WHERE "type" = 'MEETING_SCHEDULED' AND "title" = 'Meeting Confirmed';
UPDATE "Notification" SET "type" = 'MEETING_TIME_SUGGESTED' WHERE "type" = 'MEETING_SCHEDULED' AND "title" = 'New Time Suggested';
UPDATE "Notification" SET "type" = 'MEETING_COMPLETED'      WHERE "type" = 'MEETING_SCHEDULED' AND "title" = 'Meeting Completed';
UPDATE "Notification" SET "type" = 'SCHEDULE_UPDATED'       WHERE "type" = 'MEETING_SCHEDULED' AND "title" = 'Recurring Schedule Updated';
