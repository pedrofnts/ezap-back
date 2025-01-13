/*
  Warnings:

  - You are about to drop the column `asaasSubscriptionId` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `stripeSubscriptionId` on the `Subscription` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId]` on the table `Subscription` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,status]` on the table `Subscription` will be added. If there are existing duplicate values, this will fail.
  - Made the column `subscriptionId` on table `AsaasPayment` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `planId` to the `Subscription` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "AsaasPayment" DROP CONSTRAINT "AsaasPayment_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_asaasSubscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_stripeSubscriptionId_fkey";

-- DropIndex
DROP INDEX "Subscription_asaasSubscriptionId_key";

-- DropIndex
DROP INDEX "Subscription_stripeSubscriptionId_key";

-- AlterTable
ALTER TABLE "AsaasPayment" ALTER COLUMN "subscriptionId" SET NOT NULL;

-- AlterTable
ALTER TABLE "StripeSubscription" ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "asaasSubscriptionId",
DROP COLUMN "stripeSubscriptionId",
ADD COLUMN     "planId" TEXT NOT NULL,
ADD COLUMN     "trialEnd" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "features" TEXT[],
    "price" DOUBLE PRECISION NOT NULL,
    "interval" TEXT NOT NULL,
    "stripePriceId" TEXT,
    "asaasPlanId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_status_key" ON "Subscription"("userId", "status");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeSubscription" ADD CONSTRAINT "StripeSubscription_id_fkey" FOREIGN KEY ("id") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasSubscription" ADD CONSTRAINT "AsaasSubscription_id_fkey" FOREIGN KEY ("id") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasPayment" ADD CONSTRAINT "AsaasPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "AsaasSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
