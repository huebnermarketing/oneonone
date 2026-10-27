-- Multi-part recordings: chunk ranges per part on the processing job
ALTER TABLE "RecordingJob" ADD COLUMN "parts" JSONB;
