-- Keka employee sync: HR fields owned by Keka + sync bookkeeping
ALTER TABLE "User" ADD COLUMN "employeeNumber" TEXT;
ALTER TABLE "User" ADD COLUMN "joiningDate" DATE;
ALTER TABLE "User" ADD COLUMN "kekaSyncedAt" TIMESTAMP(3);
ALTER TABLE "SystemSettings" ADD COLUMN "kekaLastSyncAt" TIMESTAMP(3);
