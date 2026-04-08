-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "googleCalendarEventId" TEXT;

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "googleAccessToken" TEXT,
ADD COLUMN     "googleCalendarId" TEXT,
ADD COLUMN     "googleRefreshToken" TEXT,
ADD COLUMN     "googleTokenExpiry" TIMESTAMP(3);
