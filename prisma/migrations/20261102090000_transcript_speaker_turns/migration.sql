-- AI speaker labels for transcripts (who said what)
ALTER TABLE "MeetingRecording" ADD COLUMN "speakerTurns" JSONB;
