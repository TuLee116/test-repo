-- CỤM DỰ ÁN: Khu vực → Cụm dự án → Dự án → Hợp đồng (VD cụm KV4-SB "SÂN BAY PHÚ QUỐC" gồm KV4-SB-01 … KV4-SB-07)
ALTER TABLE "ProjectSite" ADD COLUMN "cluster" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProjectSite" ADD COLUMN "clusterName" TEXT NOT NULL DEFAULT '';
CREATE INDEX "ProjectSite_cluster_idx" ON "ProjectSite"("cluster");
