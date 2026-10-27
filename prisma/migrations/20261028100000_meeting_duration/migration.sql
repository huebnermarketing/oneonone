-- Meeting length (15 or 30 min). Existing rows keep 30 (the previous fixed length); new rows default to 15.
ALTER TABLE "Meeting" ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Meeting" ALTER COLUMN "durationMinutes" SET DEFAULT 15;

ALTER TABLE "RecurringSchedule" ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "RecurringSchedule" ALTER COLUMN "durationMinutes" SET DEFAULT 15;
