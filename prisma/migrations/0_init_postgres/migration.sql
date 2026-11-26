-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('VT', 'TB', 'NC');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'EDITOR',
    "procRoles" TEXT NOT NULL DEFAULT '',
    "apps" TEXT NOT NULL DEFAULT 'DTCP',
    "position" TEXT NOT NULL DEFAULT '',
    "dtcpPerms" TEXT NOT NULL DEFAULT '',
    "subRoles" TEXT NOT NULL DEFAULT '',
    "areas" TEXT NOT NULL DEFAULT '',
    "priceRoles" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginOtp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "sourceType" "CostCategory" NOT NULL,
    "groupLabel" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "projectId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectResourcePrice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectResourcePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "section" TEXT NOT NULL DEFAULT '',
    "subsection" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "fixedVT" DOUBLE PRECISION,
    "fixedTB" DOUBLE PRECISION,
    "fixedNC" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemAlias" (
    "id" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "workItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemResource" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "category" "CostCategory" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "quantityFormula" TEXT,
    "wastageRate" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "WorkItemResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "packageName" TEXT NOT NULL DEFAULT '',
    "investor" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "projectType" TEXT NOT NULL DEFAULT '',
    "packageType" TEXT NOT NULL DEFAULT 'THO',
    "laborByWork" BOOLEAN NOT NULL DEFAULT false,
    "area" TEXT NOT NULL DEFAULT '',
    "dtcpStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "dtcpTp" TEXT NOT NULL DEFAULT '{}',
    "dtcpNote" TEXT NOT NULL DEFAULT '',
    "contractNo" TEXT NOT NULL DEFAULT '',
    "dtcpQsttId" TEXT NOT NULL DEFAULT '',
    "dtcpQsttName" TEXT NOT NULL DEFAULT '',
    "dtcpTpKey" TEXT NOT NULL DEFAULT '',
    "dtcpSentAt" TIMESTAMP(3),
    "dtcpSubmittedBy" TEXT NOT NULL DEFAULT '',
    "dtcpSubmittedAt" TIMESTAMP(3),
    "dtcpApprovedBy" TEXT NOT NULL DEFAULT '',
    "dtcpApprovedAt" TIMESTAMP(3),
    "contractId" TEXT,
    "preparedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overheadRate" DOUBLE PRECISION NOT NULL DEFAULT 0.065,
    "taxableProfitRate" DOUBLE PRECISION NOT NULL DEFAULT 0.055,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "progress" TEXT NOT NULL DEFAULT '',
    "ncKhacRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tbRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mmtbRate" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoqItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workItemId" TEXT,
    "rawDescription" TEXT NOT NULL DEFAULT '',
    "rawUnit" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL,
    "isHeading" BOOLEAN NOT NULL DEFAULT false,
    "level" INTEGER,
    "stt" TEXT NOT NULL DEFAULT '',
    "sheetId" TEXT,
    "method" TEXT NOT NULL DEFAULT 'DETAIL',
    "quotedUnitPrice" DOUBLE PRECISION,
    "directMode" TEXT,
    "directPct" DOUBLE PRECISION,
    "directBaseId" TEXT,
    "directLink" TEXT,
    "quotedMode" TEXT,
    "quotedPct" DOUBLE PRECISION,
    "quotedBaseId" TEXT,
    "quotedLink" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoqItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoqImage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'image/jpeg',
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoqImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtherCostItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtherCostItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubcontractorItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contractorName" TEXT NOT NULL DEFAULT '',
    "boqItemId" TEXT,
    "followBoq" BOOLEAN NOT NULL DEFAULT false,
    "coverVT" BOOLEAN NOT NULL DEFAULT true,
    "coverTB" BOOLEAN NOT NULL DEFAULT true,
    "coverNC" BOOLEAN NOT NULL DEFAULT true,
    "percent" DOUBLE PRECISION,
    "assignId" TEXT,
    "fromHeadingId" TEXT,
    "coveredLines" TEXT,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quotedPct" DOUBLE PRECISION,
    "mgmtVtPct" DOUBLE PRECISION,
    "mgmtTbPct" DOUBLE PRECISION,
    "prelimPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "groupId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubcontractorItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubcontractorNameToggle" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "showInDtcp" BOOLEAN NOT NULL DEFAULT true,
    "mgmtVtPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mgmtTbPct" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "SubcontractorNameToggle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DtcpLine" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "section" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "linkSource" TEXT NOT NULL DEFAULT '',
    "manualAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "formula" TEXT NOT NULL DEFAULT '',
    "nameLocked" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DtcpLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DtcpColumn" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DtcpColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DtcpCell" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "formula" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "DtcpCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectResourceWastage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ProjectResourceWastage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VtGroup" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'VT',
    "projectId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "showInDtcp" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "VtGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VtPlacement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'VT',
    "section" TEXT NOT NULL DEFAULT 'B',
    "groupId" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 1000000,
    "note" TEXT NOT NULL DEFAULT '',
    "mgmtVtPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mgmtTbPct" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "VtPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetManualItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NC',
    "groupId" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calcId" TEXT,
    "days" DOUBLE PRECISION,
    "note" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SheetManualItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "workItemCode" TEXT NOT NULL,
    "workItemName" TEXT NOT NULL,
    "resourceIds" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'NORM',
    "lineIds" TEXT NOT NULL DEFAULT '',
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedByName" TEXT NOT NULL DEFAULT '',
    "rejected" BOOLEAN NOT NULL DEFAULT false,
    "rejectReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "CatalogChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSheet" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BOQ',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "colTitles" TEXT NOT NULL DEFAULT '[]',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "amountCol" INTEGER,
    "merges" TEXT NOT NULL DEFAULT '[]',
    "autoStt" BOOLEAN,
    "headerRows" TEXT NOT NULL DEFAULT '[]',
    "linkCol" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GridCell" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "col" INTEGER NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "style" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "GridCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GridRowMeta" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "stt" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "showInDtcp" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GridRowMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldFormula" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "formula" TEXT NOT NULL,

    CONSTRAINT "FieldFormula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoqLineResourceSwap" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,

    CONSTRAINT "BoqLineResourceSwap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoqLineQty" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "formula" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "BoqLineQty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ProcMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxCode" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "bankAccount" TEXT NOT NULL DEFAULT '',
    "bankName" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "neededDate" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "contractNo" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "area" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedByName" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3),
    "rejectReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "resourceId" TEXT,
    "name" TEXT NOT NULL,
    "spec" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "contractQty" DOUBLE PRECISION,
    "finalQty" DOUBLE PRECISION,
    "forecastQty" DOUBLE PRECISION,

    CONSTRAINT "MaterialRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "deliveryPlace" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "submittedByName" TEXT NOT NULL DEFAULT '',
    "approvedByName" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT NOT NULL DEFAULT '',
    "rejectReason" TEXT NOT NULL DEFAULT '',
    "orderedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "requestItemId" TEXT,
    "name" TEXT NOT NULL,
    "spec" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "selectedQuoteId" TEXT,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quoteDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "deliveryTerms" TEXT NOT NULL DEFAULT '',
    "paymentTerms" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL,
    "deliveryNoteNo" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payable" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "dueDate" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "invoiceAdjust" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "advanceDeduct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayableLine" (
    "id" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "receiptLineId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "vatRate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PayableLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'RENT',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "supplierPrices" TEXT NOT NULL DEFAULT '{}',
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceManual" BOOLEAN NOT NULL DEFAULT false,
    "buyPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lossPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipCalc" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" TEXT NOT NULL DEFAULT '{}',
    "groupId" TEXT,
    "ncGroupId" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipCalc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSubmission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contractId" TEXT,
    "totalFormulas" TEXT NOT NULL DEFAULT '{}',
    "totalAmounts" TEXT NOT NULL DEFAULT '{}',
    "dtcpLater" BOOLEAN NOT NULL DEFAULT false,
    "crewName" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "projectName" TEXT NOT NULL DEFAULT '',
    "contractNo" TEXT NOT NULL DEFAULT '',
    "projectCode" TEXT NOT NULL DEFAULT '',
    "itemName" TEXT NOT NULL DEFAULT '',
    "quoteStatus" TEXT NOT NULL DEFAULT '',
    "batch" TEXT NOT NULL DEFAULT '',
    "batchDate" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL DEFAULT '',
    "fileData" BYTEA,
    "fileFromId" TEXT,
    "sheetName" TEXT NOT NULL DEFAULT '',
    "colMap" TEXT NOT NULL DEFAULT '{}',
    "headRows" TEXT NOT NULL DEFAULT '{}',
    "category" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "qsNote" TEXT NOT NULL DEFAULT '',
    "tpNote" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedByName" TEXT NOT NULL DEFAULT '',
    "reviewedAt" TIMESTAMP(3),
    "mailTo" TEXT NOT NULL DEFAULT '',
    "mailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceLine" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "sourceRow" INTEGER NOT NULL DEFAULT 0,
    "level" TEXT NOT NULL DEFAULT 'ITEM',
    "stt" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "qty" DOUBLE PRECISION,
    "cdtPrice" DOUBLE PRECISION,
    "cdtAmount" DOUBLE PRECISION,
    "basePrice" DOUBLE PRECISION,
    "baseAmount" DOUBLE PRECISION,
    "baseNote" TEXT NOT NULL DEFAULT '',
    "siteOpinion" TEXT NOT NULL DEFAULT '',
    "sitePrice" DOUBLE PRECISION,
    "siteAmount" DOUBLE PRECISION,
    "siteNote" TEXT NOT NULL DEFAULT '',
    "ptOpinion" TEXT NOT NULL DEFAULT '',
    "ptPrice" DOUBLE PRECISION,
    "ptAmount" DOUBLE PRECISION,
    "ptNote" TEXT NOT NULL DEFAULT '',
    "qsNote" TEXT NOT NULL DEFAULT '',
    "tpPrice" DOUBLE PRECISION,
    "tpOk" BOOLEAN NOT NULL DEFAULT true,
    "tpNote" TEXT NOT NULL DEFAULT '',
    "tpAmount" DOUBLE PRECISION,
    "lineKey" TEXT NOT NULL DEFAULT '',
    "overReason" TEXT NOT NULL DEFAULT '',
    "formulas" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "PriceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostContract" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT '',
    "packageName" TEXT NOT NULL DEFAULT '',
    "contractNo" TEXT NOT NULL DEFAULT '',
    "appendixNo" TEXT NOT NULL DEFAULT '',
    "appendixOfId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'EXCEL',
    "projectId" TEXT,
    "fileName" TEXT NOT NULL DEFAULT '',
    "sheetMap" TEXT NOT NULL DEFAULT '{}',
    "versions" TEXT NOT NULL DEFAULT '[]',
    "approvedVersion" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "linkInfo" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "CostContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostFile" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostSheet" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "rows" TEXT NOT NULL DEFAULT '[]',
    "truncated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CostSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostLine" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'ITEM',
    "stt" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "qty" DOUBLE PRECISION,
    "prices" TEXT NOT NULL DEFAULT '{}',
    "amount" DOUBLE PRECISION,
    "note" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL,
    "sourceRow" INTEGER NOT NULL DEFAULT 0,
    "extra" BOOLEAN NOT NULL DEFAULT false,
    "vatPct" DOUBLE PRECISION,

    CONSTRAINT "CostLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovedPrice" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NC',
    "contractId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "crew" TEXT NOT NULL DEFAULT '',
    "price" DOUBLE PRECISION NOT NULL,
    "qty" DOUBLE PRECISION,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "approvedByName" TEXT NOT NULL DEFAULT '',
    "submissionId" TEXT NOT NULL,
    "submissionCode" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "batch" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ApprovedPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceMatch" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "srcKey" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,

    CONSTRAINT "PriceMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubProposal" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "contractId" TEXT,
    "area" TEXT NOT NULL DEFAULT '',
    "projectName" TEXT NOT NULL DEFAULT '',
    "projectCode" TEXT NOT NULL DEFAULT '',
    "cdtContract" TEXT NOT NULL DEFAULT '',
    "itemName" TEXT NOT NULL DEFAULT '',
    "bidders" TEXT NOT NULL DEFAULT '[]',
    "selectedBidder" TEXT NOT NULL DEFAULT '',
    "subName" TEXT NOT NULL DEFAULT '',
    "prelim" TEXT NOT NULL DEFAULT '{}',
    "vat" TEXT NOT NULL DEFAULT '{}',
    "terms" TEXT NOT NULL DEFAULT '[]',
    "vatRows" TEXT NOT NULL DEFAULT '[]',
    "extraRows" TEXT NOT NULL DEFAULT '[]',
    "totalFormulas" TEXT NOT NULL DEFAULT '{}',
    "totalAmounts" TEXT NOT NULL DEFAULT '{}',
    "scope" TEXT NOT NULL DEFAULT '[]',
    "fileName" TEXT NOT NULL DEFAULT '',
    "fileData" BYTEA,
    "sheetName" TEXT NOT NULL DEFAULT '',
    "colMap" TEXT NOT NULL DEFAULT '{}',
    "headRows" TEXT NOT NULL DEFAULT '{}',
    "category" TEXT NOT NULL DEFAULT '',
    "branch" TEXT NOT NULL DEFAULT '',
    "branchReason" TEXT NOT NULL DEFAULT '',
    "priceMode" TEXT NOT NULL DEFAULT '',
    "isMep" BOOLEAN NOT NULL DEFAULT false,
    "mepTemp" BOOLEAN NOT NULL DEFAULT false,
    "isNt" BOOLEAN NOT NULL DEFAULT false,
    "oneQty" BOOLEAN NOT NULL DEFAULT false,
    "hdtpNo" TEXT NOT NULL DEFAULT '',
    "plKind" TEXT NOT NULL DEFAULT '',
    "proposalType" TEXT NOT NULL DEFAULT '',
    "awardForm" TEXT NOT NULL DEFAULT '',
    "vtValue" DOUBLE PRECISION,
    "tbValue" DOUBLE PRECISION,
    "otherValue" DOUBLE PRECISION,
    "hdtpId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "qsNote" TEXT NOT NULL DEFAULT '',
    "tpNote" TEXT NOT NULL DEFAULT '',
    "ptgNote" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "tpByName" TEXT NOT NULL DEFAULT '',
    "tpAt" TIMESTAMP(3),
    "ptgByName" TEXT NOT NULL DEFAULT '',
    "ptgAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3),
    "hdNo" TEXT NOT NULL DEFAULT '',
    "hdAt" TIMESTAMP(3),
    "mailTo" TEXT NOT NULL DEFAULT '',
    "mailSentAt" TIMESTAMP(3),
    "makerSeenAt" TIMESTAMP(3),
    "infoRequest" TEXT NOT NULL DEFAULT '',
    "infoReply" TEXT NOT NULL DEFAULT '',
    "infoNotice" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubLine" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "sourceRow" INTEGER NOT NULL DEFAULT 0,
    "level" TEXT NOT NULL DEFAULT 'ITEM',
    "stt" TEXT NOT NULL DEFAULT '',
    "workName" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "dims" TEXT NOT NULL DEFAULT '',
    "material" TEXT NOT NULL DEFAULT '',
    "dimL" TEXT NOT NULL DEFAULT '',
    "dimW" TEXT NOT NULL DEFAULT '',
    "dimH" TEXT NOT NULL DEFAULT '',
    "cdtQty" DOUBLE PRECISION,
    "cdtPrice" DOUBLE PRECISION,
    "baseQty" DOUBLE PRECISION,
    "basePrice" DOUBLE PRECISION,
    "bids" TEXT NOT NULL DEFAULT '{}',
    "propQty" DOUBLE PRECISION,
    "propPrice" DOUBLE PRECISION,
    "cdtVt" DOUBLE PRECISION,
    "cdtNc" DOUBLE PRECISION,
    "cdtKh" DOUBLE PRECISION,
    "noMgmt" BOOLEAN NOT NULL DEFAULT false,
    "baseVt" DOUBLE PRECISION,
    "baseNc" DOUBLE PRECISION,
    "baseTb" DOUBLE PRECISION,
    "propVt" DOUBLE PRECISION,
    "propNc" DOUBLE PRECISION,
    "propTb" DOUBLE PRECISION,
    "hdQty" DOUBLE PRECISION,
    "hdPrice" DOUBLE PRECISION,
    "cdtHdQty" DOUBLE PRECISION,
    "cdtHdPrice" DOUBLE PRECISION,
    "baseHdQty" DOUBLE PRECISION,
    "baseHdPrice" DOUBLE PRECISION,
    "note" TEXT NOT NULL DEFAULT '',
    "lineKey" TEXT NOT NULL DEFAULT '',
    "qsNote" TEXT NOT NULL DEFAULT '',
    "tpPrice" DOUBLE PRECISION,
    "tpOk" BOOLEAN NOT NULL DEFAULT true,
    "tpNote" TEXT NOT NULL DEFAULT '',
    "formulas" TEXT NOT NULL DEFAULT '{}',
    "baseManual" BOOLEAN NOT NULL DEFAULT false,
    "baseNote" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "SubLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubLineImage" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'image/jpeg',
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubLineImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "page" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTicket" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "chatId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "proposal" TEXT NOT NULL DEFAULT '',
    "page" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenByUser" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AiTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CellNote" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "colKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CellNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "LoginOtp_userId_idx" ON "LoginOtp"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_code_key" ON "Resource"("code");

