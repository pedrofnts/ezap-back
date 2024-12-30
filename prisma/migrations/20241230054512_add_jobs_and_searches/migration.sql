-- CreateTable
CREATE TABLE "Search" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Search_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" SERIAL NOT NULL,
    "searchId" INTEGER NOT NULL,
    "cargo" TEXT NOT NULL,
    "empresa" TEXT NOT NULL,
    "cidade" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "dataPublicacao" TIMESTAMP(3),
    "nivel" TEXT,
    "tipo" TEXT NOT NULL,
    "salarioMinimo" DOUBLE PRECISION,
    "salarioMaximo" DOUBLE PRECISION,
    "isHomeOffice" BOOLEAN NOT NULL DEFAULT false,
    "isConfidential" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Search" ADD CONSTRAINT "Search_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "Search"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
