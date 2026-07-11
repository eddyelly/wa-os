-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "modules" TEXT[] DEFAULT ARRAY['appointments']::TEXT[];
