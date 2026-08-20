import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import type { Document } from '@langchain/core/documents';

/**
 * 解析 Word (.docx) 文件。
 */
export async function loadWord(filePath: string): Promise<Document[]> {
  const loader = new DocxLoader(filePath);
  return loader.load();
}
