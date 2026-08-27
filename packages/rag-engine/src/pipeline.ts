import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { loadDocument, type ParseStrategy, type LoadDocumentOptions } from './loaders/index.js';
import { splitDocuments } from './splitters/recursive-splitter.js';
import { splitMarkdownDocuments } from './splitters/markdown-splitter.js';
import { getEmbeddings } from './embeddings/openai-embeddings.js';
import {
  ensureCachedPGVectorStore,
  addDocumentsToPG,
  deleteByDocId,
} from './stores/pgvector-store.js';
import {
  writeSparseIndex,
  deleteSparseByDocId,
  deleteSparseByKbId,
} from './stores/sparse-store.js';
import { similaritySearch } from './retrievers/similarity-retriever.js';
import { hybridSearch } from './retrievers/hybrid-retriever.js';
import type { HybridSearchParams } from './retrievers/hybrid-retriever.js';
import { rerank } from './rerankers/bi-encoder-reranker.js';
import { streamChat, buildContext } from './llm/chat-service.js';
import { getCachedResults, setCachedResults } from './cache/search-cache.js';
import type {
  RAGPipelineConfig,
  TextChunk,
  RetrievalResult,
  SearchParams,
  SourceRef,
  StreamCallbacks,
  IngestProgressCallback,
  SearchDebugInfo,
} from './types.js';

/** 默认每路候选倍数，可通过环境变量 DEFAULT_CANDIDATE_MULTIPLIER 覆盖 */
const DEFAULT_CANDIDATE_MULTIPLIER = Number(process.env.DEFAULT_CANDIDATE_MULTIPLIER) || 3;
/** candidateMultiplier 硬上限，防止极端参数导致 OOM */
const MAX_CANDIDATE_MULTIPLIER = 10;

/**
 * Stage 1: 文档摄入
 * 文件 → 加载 → 切片 → 向量化 → PGVector 存储
 *
 * 返回切片列表（含 docId），由服务端负责写入 chunks 表。
 * 稀疏索引（tsvector）由服务端在 chunks 落库后调用 writeSparseIndexForDoc() 补充写入。
 *
 * @param parseStrategy 解析策略：
 *   - "mineru"：调用本地自托管 MinerU API，解析为结构化 Markdown，再用 MarkdownSplitter 切片
 *   - "mineru-agent"：调用 MinerU Agent 轻量解析 API（云端免登录），结果经 MarkdownSplitter 切片
 *   - "basic"：使用基础加载器 + RecursiveCharacterTextSplitter（兜底）
 *
 * @param docId 文档 UUID，写入每个 chunk 的 metadata，用于重试幂等和删除清理
 *
 * @param progress 可选进度回调函数，在 parsing/chunking/embedding/persisting 阶段完成时调用
 */
