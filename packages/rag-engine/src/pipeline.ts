import path from "node:path";
import { OpenAIEmbeddings } from "@langchain/openai";
import { loadDocument } from "./loaders/index.js";
import { splitDocuments } from "./splitters/recursive-splitter.js";
import { getEmbeddings } from "./embeddings/openai-embeddings.js";
import {
  createPGVectorStore,
  addDocumentsToPG,
} from "./stores/pgvector-store.js";
import {
  similaritySearch,
  type VectorStoreLike,
} from "./retrievers/similarity-retriever.js";
import { hybridSearch } from "./retrievers/hybrid-retriever.js";
import { rerank } from "./rerankers/cross-encoder-reranker.js";
import { streamChat, buildContext } from "./llm/chat-service.js";
import type {
  RAGPipelineConfig,
  TextChunk,
  RetrievalResult,
  SearchParams,
  SourceRef,
  StreamCallbacks,
} from "./types.js";

/**
 * Stage 1: 文档摄入
 * 文件 → 加载 → 切片 → 向量化 → PGVector 存储
 *
 * 返回切片列表，供服务端落库（文档/切片元信息）。
 */
export async function ingestDocument(
  filePath: string,
  kbId: string,
  config: RAGPipelineConfig,
): Promise<{ chunkCount: number; chunks: TextChunk[] }> {
  // 1. 加载
  const { documents } = await loadDocument(filePath);

  // 2. 切片
  const chunks: TextChunk[] = await splitDocuments(documents, {
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  });

  // 3. 注入 kbId 到 metadata
  chunks.forEach((c) => {
    c.metadata = { ...c.metadata, kbId, source: path.basename(filePath) };
  });

  // 4. 向量化 + 存储
  const embeddings = getEmbeddings(config.embedding);
  const store = await createPGVectorStore(embeddings, config.pg, {
    tableName: config.pgTableName,
  });
  await addDocumentsToPG(store, chunks);

  return { chunkCount: chunks.length, chunks };
}

/**
 * 仅检索（不调用 LLM），返回命中切片列表。
 */
export async function retrieve(
  query: string,
  kbId: string,
  params: SearchParams,
  config: RAGPipelineConfig,
): Promise<RetrievalResult[]> {
  const embeddings = getEmbeddings(config.embedding);
  const store: VectorStoreLike = await createPGVectorStore(embeddings, config.pg, {
    tableName: config.pgTableName,
  });

  const filter = { kbId };

  let results: RetrievalResult[] = params.useReranker
    ? await hybridSearch({ ...params, query, filter }, store, config.embedding)
    : await similaritySearch({ ...params, query, filter }, store, config.embedding);

  results = results.filter((r) => r.score >= params.minScore);

  if (params.useReranker && results.length > 0) {
    results = await rerank({ query, results, topK: params.topK });
  }

  return results;
}

/**
 * Stage 2: 检索与生成
 * 问题 → 向量检索 → [重排] → 构建 Prompt → LLM 流式输出
 */
export async function retrieveAndChat(
  query: string,
  kbId: string,
  params: SearchParams,
  config: RAGPipelineConfig,
  callbacks: StreamCallbacks,
): Promise<void> {
  const embeddings = getEmbeddings(config.embedding);
  const store: VectorStoreLike = await createPGVectorStore(embeddings, config.pg, {
    tableName: config.pgTableName,
  });

  const filter = { kbId };

  let results: RetrievalResult[] = params.useReranker
    ? await hybridSearch(
        { ...params, query, filter },
        store,
        config.embedding,
      )
    : await similaritySearch(
        { ...params, query, filter },
        store,
        config.embedding,
      );

  results = results.filter((r) => r.score >= params.minScore);

  // 推送引用来源
  const sources: SourceRef[] = results.map((r) => ({
    content: r.content,
    sourceFile: r.sourceFile,
    score: r.score,
  }));
  callbacks.onSources(sources);

  // 可选重排序
  if (params.useReranker && results.length > 0) {
    results = await rerank({ query, results, topK: params.topK });
  }

  const context = buildContext(results);
  await streamChat(
    { query, context },
    config.llm,
    callbacks,
  );
}
