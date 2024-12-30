/*
  Warnings:

  - A unique constraint covering the columns `[supabase_uid]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `supabase_uid` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "supabase_uid" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_supabase_uid_key" ON "User"("supabase_uid");
