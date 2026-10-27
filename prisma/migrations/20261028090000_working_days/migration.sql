-- Working days policy (Admin → Settings → Policies). 0 = Sunday … 6 = Saturday; default Mon–Fri.
ALTER TABLE "SystemSettings" ADD COLUMN     "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];