export async function ingestDocument(
  filePath: string,
  kbId: string,
  config: RAGPipelineConfig,
  parseStrategy: ParseStrategy = 'basic',
  agentOptions?: LoadDocumentOptions['agentOptions'],
  docId?: string,
  progress?: (event: IngestProgressCallback) => void,
): Promise<{ chunkCount: number; chunks: TextChunk[] }> {
  // 1. 加载
  progress?.({ percent: 10, stage: 'parsing' });
  const { documents } = await loadDocument(filePath, undefined, parseStrategy, agentOptions);

  // 2. 切片（根据策略选择不同切片器）
  let chunks: TextChunk[];
  if (parseStrategy === 'mineru' || parseStrategy === 'mineru-agent') {
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
  progress?.({ percent: 30, stage: 'parsing' });
  progress?.({ percent: 40, stage: 'chunking' });

  // 3. 注入 kbId/docId/chunkId 到 metadata
  //    chunkId 为 UUID，作为跨 dense/sparse 两路的共同关联键。
  //    - dense 侧：UUID 随 metadata 写入 PGVector，similaritySearch 结果携带它。
  //    - sparse 侧：chunks 表新增 chunk_id 列存储同一 UUID，sparseSearch 按该列查询，两路 key 一致。
  //    processor 在 chunkRepo.save() 后需用此 UUID 回填 DB，详见 exports。
  chunks.forEach((c, i) => {
    c.metadata = {
      ...c.metadata,
      kbId,
      source: path.basename(filePath),
      ...(docId ? { docId } : {}),
      chunkIndex: i,
      chunkId: randomUUID(),
    };
  });

  // 4. 向量化 + 存储（缓存 store 复用连接）
  progress?.({ percent: 50, stage: 'embedding' });
  const embeddings = getEmbeddings(config.embedding);
  const store = await ensureCachedPGVectorStore(embeddings, config.pg, {
    tableName: config.pgTableName,
  });
  await addDocumentsToPG(store, chunks, (p, s) => progress?.({ percent: p, stage: s }));
  progress?.({ percent: 90, stage: 'persisting' });

  // 5. 稀疏索引在 chunks 表落库后由服务端 ingestion.processor 调用 writeSparseIndex() 补充写入
  //    此处不调用，避免 ID 不对齐（pipeline 没有 chunks 表主键）

  return { chunkCount: chunks.length, chunks };
}

/**
 * 生成 chunkId 列表（供服务端 processor 回填 chunks.chunk_id 列）
 */
export function getChunkIds(chunks: TextChunk[]): string[] {
  return chunks.map((c) => c.metadata?.chunkId as string).filter(Boolean);
}

/**
 * 向后兼容桥接：旧参数 → 新 SearchParams（deprecation 路径）
 *
 * 当客户端未传 retrievalMode 时自动补全：
 * - useReranker=true → retrievalMode='hybrid'（旧行为）
 * - useReranker=false → retrievalMode='vector'
 */
function resolveSearchParams(params: Partial<SearchParams>): SearchParams {
  if (params.retrievalMode) return params as SearchParams;

  console.warn(
    '[DEPRECATED] retrievalMode not provided; auto-resolved from useReranker. ' +
      'Migrate to explicit retrievalMode=vector|hybrid.',
  );

  return {
    retrievalMode: params.useReranker ? 'hybrid' : 'vector',
    fusionMethod: 'linear',
    denseWeight: params.denseWeight ?? 0.5,
    rrfK: 60,
    candidateMultiplier: DEFAULT_CANDIDATE_MULTIPLIER,
    minDenseScore: null,
    ...params,
  } as SearchParams;
}

/**
 * 执行检索（混合或纯相似度），过滤低质量结果并可选重排。
 * 带进程内缓存：相同 query+kbId+params 直接命中，跳过 embedding 和向量检索。
 */
async function performSearch(
  query: string,
  filter: { kbId: string },
  params: SearchParams,
  config: RAGPipelineConfig,
): Promise<RetrievalResult[]> {
  // 1. 兼容桥接：补全默认值
  const resolved = resolveSearchParams(params);
  const mode = resolved.retrievalMode ?? 'vector';
  const fusionMethod = resolved.fusionMethod ?? 'rrf';
  const rrfK = resolved.rrfK ?? 60;
  const rawMultiplier = resolved.candidateMultiplier ?? DEFAULT_CANDIDATE_MULTIPLIER;
  // candidateMultiplier 硬上限
  const multiplier = Math.min(rawMultiplier, MAX_CANDIDATE_MULTIPLIER);
  const candidatesPerRoute = Math.ceil(resolved.topK * multiplier);

  // 2. 缓存 key（包含模式参数，不同模式结果不可共用）
  const cached = await getCachedResults({
    query,
    kbId: filter.kbId,
    topK: resolved.topK,
    minScore: resolved.minScore,
    retrievalMode: mode,
    fusionMethod,
    rrfK,
    minDenseScore: resolved.minDenseScore ?? undefined,
  });
  if (cached !== null) {
    return cached;
  }

  const embeddings = getEmbeddings(config.embedding);
  const store = await ensureCachedPGVectorStore(embeddings, config.pg, {
    tableName: config.pgTableName,
  });

  let results: RetrievalResult[];

  // 3. 按模式分支
  switch (mode) {
    case 'vector':
      results = await similaritySearch({ ...resolved, query, filter }, store, config.embedding);
      // vector 模式：过滤 minScore
      results = results.filter((r) => r.score >= (resolved.minScore ?? 0));
      break;

    case 'keyword':
      results = await (
        await import('./retrievers/sparse-retriever.js')
      ).sparseSearch({ query, filter, topK: resolved.topK }, config.pg, 'chunks');
      // keyword 模式：minScore 对稀疏分无固定范围意义，不启用
      break;

    case 'hybrid': {
      const hybridResult = await hybridSearch(
        {
          ...resolved,
          query,
          filter,
          candidatesPerRoute,
          fusionMethod,
          fusionParam: fusionMethod === 'linear' ? (resolved.denseWeight ?? 0.5) : rrfK,
          dbConfig: config.pg,
          sparseTableName: 'chunks',
        },
        store,
        config.embedding,
      );
      results = hybridResult.results;

      // hybrid + linear 模式：minScore 过滤融合后结果
      if (fusionMethod === 'linear' && resolved.minScore !== undefined) {
        results = results.filter((r) => r.score >= resolved.minScore);
      }
      break;
    }

    default:
      // 兜底走 vector
      results = await similaritySearch({ ...resolved, query, filter }, store, config.embedding);
      results = results.filter((r) => r.score >= (resolved.minScore ?? 0));
  }

  // 4. 可选重排（与 retrievalMode 独立）
  if (resolved.useReranker && results.length > 0) {
    results = await rerank(query, results, config.embedding, { topK: resolved.topK });
  }

  // 5. 写入缓存
  setCachedResults(
    {
      query,
      kbId: filter.kbId,
      topK: resolved.topK,
      minScore: resolved.minScore,
      retrievalMode: mode,
      fusionMethod,
      rrfK,
      minDenseScore: resolved.minDenseScore ?? undefined,
    },
    results,
  );

  return results;
}

/**
 * 仅检索（不调用 LLM），返回命中切片列表。
 * 当 params.debug=true 时，同时返回 SearchDebugInfo。
 */
export async function retrieve(
  query: string,
  kbId: string,
  params: SearchParams,
  config: RAGPipelineConfig,
): Promise<{ results: RetrievalResult[]; debug?: SearchDebugInfo }> {
  const results = await performSearch(query, { kbId }, params, config);

  if (!params.debug) {
    return { results };
  }

  // 构建 debug 信息
  const resolved = resolveSearchParams(params);
  const mode = resolved.retrievalMode ?? 'vector';
  const fusionMethod = resolved.fusionMethod ?? 'rrf';

  let debugInfo: SearchDebugInfo;

  if (mode === 'hybrid') {
    // hybrid 模式需要重新调用 hybridSearch 以获取真实的候选数
    const rrfK = resolved.rrfK ?? 60;
    const rawMultiplier = resolved.candidateMultiplier ?? DEFAULT_CANDIDATE_MULTIPLIER;
    const multiplier = Math.min(rawMultiplier, MAX_CANDIDATE_MULTIPLIER);
    const candidatesPerRoute = Math.ceil(resolved.topK * multiplier);

    const embeddings = getEmbeddings(config.embedding);
    const store = await ensureCachedPGVectorStore(embeddings, config.pg, {
      tableName: config.pgTableName,
    });

    const hybridResult = await hybridSearch(
      {
        ...resolved,
        query,
        filter: { kbId },
        candidatesPerRoute,
        fusionMethod,
        fusionParam: fusionMethod === 'linear' ? (resolved.denseWeight ?? 0.5) : rrfK,
        dbConfig: config.pg,
        sparseTableName: 'chunks',
        debug: true,
      },
      store,
      config.embedding,
    );

    debugInfo = hybridResult.debug!;
  } else if (mode === 'vector') {
    debugInfo = {
      mode: 'vector',
      fusion: null,
      denseCandidates: results.length,
      sparseCandidates: 0,
      fusedTopK: results.length,
      items: results.map((r, idx) => ({
        chunkId: (r.metadata?.chunkId as string) ?? r.sourceFile,
        rankDense: idx + 1,
        rankSparse: null,
        scoreDense: r.score,
        scoreSparse: null,
        scoreFused: r.score,
        sourceFile: r.sourceFile,
      })),
    };
  } else {
    // keyword 模式
    debugInfo = {
      mode: 'keyword',
      fusion: null,
      denseCandidates: 0,
      sparseCandidates: results.length,
      fusedTopK: results.length,
      items: results.map((r, idx) => ({
        chunkId: (r.metadata?.chunkId as string) ?? r.sourceFile,
        rankDense: null,
        rankSparse: idx + 1,
        scoreDense: null,
        scoreSparse: r.score,
        scoreFused: r.score,
        sourceFile: r.sourceFile,
      })),
    };
  }

  return { results, debug: debugInfo };
}
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
  await streamChat({ query, context }, config.llm, callbacks);
}

/**
 * 按 docId 清理稀疏索引（删除文档时调用）
 */
export async function clearSparseByDocId(
  docId: string,
  config: RAGPipelineConfig,
): Promise<{ deleted: number }> {
  const result = await deleteSparseByDocId(config.pg, 'chunks', docId);
  return result;
}

/**
 * 按 kbId 清理稀疏索引（删除知识库时调用）
 */
export async function clearSparseByKbId(
  kbId: string,
  config: RAGPipelineConfig,
): Promise<{ deleted: number }> {
  const result = await deleteSparseByKbId(config.pg, 'chunks', kbId);
  return result;
}
