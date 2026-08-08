import { OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import type { TextChunk } from "../types.js";

/**
 * 创建空的内存向量库（开发/测试用）。
 */
export async function createMemoryStore(
  embeddings: OpenAIEmbeddings,
): Promise<MemoryVectorStore> {
  return MemoryVectorStore.fromDocuments([], embeddings);
}

/** 从文本列表创建内存向量库 */
export async function createMemoryStoreFromTexts(
  embeddings: OpenAIEmbeddings,
  chunks: TextChunk[],
): Promise<MemoryVectorStore> {
  const docs = chunks.map(
    (c) => new Document({ pageContent: c.content, metadata: c.metadata ?? {} }),
  );
  return MemoryVectorStore.fromDocuments(docs, embeddings);
}
