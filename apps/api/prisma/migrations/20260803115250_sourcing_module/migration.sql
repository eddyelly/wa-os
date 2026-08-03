-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT,
    "market" TEXT,
    "address" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactNote" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcedItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceAmount" INTEGER NOT NULL,
    "priceCurrency" TEXT NOT NULL,
    "unit" TEXT,
    "moq" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcedItemImage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourcedItemId" TEXT NOT NULL,
    "mediaKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcedItemImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_organizationId_idx" ON "Supplier"("organizationId");

-- CreateIndex
CREATE INDEX "SourcedItem_organizationId_idx" ON "SourcedItem"("organizationId");

-- CreateIndex
CREATE INDEX "SourcedItem_supplierId_idx" ON "SourcedItem"("supplierId");

-- CreateIndex
CREATE INDEX "SourcedItemImage_organizationId_idx" ON "SourcedItemImage"("organizationId");

-- CreateIndex
CREATE INDEX "SourcedItemImage_sourcedItemId_idx" ON "SourcedItemImage"("sourcedItemId");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcedItem" ADD CONSTRAINT "SourcedItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcedItem" ADD CONSTRAINT "SourcedItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcedItemImage" ADD CONSTRAINT "SourcedItemImage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcedItemImage" ADD CONSTRAINT "SourcedItemImage_sourcedItemId_fkey" FOREIGN KEY ("sourcedItemId") REFERENCES "SourcedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
