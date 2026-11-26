-- HỢP ĐỒNG THEO BẢNG TT DỰ ÁN: Khu vực → Cụm → Dự án → HỢP ĐỒNG (VD KV4-SB-02.04 · HĐ 324/2026/HĐ/PCC-TMN)
CREATE TABLE "SiteContract" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "contractNo" TEXT NOT NULL DEFAULT '',
    "noKey" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SiteContract_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteContract_siteId_idx" ON "SiteContract"("siteId");
CREATE INDEX "SiteContract_noKey_idx" ON "SiteContract"("noKey");
ALTER TABLE "SiteContract" ADD CONSTRAINT "SiteContract_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ProjectSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
