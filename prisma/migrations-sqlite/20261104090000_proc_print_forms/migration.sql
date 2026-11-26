-- Trường dữ liệu cho 3 biểu mẫu in Mua vật tư: Giấy đề xuất vật tư, Trình kí đơn hàng, Bảng kê chi tiết công nợ
ALTER TABLE "MaterialRequest" ADD COLUMN "contractNo" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MaterialRequest" ADD COLUMN "category" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MaterialRequest" ADD COLUMN "area" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MaterialRequestItem" ADD COLUMN "contractQty" REAL;
ALTER TABLE "MaterialRequestItem" ADD COLUMN "finalQty" REAL;
ALTER TABLE "MaterialRequestItem" ADD COLUMN "forecastQty" REAL;
ALTER TABLE "Payable" ADD COLUMN "periodFrom" DATETIME;
ALTER TABLE "Payable" ADD COLUMN "periodTo" DATETIME;
ALTER TABLE "Payable" ADD COLUMN "invoiceAdjust" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Payable" ADD COLUMN "advanceDeduct" REAL NOT NULL DEFAULT 0;
