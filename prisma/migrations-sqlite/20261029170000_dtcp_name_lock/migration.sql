-- Dòng DT-CP người dùng đã tự đặt tên: đồng bộ không ghi đè
ALTER TABLE "DtcpLine" ADD COLUMN "nameLocked" BOOLEAN NOT NULL DEFAULT false;
