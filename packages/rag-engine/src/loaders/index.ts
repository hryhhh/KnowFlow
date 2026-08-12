import path from "node:path";
import type { Document } from "@langchain/core/documents";
import type { FileType, LoadResult } from "../types.js";
import { loadCSV } from "./csv-loader.js";
import { loadXLSX } from "./xlsx-loader.js";
import { loadPDF } from "./pdf-loader.js";
import { loadWord } from "./word-loader.js";

/** 文档解析策略 */
export type ParseStrategy = "mineru" | "basic";

/** 根据文件名推断文档类型 */
export function detectFileType(filename: string): FileType {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, FileType> = {
    ".csv": "csv",
    ".xlsx": "xlsx",
    ".xls": "xlsx",
    ".pdf": "pdf",
    ".docx": "word",
    ".doc": "word",
  };
  return map[ext] ?? "csv";
}

/**
 * 统一文档加载入口：根据类型和策略分发到对应 Loader。
 */
export async function loadDocument(
  filePath: string,
  fileType?: FileType,
  parseStrategy?: ParseStrategy,
): Promise<LoadResult> {
  const detectedType = fileType ?? detectFileType(filePath);
  let documents: Document[] = [];

  switch (detectedType) {
    case "csv":
      documents = await loadCSV({ filePath });
      break;
    case "xlsx":
      documents = await loadXLSX({ filePath });
      break;
    case "pdf":
      documents = await loadPDF(filePath, {
        backend: parseStrategy === "mineru" ? undefined : undefined,
      });
      break;
    case "word":
      documents = await loadWord(filePath);
      break;
  }

  return {
    documents,
    fileType: detectedType,
    totalChars: documents.reduce((sum, d) => sum + d.pageContent.length, 0),
  };
}

export { loadCSV, loadXLSX, loadPDF, loadWord };
