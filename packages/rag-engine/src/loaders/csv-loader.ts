import { CSVLoader } from '@langchain/community/document_loaders/fs/csv';
import type { Document } from '@langchain/core/documents';

export interface CSVLoadOptions {
  filePath: string;
  column?: string;
  separator?: string;
}

/**
 * 解析 CSV 文件，默认每行转为一个 Document。
 */
export async function loadCSV(options: CSVLoadOptions): Promise<Document[]> {
  const loader = new CSVLoader(options.filePath, {
    column: options.column,
    separator: options.separator,
  });
  return loader.load();
}
