import ExcelJS from "exceljs";
import { mkdtemp, rm } from "node:fs/promises";
import { finished } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../shared/errors.js";
import { safeWorksheetName, toExcelValue } from "./export.utils.js";

const BATCH_SIZE = 500;
const MAX_WORKSHEET_ROWS = 1_048_576;

type ExportRecord = Record<string, unknown>;
type ModelDelegate = {
  findMany(args: {
    skip: number;
    take: number;
    orderBy: { id: "asc" };
    select: Record<string, true>;
  }): Promise<ExportRecord[]>;
};

// Keep this registry aligned with the scalar fields in prisma/schema.prisma.
// Explicit fields avoid relying on undocumented Prisma runtime metadata.
const MODEL_REGISTRY = [
  {
    name: "User",
    delegate: "user",
    columns: [
      "id",
      "name",
      "email",
      "passwordHash",
      "role",
      "active",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    name: "Product",
    delegate: "product",
    columns: [
      "id",
      "name",
      "brandId",
      "unitId",
      "sellingPrice",
      "mrp",
      "currentStock",
      "active",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    name: "Brand",
    delegate: "brand",
    columns: ["id", "name", "active", "createdAt", "updatedAt"],
  },
  {
    name: "Unit",
    delegate: "unit",
    columns: [
      "id",
      "name",
      "symbol",
      "active",
      "allowsDecimals",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    name: "StockMovement",
    delegate: "stockMovement",
    columns: [
      "id",
      "productId",
      "type",
      "direction",
      "quantity",
      "stockAfter",
      "reason",
      "notes",
      "createdById",
      "createdAt",
    ],
  },
  {
    name: "Customer",
    delegate: "customer",
    columns: [
      "id",
      "name",
      "phone",
      "address",
      "active",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    name: "Supplier",
    delegate: "supplier",
    columns: [
      "id",
      "name",
      "phone",
      "address",
      "active",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    name: "Sale",
    delegate: "sale",
    columns: [
      "id",
      "invoiceNumber",
      "customerId",
      "billDate",
      "subtotal",
      "discountAmount",
      "totalAmount",
      "status",
      "paymentStatus",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    name: "Coupon",
    delegate: "coupon",
    columns: [
      "id",
      "code",
      "price",
      "isSaleBased",
      "saleId",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    name: "SaleItem",
    delegate: "saleItem",
    columns: [
      "id",
      "saleId",
      "productId",
      "quantity",
      "unitSellingPrice",
      "discountAmount",
      "lineTotal",
      "historicalCostSnapshot",
    ],
  },
  {
    name: "CustomerPayment",
    delegate: "customerPayment",
    columns: [
      "id",
      "customerId",
      "saleId",
      "amount",
      "paymentDate",
      "method",
      "notes",
      "createdAt",
    ],
  },
  {
    name: "Purchase",
    delegate: "purchase",
    columns: [
      "id",
      "purchaseNumber",
      "supplierId",
      "supplierInvoiceNumber",
      "purchaseDate",
      "subtotal",
      "discountAmount",
      "totalAmount",
      "status",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    name: "PurchaseItem",
    delegate: "purchaseItem",
    columns: [
      "id",
      "purchaseId",
      "productId",
      "quantity",
      "supplierRate",
      "lineTotal",
    ],
  },
  {
    name: "SupplierPayment",
    delegate: "supplierPayment",
    columns: [
      "id",
      "supplierId",
      "purchaseId",
      "amount",
      "paymentDate",
      "method",
      "notes",
      "createdAt",
    ],
  },
  {
    name: "Expense",
    delegate: "expense",
    columns: [
      "id",
      "description",
      "category",
      "amount",
      "expenseDate",
      "paymentMethod",
      "notes",
      "createdAt",
      "updatedAt",
    ],
  },
] as const;

export async function createDatabaseExport() {
  let directory: string | undefined;
  let workbook: ExcelJS.stream.xlsx.WorkbookWriter | undefined;
  try {
    directory = await mkdtemp(path.join(os.tmpdir(), "able-database-export-"));
    const filePath = path.join(directory, "database-export.xlsx");
    workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: false,
      useSharedStrings: false,
    });
    const usedNames = new Set<string>();

    for (const model of MODEL_REGISTRY) {
      const worksheet = workbook.addWorksheet(
        safeWorksheetName(model.name, usedNames),
      );
      worksheet.addRow([...model.columns]).commit();

      const delegate = prisma[model.delegate] as unknown as ModelDelegate;
      let skip = 0;
      while (true) {
        const rows = await delegate.findMany({
          skip,
          take: BATCH_SIZE,
          orderBy: { id: "asc" },
          select: Object.fromEntries(
            model.columns.map((column) => [column, true]),
          ),
        });
        if (worksheet.rowCount + rows.length > MAX_WORKSHEET_ROWS)
          throw new Error(`Model ${model.name} exceeds the Excel row limit`);
        for (const record of rows) {
          worksheet
            .addRow(
              model.columns.map(
                (column) => toExcelValue(record[column]) as ExcelJS.CellValue,
              ),
            )
            .commit();
        }
        skip += rows.length;
        if (rows.length < BATCH_SIZE) break;
      }
      worksheet.commit();
    }

    await workbook.commit();
    return { filePath, directory };
  } catch (error) {
    const outputStream = (
      workbook as unknown as { stream?: { destroy?: () => void } } | undefined
    )?.stream;
    if (outputStream?.destroy) {
      const closed = finished(outputStream as NodeJS.WritableStream).catch(
        () => undefined,
      );
      outputStream.destroy();
      await closed;
    }
    if (directory)
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      }).catch((cleanupError) =>
        console.error(
          "Database export temporary-file cleanup failed",
          cleanupError,
        ),
      );
    console.error("Database export generation failed", error);
    throw new ApiError(500, "Unable to generate database export");
  }
}

export async function removeDatabaseExport(directory: string) {
  await rm(directory, { recursive: true, force: true });
}
