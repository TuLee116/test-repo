-- Thời gian thuê của dòng tự thêm; đầu mục nhân công của bản tính thiết bị
ALTER TABLE "SheetManualItem" ADD COLUMN "days" REAL;
ALTER TABLE "EquipCalc" ADD COLUMN "ncGroupId" TEXT;
