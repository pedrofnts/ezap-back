-- CreateTable
CREATE TABLE "JobView" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobView_jobId_userId_key" ON "JobView"("jobId", "userId");

-- AddForeignKey
ALTER TABLE "JobView" ADD CONSTRAINT "JobView_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobView" ADD CONSTRAINT "JobView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