-- CreateIndex
CREATE INDEX "Resource_projectId_idx" ON "Resource"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectResourcePrice_projectId_resourceId_key" ON "ProjectResourcePrice"("projectId", "resourceId");

-- CreateIndex
CREATE INDEX "WorkItem_code_idx" ON "WorkItem"("code");

-- CreateIndex
CREATE INDEX "WorkItem_section_subsection_idx" ON "WorkItem"("section", "subsection");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemAlias_normalizedText_key" ON "WorkItemAlias"("normalizedText");

-- CreateIndex
CREATE INDEX "WorkItemResource_workItemId_idx" ON "WorkItemResource"("workItemId");

-- CreateIndex
CREATE INDEX "WorkItemResource_resourceId_idx" ON "WorkItemResource"("resourceId");

-- CreateIndex
CREATE INDEX "Project_contractId_idx" ON "Project"("contractId");

-- CreateIndex
CREATE INDEX "BoqItem_projectId_idx" ON "BoqItem"("projectId");

-- CreateIndex
CREATE INDEX "BoqImage_boqItemId_idx" ON "BoqImage"("boqItemId");

-- CreateIndex
CREATE INDEX "BoqImage_projectId_idx" ON "BoqImage"("projectId");

-- CreateIndex
CREATE INDEX "OtherCostItem_projectId_idx" ON "OtherCostItem"("projectId");

