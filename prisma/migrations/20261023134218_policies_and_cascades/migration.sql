/*
  Warnings:

  - You are about to drop the `DashboardWidget` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "CancelPolicy" AS ENUM ('ADMIN_ONLY', 'REPORTER_AND_ADMIN', 'ANY_PARTICIPANT');

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "DashboardWidget" DROP CONSTRAINT "DashboardWidget_userId_fkey";

-- DropForeignKey
ALTER TABLE "RecurringSchedule" DROP CONSTRAINT "RecurringSchedule_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "RecurringSchedule" DROP CONSTRAINT "RecurringSchedule_reporterId_fkey";

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "cancelPolicy" "CancelPolicy" NOT NULL DEFAULT 'REPORTER_AND_ADMIN',
ADD COLUMN     "employeeCanViewNotes" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "employeeCanViewRecording" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shortReminderHoursBefore" INTEGER NOT NULL DEFAULT 1;

-- DropTable
DROP TABLE "DashboardWidget";

-- DropEnum
DROP TYPE "WidgetType";

-- AddForeignKey
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
