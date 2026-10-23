-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('EMPLOYEE', 'REPORTER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('IN_PERSON', 'ZOOM');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('PROPOSED', 'SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TodoStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "TodoPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('UPLOADING', 'UPLOADED', 'TRANSCRIBING', 'ANALYZING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MEETING_REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'TODO_ASSIGNED', 'TODO_DUE_SOON', 'TODO_OVERDUE', 'FORM_SUBMITTED', 'FORM_REMINDER', 'RECORDING_READY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "WidgetType" AS ENUM ('UPCOMING_MEETINGS', 'PENDING_TODOS', 'RECENT_ACTIVITY', 'TEAM_OVERVIEW', 'QUICK_ACTIONS', 'MEETING_STATS', 'TODO_STATS', 'DEPARTMENT_SUMMARY');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'IMPORT', 'CLEAR_DATA', 'SETTINGS_CHANGE');

-- CreateEnum
CREATE TYPE "BackupType" AS ENUM ('FULL', 'PARTIAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "image" TEXT,
    "emailVerified" TIMESTAMP(3),
    "avatar" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE',
    "reportsToId" TEXT,
    "departmentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bio" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "country" TEXT,
    "timeZone" TEXT,
    "workDayStart" TEXT,
    "workDayEnd" TEXT,
    "kekaEmployeeId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "meetingDate" TIMESTAMP(3) NOT NULL,
    "checkInPersonal" TEXT,
    "checkInProfessional" TEXT,
    "priorityGoalProfessional" TEXT,
    "priorityGoalAgency" TEXT,
    "progressReport" TEXT,
    "goodNews" TEXT,
    "supportNeeded" TEXT,
    "priorityDiscussions" TEXT,
    "headsUp" TEXT,
    "anythingElse" TEXT,
    "formSubmittedAt" TIMESTAMP(3),
    "status" "MeetingStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "recurringScheduleId" TEXT,
    "meetingType" "MeetingType" NOT NULL DEFAULT 'IN_PERSON',
    "meetingLink" TEXT,
    "zoomMeetingId" TEXT,
    "reminder24hSent" BOOLEAN NOT NULL DEFAULT false,
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "formReminderSent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Todo" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT,
    "assignedToId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "priority" "TodoPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TodoStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Todo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "googleCalendarLink" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingRecording" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "audioUrl" TEXT,
    "audioKey" TEXT,
    "duration" INTEGER,
    "fileSize" INTEGER,
    "transcript" TEXT,
    "language" TEXT,
    "summary" TEXT,
    "keyPoints" JSONB,
    "autoTodos" JSONB,
    "sentiment" JSONB,
    "qualityScore" INTEGER,
    "qualityDetails" JSONB,
    "status" "RecordingStatus" NOT NULL DEFAULT 'UPLOADING',
    "errorMessage" TEXT,
    "recordedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'system',
    "openaiApiKey" TEXT,
    "openaiModel" TEXT NOT NULL DEFAULT 'gpt-4o',
    "whisperModel" TEXT NOT NULL DEFAULT 'whisper-1',
    "awsRegion" TEXT,
    "awsAccessKeyId" TEXT,
    "awsSecretKey" TEXT,
    "awsS3Bucket" TEXT,
    "maxRecordingMins" INTEGER NOT NULL DEFAULT 25,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "enableEmailReminders" BOOLEAN NOT NULL DEFAULT true,
    "reminderHoursBefore" INTEGER NOT NULL DEFAULT 24,
    "requireFormBeforeComplete" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringSchedule" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL DEFAULT 'BIWEEKLY',
    "dayOfWeek" INTEGER NOT NULL,
    "timeOfDay" TEXT NOT NULL,
    "meetingType" "MeetingType" NOT NULL DEFAULT 'IN_PERSON',
    "meetingLink" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "nextMeetingDate" TIMESTAMP(3),
    "lastGeneratedAt" TIMESTAMP(3),
    "googleRecurringEventId" TEXT,
    "googleCalendarLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "s3Url" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardWidget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "widgetType" "WidgetType" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardWidget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupHistory" (
    "id" TEXT NOT NULL,
    "type" "BackupType" NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
    "fileName" TEXT,
    "fileSize" INTEGER,
    "s3Key" TEXT,
    "tables" JSONB,
    "recordCount" JSONB,
    "createdBy" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BackupHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_reportsToId_idx" ON "User"("reportsToId");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE INDEX "Meeting_employeeId_idx" ON "Meeting"("employeeId");

-- CreateIndex
CREATE INDEX "Meeting_reporterId_idx" ON "Meeting"("reporterId");

-- CreateIndex
CREATE INDEX "Meeting_meetingDate_idx" ON "Meeting"("meetingDate");

-- CreateIndex
CREATE INDEX "Meeting_status_idx" ON "Meeting"("status");

-- CreateIndex
CREATE INDEX "Meeting_recurringScheduleId_idx" ON "Meeting"("recurringScheduleId");

-- CreateIndex
CREATE INDEX "Meeting_zoomMeetingId_idx" ON "Meeting"("zoomMeetingId");

-- CreateIndex
CREATE INDEX "Todo_assignedToId_idx" ON "Todo"("assignedToId");

-- CreateIndex
CREATE INDEX "Todo_createdById_idx" ON "Todo"("createdById");

-- CreateIndex
CREATE INDEX "Todo_meetingId_idx" ON "Todo"("meetingId");

-- CreateIndex
CREATE INDEX "Todo_status_idx" ON "Todo"("status");

-- CreateIndex
CREATE INDEX "Todo_dueDate_idx" ON "Todo"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_meetingId_key" ON "CalendarEvent"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_googleEventId_key" ON "CalendarEvent"("googleEventId");

-- CreateIndex
CREATE INDEX "CalendarEvent_meetingId_idx" ON "CalendarEvent"("meetingId");

-- CreateIndex
CREATE INDEX "CalendarEvent_googleEventId_idx" ON "CalendarEvent"("googleEventId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRecording_meetingId_key" ON "MeetingRecording"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingRecording_meetingId_idx" ON "MeetingRecording"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingRecording_status_idx" ON "MeetingRecording"("status");

-- CreateIndex
CREATE INDEX "MeetingRecording_language_idx" ON "MeetingRecording"("language");

-- CreateIndex
CREATE INDEX "RecurringSchedule_reporterId_idx" ON "RecurringSchedule"("reporterId");

-- CreateIndex
CREATE INDEX "RecurringSchedule_employeeId_idx" ON "RecurringSchedule"("employeeId");

-- CreateIndex
CREATE INDEX "RecurringSchedule_isActive_idx" ON "RecurringSchedule"("isActive");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Attachment_meetingId_idx" ON "Attachment"("meetingId");

-- CreateIndex
CREATE INDEX "DashboardWidget_userId_idx" ON "DashboardWidget"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardWidget_userId_widgetType_key" ON "DashboardWidget"("userId", "widgetType");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "BackupHistory_status_idx" ON "BackupHistory"("status");

-- CreateIndex
CREATE INDEX "BackupHistory_startedAt_idx" ON "BackupHistory"("startedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_recurringScheduleId_fkey" FOREIGN KEY ("recurringScheduleId") REFERENCES "RecurringSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Todo" ADD CONSTRAINT "Todo_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Todo" ADD CONSTRAINT "Todo_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Todo" ADD CONSTRAINT "Todo_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

