-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "notificationTime" TEXT NOT NULL DEFAULT 'instant',
ADD COLUMN     "notifications" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "whatsappActive" BOOLEAN NOT NULL DEFAULT true;
