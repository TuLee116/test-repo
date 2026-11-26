-- Loại gói thầu: THO | HOAN_THIEN | NOI_THAT | MEP | TONG_THAU (dự án có sẵn = Phần Thô)
ALTER TABLE "Project" ADD COLUMN "packageType" TEXT NOT NULL DEFAULT 'THO';
