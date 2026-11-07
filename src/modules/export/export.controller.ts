import type { Request, Response, NextFunction } from "express";
import {
  createDatabaseExport,
  removeDatabaseExport,
} from "./export.service.js";
import { exportFilename } from "./export.utils.js";

export function createDatabaseExportLink(req: Request, res: Response) {
  res.json({
    success: true,
    data: {
      downloadUrl: `${req.baseUrl}/database/download`,
      filename: exportFilename(),
    },
  });
}

export async function downloadDatabaseExport(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  const { filePath, directory } = await createDatabaseExport();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    void removeDatabaseExport(directory).catch((error) =>
      console.error("Database export cleanup failed", error),
    );
  };

  res.once("close", cleanup);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${exportFilename()}"`,
  );
  res.download(filePath, exportFilename(), (error) => {
    cleanup();
    if (error && !res.headersSent) next(error);
  });
}
