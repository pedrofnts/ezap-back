-- CreateTable
CREATE TABLE "AsaasCustomer" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "asaasCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsaasPayment" (
    "id" SERIAL NOT NULL,
    "asaasPaymentId" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "billingType" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "invoiceUrl" TEXT,
    "pixQrCodeUrl" TEXT,
    "pixKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AsaasCustomer_userId_key" ON "AsaasCustomer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AsaasCustomer_asaasCustomerId_key" ON "AsaasCustomer"("asaasCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "AsaasPayment_asaasPaymentId_key" ON "AsaasPayment"("asaasPaymentId");

-- AddForeignKey
ALTER TABLE "AsaasCustomer" ADD CONSTRAINT "AsaasCustomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasPayment" ADD CONSTRAINT "AsaasPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "AsaasCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
