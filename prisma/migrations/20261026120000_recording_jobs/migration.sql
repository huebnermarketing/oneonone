-- CreateEnum
CREATE TYPE "RecordingJobKind" AS ENUM ('PROCESS', 'REPROCESS');

-- CreateEnum
CREATE TYPE "RecordingStage" AS ENUM ('COMBINE', 'TRANSCRIBE', 'ANALYZE', 'DONE');

-- CreateEnum
CREATE TYPE "RecordingJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "RecordingJob" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "kind" "RecordingJobKind" NOT NULL,
    "fromStage" "RecordingStage" NOT NULL,
    "stage" "RecordingStage" NOT NULL DEFAULT 'COMBINE',
    "status" "RecordingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "totalChunks" INTEGER,
    "language" TEXT,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordingJob_recordingId_idx" ON "RecordingJob"("recordingId");

-- CreateIndex
CREATE INDEX "RecordingJob_meetingId_idx" ON "RecordingJob"("meetingId");

-- CreateIndex
CREATE INDEX "RecordingJob_status_idx" ON "RecordingJob"("status");

-- AddForeignKey
ALTER TABLE "RecordingJob" ADD CONSTRAINT "RecordingJob_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "MeetingRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingJob" ADD CONSTRAINT "RecordingJob_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

