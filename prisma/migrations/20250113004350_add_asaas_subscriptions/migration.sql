-- AlterTable
ALTER TABLE "AsaasPayment" ADD COLUMN     "subscriptionId" INTEGER;

-- CreateTable
CREATE TABLE "AsaasSubscription" (
    "id" SERIAL NOT NULL,
    "asaasSubscriptionId" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "cycle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AsaasSubscription_asaasSubscriptionId_key" ON "AsaasSubscription"("asaasSubscriptionId");

-- AddForeignKey
ALTER TABLE "AsaasSubscription" ADD CONSTRAINT "AsaasSubscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "AsaasCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasPayment" ADD CONSTRAINT "AsaasPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "AsaasSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
