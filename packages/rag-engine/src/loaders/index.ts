import path from 'node:path';
import type { Document } from '@langchain/core/documents';
import type { FileType, LoadResult } from '../types.js';
import { loadCSV } from './csv-loader.js';
import { loadXLSX } from './xlsx-loader.js';
import { loadPDF as loadPDFInternal } from './pdf-loader.js';
import { loadPDFWithAgentAPI } from './agent-pdf-loader.js';
import { loadWord } from './word-loader.js';

/** 文档解析策略 */
export type ParseStrategy = 'mineru' | 'mineru-agent' | 'basic';

/** 文档加载选项 */
export interface LoadDocumentOptions {
  parseStrategy?: ParseStrategy;
  /** Agent API 可选参数，仅在 parseStrategy="mineru-agent" 时生效 */
  agentOptions?: {
    language?: string;
    enableTable?: boolean;
    isOcr?: boolean;
    enableFormula?: boolean;
    pageRange?: string;
  };
}

/** 根据文件名推断文档类型 */
export function detectFileType(filename: string): FileType {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, FileType> = {
    '.csv': 'csv',
    '.xlsx': 'xlsx',
    '.xls': 'xlsx',
    '.pdf': 'pdf',
    '.docx': 'word',
    '.doc': 'word',
  };
  return map[ext] ?? 'csv';
}

/**
 * 统一文档加载入口：根据类型和策略分发到对应 Loader。
 */
export async function loadDocument(
  filePath: string,
  fileType?: FileType,
  parseStrategy?: ParseStrategy,
  agentOptions?: LoadDocumentOptions['agentOptions'],
): Promise<LoadResult> {
  const detectedType = fileType ?? detectFileType(filePath);
  let documents: Document[] = [];

  switch (detectedType) {
    case 'csv':
      documents = await loadCSV({ filePath });
      break;
    case 'xlsx':
      documents = await loadXLSX({ filePath });
      break;
    case 'pdf':
      if (parseStrategy === 'mineru-agent') {
        documents = (await loadPDFWithAgentAPI(filePath, agentOptions)) ?? [];
        // Agent API 返回 null 表示超出限制，自动降级到本地基础解析
        if (documents.length === 0) {
          console.warn(`[loadDocument] Agent API 不可用，降级到基础 PDF 解析: ${filePath}`);
          documents = await loadPDFInternal(filePath);
        }
      } else {
        documents = await loadPDFInternal(filePath);
      }
      break;
    case 'word':
      documents = await loadWord(filePath);
      break;
  }

  return {
    documents,
    fileType: detectedType,
    totalChars: documents.reduce((sum, d) => sum + d.pageContent.length, 0),
  };
}

export { loadCSV, loadXLSX, loadPDFInternal as loadPDF, loadWord };
