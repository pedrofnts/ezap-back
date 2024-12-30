-- CreateTable
CREATE TABLE "JobFavorite" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobFavorite_jobId_userId_key" ON "JobFavorite"("jobId", "userId");

-- AddForeignKey
ALTER TABLE "JobFavorite" ADD CONSTRAINT "JobFavorite_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobFavorite" ADD CONSTRAINT "JobFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