-- CreateIndex
CREATE INDEX "SubcontractorItem_assignId_idx" ON "SubcontractorItem"("assignId");

-- CreateIndex
CREATE INDEX "SubcontractorItem_boqItemId_idx" ON "SubcontractorItem"("boqItemId");

-- CreateIndex
CREATE INDEX "SubcontractorItem_projectId_idx" ON "SubcontractorItem"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SubcontractorNameToggle_projectId_name_key" ON "SubcontractorNameToggle"("projectId", "name");

-- CreateIndex
CREATE INDEX "DtcpLine_projectId_idx" ON "DtcpLine"("projectId");

-- CreateIndex
CREATE INDEX "DtcpColumn_projectId_idx" ON "DtcpColumn"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DtcpCell_lineId_columnId_key" ON "DtcpCell"("lineId", "columnId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectResourceWastage_projectId_resourceId_key" ON "ProjectResourceWastage"("projectId", "resourceId");

-- CreateIndex
CREATE INDEX "VtGroup_projectId_idx" ON "VtGroup"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "VtPlacement_projectId_resourceId_kind_key" ON "VtPlacement"("projectId", "resourceId", "kind");

-- CreateIndex
CREATE INDEX "SheetManualItem_projectId_idx" ON "SheetManualItem"("projectId");

