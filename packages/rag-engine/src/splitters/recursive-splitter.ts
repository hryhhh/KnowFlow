import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Document } from '@langchain/core/documents';
import type { TextChunk } from '../types.js';

export interface SplitOptions {
  chunkSize: number;
  chunkOverlap: number;
  separators?: string[];
}

const DEFAULT_SEPARATORS = ['\n\n', '\n', '。', '！', '？', '；', ' ', ''];

/** 估算 token 数量（粗略：中英文按字符数 / 1.5 估算） */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5);
}

/**
 * 递归字符分割器：按优先级尝试不同分隔符切分 Document。
 */
export async function splitDocuments(
  documents: Document[],
  options: Partial<SplitOptions> = {},
): Promise<TextChunk[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: options.chunkSize ?? 1000,
    chunkOverlap: options.chunkOverlap ?? 200,
    separators: options.separators ?? DEFAULT_SEPARATORS,
  });

  const results: TextChunk[] = [];

  for (const doc of documents) {
    const chunks = await splitter.splitText(doc.pageContent);
    chunks.forEach((text) => {
      results.push({
        content: text,
        metadata: { ...doc.metadata },
        tokenCount: estimateTokens(text),
      });
    });
  }

  return results;
}

/** 单个文本切片（用于测试或手动切片） */
export async function splitText(
  text: string,
  options: Partial<SplitOptions> = {},
): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: options.chunkSize ?? 1000,
    chunkOverlap: options.chunkOverlap ?? 200,
    separators: options.separators ?? DEFAULT_SEPARATORS,
  });
  return splitter.splitText(text);
}
