import path from "node:path";

import { loadDocument, type ParseStrategy, type LoadDocumentOptions } from "./loaders/index.js";
import { splitDocuments } from "./splitters/recursive-splitter.js";
import { splitMarkdownDocuments } from "./splitters/markdown-splitter.js";
import { getEmbeddings } from "./embeddings/openai-embeddings.js";
import {
  ensureCachedPGVectorStore,
  addDocumentsToPG,
} from "./stores/pgvector-store.js";
import {
  similaritySearch,
} from "./retrievers/similarity-retriever.js";
import { hybridSearch } from "./retrievers/hybrid-retriever.js";
import { rerank } from "./rerankers/bi-encoder-reranker.js";
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
 * @param parseStrategy 解析策略：
 *   - "mineru"：调用本地自托管 MinerU API，解析为结构化 Markdown，再用 MarkdownSplitter 切片
 *   - "mineru-agent"：调用 MinerU Agent 轻量解析 API（云端免登录），结果经 MarkdownSplitter 切片
 *   - "basic"：使用基础加载器 + RecursiveCharacterTextSplitter（兜底）
 *
 * 返回切片列表，供服务端落库（文档/切片元信息）。
 */
export async function ingestDocument(
  filePath: string,
  kbId: string,
  config: RAGPipelineConfig,
  parseStrategy: ParseStrategy = "basic",
  agentOptions?: LoadDocumentOptions["agentOptions"],
): Promise<{ chunkCount: number; chunks: TextChunk[] }> {
  // 1. 加载
  const { documents } = await loadDocument(filePath, undefined, parseStrategy, agentOptions);

  // 2. 切片（根据策略选择不同切片器）
  let chunks: TextChunk[];
  if (parseStrategy === "mineru" || parseStrategy === "mineru-agent") {
    const mdDocs = await splitMarkdownDocuments(documents, {
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
    });
    chunks = mdDocs.map((d) => ({
      content: d.pageContent,
      metadata: d.metadata as Record<string, unknown>,
      tokenCount: Math.ceil(d.pageContent.length / 1.5),
    }));
  } else {
    chunks = await splitDocuments(documents, {
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
    });
  }

  // 3. 注入 kbId 到 metadata
  chunks.forEach((c) => {
    c.metadata = { ...c.metadata, kbId, source: path.basename(filePath) };
  });

  // 4. 向量化 + 存储（缓存 store 复用连接）
  const embeddings = getEmbeddings(config.embedding);
  const store = await ensureCachedPGVectorStore(embeddings, config.pg, {
    tableName: config.pgTableName,
  });
  await addDocumentsToPG(store, chunks);

  return { chunkCount: chunks.length, chunks };
}

/**
 * 执行向量检索（混合或纯相似度），过滤低质量结果并可选重排。
 */
async function performSearch(
  query: string,
  filter: { kbId: string },
  params: SearchParams,
  config: RAGPipelineConfig,
): Promise<RetrievalResult[]> {
  const embeddings = getEmbeddings(config.embedding);
  const store = await ensureCachedPGVectorStore(embeddings, config.pg, {
    tableName: config.pgTableName,
  });

  let results: RetrievalResult[] = params.useReranker
    ? await hybridSearch({ ...params, query, filter }, store, config.embedding)
    : await similaritySearch({ ...params, query, filter }, store, config.embedding);

  results = results.filter((r) => r.score >= params.minScore);

  if (params.useReranker && results.length > 0) {
    results = await rerank(query, results, config.embedding, { topK: params.topK });
  }

  return results;
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
  return performSearch(query, { kbId }, params, config);
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
  const results = await performSearch(query, { kbId }, params, config);

  // 推送引用来源
  const sources: SourceRef[] = results.map((r) => ({
    content: r.content,
    sourceFile: r.sourceFile,
    score: r.score,
  }));
  callbacks.onSources(sources);

  const context = buildContext(results);
  await streamChat(
    { query, context },
    config.llm,
    callbacks,
  );
}
