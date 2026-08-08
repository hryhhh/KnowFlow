import * as XLSX from "xlsx";
import { Document } from "@langchain/core/documents";

export interface XLSXLoadOptions {
  filePath: string;
  sheetName?: string;
}

/**
 * 解析 Excel 文件。每个 sheet 的每一行转为一个 Document，
 * metadata 中记录所属 sheet 名称。
 */
export async function loadXLSX(options: XLSXLoadOptions): Promise<Document[]> {
  const workbook = XLSX.readFile(options.filePath);
  const sheetNames = options.sheetName
    ? [options.sheetName]
    : workbook.SheetNames;

  const documents: Document[] = [];

  for (const sheet of sheetNames) {
    const worksheet = workbook.Sheets[sheet];
    if (!worksheet) continue;
    const rows: unknown[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    rows.forEach((row, index) => {
      const content = Object.entries(row as Record<string, unknown>)
        .map(([k, v]) => `${k}:${v}`)
        .join("\n");
      documents.push(
        new Document({
          pageContent: content,
          metadata: { source: options.filePath, sheet, rowIndex: index },
        }),
      );
    });
  }

  return documents;
}
