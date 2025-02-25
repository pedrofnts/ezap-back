/*
  Warnings:

  - You are about to drop the column `currency` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `trialEnd` on the `Subscription` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Subscription_userId_status_key";

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "currency",
DROP COLUMN "trialEnd";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referral" TEXT;