-- CreateIndex
CREATE INDEX "CatalogChange_reviewed_idx" ON "CatalogChange"("reviewed");

-- CreateIndex
CREATE INDEX "ProjectSheet_projectId_idx" ON "ProjectSheet"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "GridCell_sheetId_row_col_key" ON "GridCell"("sheetId", "row", "col");

-- CreateIndex
CREATE UNIQUE INDEX "GridRowMeta_sheetId_row_key" ON "GridRowMeta"("sheetId", "row");

-- CreateIndex
CREATE UNIQUE INDEX "FieldFormula_projectId_kind_targetId_field_key" ON "FieldFormula"("projectId", "kind", "targetId", "field");

-- CreateIndex
CREATE UNIQUE INDEX "BoqLineResourceSwap_boqItemId_lineId_key" ON "BoqLineResourceSwap"("boqItemId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "BoqLineQty_boqItemId_lineId_key" ON "BoqLineQty"("boqItemId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcMember_projectId_userId_key" ON "ProcMember"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialRequest_code_key" ON "MaterialRequest"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_code_key" ON "PurchaseOrder"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_orderId_supplierId_key" ON "Quotation"("orderId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationLine_quotationId_itemId_key" ON "QuotationLine"("quotationId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_code_key" ON "GoodsReceipt"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Payable_code_key" ON "Payable"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PayableLine_receiptLineId_key" ON "PayableLine"("receiptLineId");

-- CreateIndex
CREATE INDEX "ProcLog_entity_entityId_idx" ON "ProcLog"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipItem_code_key" ON "EquipItem"("code");

-- CreateIndex
CREATE INDEX "EquipCalc_projectId_idx" ON "EquipCalc"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceSubmission_code_key" ON "PriceSubmission"("code");

-- CreateIndex
CREATE INDEX "PriceSubmission_status_idx" ON "PriceSubmission"("status");

-- CreateIndex
CREATE INDEX "PriceLine_submissionId_idx" ON "PriceLine"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "CostFile_contractId_key" ON "CostFile"("contractId");

-- CreateIndex
CREATE INDEX "CostSheet_contractId_role_idx" ON "CostSheet"("contractId", "role");

-- CreateIndex
CREATE INDEX "CostLine_contractId_kind_idx" ON "CostLine"("contractId", "kind");

-- CreateIndex
CREATE INDEX "ApprovedPrice_contractId_lineKey_idx" ON "ApprovedPrice"("contractId", "lineKey");

-- CreateIndex
CREATE UNIQUE INDEX "PriceMatch_contractId_srcKey_key" ON "PriceMatch"("contractId", "srcKey");

-- CreateIndex
CREATE UNIQUE INDEX "SubProposal_code_key" ON "SubProposal"("code");

-- CreateIndex
CREATE INDEX "SubProposal_status_idx" ON "SubProposal"("status");

-- CreateIndex
CREATE INDEX "SubLine_proposalId_idx" ON "SubLine"("proposalId");

-- CreateIndex
CREATE INDEX "SubLineImage_lineId_idx" ON "SubLineImage"("lineId");

-- CreateIndex
CREATE INDEX "SubLineImage_proposalId_idx" ON "SubLineImage"("proposalId");

-- CreateIndex
CREATE INDEX "AiChat_userId_createdAt_idx" ON "AiChat"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiMessage_chatId_createdAt_idx" ON "AiMessage"("chatId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiTicket_code_key" ON "AiTicket"("code");

-- CreateIndex
CREATE INDEX "AiTicket_status_createdAt_idx" ON "AiTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiTicket_userId_idx" ON "AiTicket"("userId");

-- CreateIndex
CREATE INDEX "CellNote_entity_entityId_idx" ON "CellNote"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "LoginOtp" ADD CONSTRAINT "LoginOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectResourcePrice" ADD CONSTRAINT "ProjectResourcePrice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectResourcePrice" ADD CONSTRAINT "ProjectResourcePrice_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemAlias" ADD CONSTRAINT "WorkItemAlias_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemResource" ADD CONSTRAINT "WorkItemResource_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemResource" ADD CONSTRAINT "WorkItemResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "ProjectSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqImage" ADD CONSTRAINT "BoqImage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqImage" ADD CONSTRAINT "BoqImage_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherCostItem" ADD CONSTRAINT "OtherCostItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorItem" ADD CONSTRAINT "SubcontractorItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorItem" ADD CONSTRAINT "SubcontractorItem_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorNameToggle" ADD CONSTRAINT "SubcontractorNameToggle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DtcpLine" ADD CONSTRAINT "DtcpLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DtcpColumn" ADD CONSTRAINT "DtcpColumn_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DtcpCell" ADD CONSTRAINT "DtcpCell_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "DtcpLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DtcpCell" ADD CONSTRAINT "DtcpCell_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "DtcpColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectResourceWastage" ADD CONSTRAINT "ProjectResourceWastage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VtGroup" ADD CONSTRAINT "VtGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VtPlacement" ADD CONSTRAINT "VtPlacement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetManualItem" ADD CONSTRAINT "SheetManualItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSheet" ADD CONSTRAINT "ProjectSheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GridCell" ADD CONSTRAINT "GridCell_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "ProjectSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GridRowMeta" ADD CONSTRAINT "GridRowMeta_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "ProjectSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldFormula" ADD CONSTRAINT "FieldFormula_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqLineResourceSwap" ADD CONSTRAINT "BoqLineResourceSwap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqLineResourceSwap" ADD CONSTRAINT "BoqLineResourceSwap_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqLineQty" ADD CONSTRAINT "BoqLineQty_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqLineQty" ADD CONSTRAINT "BoqLineQty_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcMember" ADD CONSTRAINT "ProcMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestItem" ADD CONSTRAINT "MaterialRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "MaterialRequestItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayableLine" ADD CONSTRAINT "PayableLine_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "Payable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayableLine" ADD CONSTRAINT "PayableLine_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "GoodsReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "Payable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipCalc" ADD CONSTRAINT "EquipCalc_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSubmission" ADD CONSTRAINT "PriceSubmission_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceLine" ADD CONSTRAINT "PriceLine_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "PriceSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostFile" ADD CONSTRAINT "CostFile_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostSheet" ADD CONSTRAINT "CostSheet_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLine" ADD CONSTRAINT "CostLine_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovedPrice" ADD CONSTRAINT "ApprovedPrice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceMatch" ADD CONSTRAINT "PriceMatch_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubProposal" ADD CONSTRAINT "SubProposal_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubLine" ADD CONSTRAINT "SubLine_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "SubProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubLineImage" ADD CONSTRAINT "SubLineImage_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "SubLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "AiChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTicket" ADD CONSTRAINT "AiTicket_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "AiChat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

