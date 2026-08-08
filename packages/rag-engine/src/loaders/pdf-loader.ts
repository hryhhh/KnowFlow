import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import type { Document } from "@langchain/core/documents";

/**
 * 解析 PDF 文件，按页面切分（每页一个 Document）。
 */
export async function loadPDF(filePath: string): Promise<Document[]> {
  const loader = new PDFLoader(filePath, {
    parsedItemSeparator: "\n\n",
  });
  return loader.load();
}
