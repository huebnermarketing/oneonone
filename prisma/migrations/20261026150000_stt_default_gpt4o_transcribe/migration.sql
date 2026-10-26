-- Default transcription model for new installs. Existing rows keep whatever the admin chose.
ALTER TABLE "SystemSettings" ALTER COLUMN "whisperModel" SET DEFAULT 'gpt-4o-transcribe';
