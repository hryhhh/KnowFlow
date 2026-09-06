# RAG Engine 核心引擎设计文档

> RAG (Retrieval-Augmented Generation) 核心引擎的模块化设计，涵盖文档加载、文本切片、向量化嵌入、向量存储、检索器与 LLM 集成。
> 最后更新：2026-09-06

## 一、引擎架构总览

```
packages/rag-engine/src/
│
├── loaders/              # 文档加载层 — 将原始文件解析为 Document[]
│   ├── csv-loader.ts         # CSV 文件加载
│   ├── xlsx-loader.ts        # Excel (XLSX) 加载
│   ├── pdf-loader.ts         # PDF 加载
│   ├── agent-pdf-loader.ts   # MinerU Agent API PDF 加载
│   └── word-loader.ts        # Word (.docx) 加载
│
├── splitters/            # 文本切片层 — 将 Document 拆分为语义块
│   ├── recursive-splitter.ts  # 递归字符分割器（默认）
│   ├── markdown-splitter.ts   # Markdown 专用切片器
│   └── semantic-splitter.ts   # 语义感知分割器（可选增强）
│
├── tokenizer.ts          # 应用层分词器（N-gram fallback，jieba 可选）
│
├── embeddings/           # 向量化层 — 将文本转换为稠密向量
│   └── openai-embeddings.ts   # OpenAI 兼容 Embedding 接口
│
├── stores/               # 存储层 — 持久化 & 检索数据
│   ├── pgvector-store.ts      # PGVector 持久化向量库（dense）
│   ├── sparse-store.ts        # tsvector 全文索引（sparse）
│   └── memory-store.ts        # 内存向量库（开发 / 测试用）
│
├── retrievers/           # 检索层 — 从存储中召回相关内容
│   ├── similarity-retriever.ts    # 纯向量相似度检索
│   ├── sparse-retriever.ts        # tsvector 稀疏检索（BM25-like）
│   └── hybrid-retriever.ts        # 混合检索（dense + sparse + fusion）
│
├── fusion/               # 融合层 — 合并多路检索结果
│   ├── rrf.ts                 # Reciprocal Rank Fusion（默认）
│   └── linear.ts              # 线性加权融合
│
├── rerankers/            # 重排序层 — 对检索结果精排
│   ├── bi-encoder-reranker.ts   # Bi-Encoder 重排序（当前可用）
│   └── cross-encoder-reranker.ts # Cross-Encoder 重排序（TODO: stub）
│
├── llm/                  # LLM 集成层 — 流式生成回答
│   └── chat-service.ts          # 对话服务 (SSE 流式)
│
├── cache/
│   └── search-cache.ts      # 进程内检索结果缓存（含 mode 参数的 key）
│
├── pipeline.ts           # 编排层 — 组合上述组件为完整 RAG Pipeline
│
└── index.ts              # 统一导出入口
```

## 二、数据流

```
原始文件
  │
  ▼
[Loaders] ──→ Document[]       // { pageContent, metadata }
  │
  ▼
[Splitters] ──→ Chunk[]         // { content, metadata, tokenCount }
  │
  ▼
[Embeddings] ──→ float[][]      // 向量数组
  │
  ▼
[VectorStore]                    // PGVector / Memory
  │
  ▼ (查询时)
[Retriever] ──→ RetrievedChunk[]  // { content, score, metadata }
  │
  ▼ [可选]
[Reranker] ──→ RankedChunk[]     // 重排序后的结果
  │
  ▼
[LLM Chat Service] ──→ SSE Stream  // 流式输出
```

## 三、文档加载器 (Loaders)

### 3.1 CSV Loader

**职责：** 解析 CSV 文件，每行转为一个 Document。

```typescript
// packages/rag-engine/src/loaders/csv-loader.ts

import { CSVLoader } from '@langchain/community/document_loaders/fs/csv';
import type { Document } from '@langchain/core/documents';

interface CSVLoadOptions {
  filePath: string;
  column?: string; // 可选：指定某一列作为内容源
  separator?: string; // 分隔符，默认 ","
}

export async function loadCSV(options: CSVLoadOptions): Promise<Document[]> {
  const loader = new CSVLoader(options.filePath, options.column);
  const docs = await loader.load();
  return docs;
}
```

**输出示例（对应 step6.png 数据）：**

```json
{
  "pageContent": "日期sheet:2019/8/21\n销售人:小小米\n手机型号:小米8\n数量:1\n单价:2799\n订单金额:\n订单状态:发货中",
  "metadata": {
    "source": "student.csv",
    "line": 0,
    "row": { "日期sheet": "2019/8/21", "销售人": "小小米", ... }
  }
}
```

### 3.2 XLSX Loader

**职责：** 解析 Excel 文件，支持多 Sheet。

```typescript
// packages/rag-engine/src/loaders/xlsx-loader.ts

import { XLSX } from 'xlsx'; // 或 @langchain/community 的 XLSX loader

interface XLSXLoadOptions {
  filePath: string;
  sheetName?: string; // null = 第一个 sheet
}

export async function loadXLSX(options: XLSXLoadOptions): Promise<Document[]> {
  // 方案 A: 先转为 CSV 再用 CSVLoader
  // 方案 B: 使用 xlsx 库直接读取 → 转为 Document[]
}
```

### 3.3 PDF Loader（三种解析策略）

PDF 解析按 `parseStrategy` 分发（默认 `mineru-agent`，见 `apps/server` 文档服务）：

| 策略           | 实现                  | 说明                                                                  |
| -------------- | --------------------- | --------------------------------------------------------------------- |
| `mineru-agent` | `agent-pdf-loader.ts` | MinerU 云端 Agent API（`MINERU_AGENT_API_BASE_URL`），返回 Markdown   |
| `mineru`       | `pdf-loader.ts`       | 自托管 MinerU `/file_parse`（`MINERU_API_URL`），失败时降级 pdf-parse |
| `basic`        | `pdf-loader.ts` 内部  | pdf-parse 纯文本兜底，无外部依赖                                      |

自托管部署详见 [06-self-hosted-mineru.md](06-self-hosted-mineru.md)。MinerU 输出的 Markdown 交给 `markdown-splitter.ts` 按标题层级切片。

```typescript
// packages/rag-engine/src/loaders/pdf-loader.ts（节选）
// POST {MINERU_API_URL}/file_parse → 返回 Markdown ZIP → AdmZip 解压
// 环境变量：MINERU_API_URL / MINERU_BACKEND / MINERU_EFFORT

// packages/rag-engine/src/loaders/agent-pdf-loader.ts（节选）
// POST {MINERU_AGENT_API_BASE_URL}/parse/file → 轮询 /parse/:task_id
```

### 3.4 Word Loader

**职责：** 解析 .docx 文件。

```typescript
// packages/rag-engine/src/loaders/word-loader.ts

import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';

export async function loadWord(filePath: string): Promise<Document[]> {
  const loader = new DocxLoader(filePath);
  return await loader.load();
}
```

### 3.5 统一加载入口

```typescript
// packages/rag-engine/src/loaders/index.ts（节选）

/** 文档解析策略 */
export type ParseStrategy = 'mineru' | 'mineru-agent' | 'basic';

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
  return map[ext] ?? 'csv'; // 默认当 CSV 处理
}

export async function loadDocument(
  filePath: string,
  fileType?: FileType,
  parseStrategy?: ParseStrategy,
  agentOptions?: LoadDocumentOptions['agentOptions'],
): Promise<LoadResult> {
  // 按 fileType 分发到对应 Loader；PDF 再按 parseStrategy 分发到
  // agent-pdf-loader（mineru-agent）或 pdf-loader（mineru / basic）
}
```

## 四、文本切片策略 (Splitters)

### 4.1 RecursiveCharacterTextSplitter（默认）

递归字符分割器，按优先级尝试不同分隔符进行切割。

```typescript
// packages/rag-engine/src/splitters/recursive-splitter.ts

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Document } from '@langchain/core/documents';

interface SplitOptions {
  chunkSize: number; // 每块最大字符数，默认 1000
  chunkOverlap: number; // 块间重叠字符数，默认 200
  separators?: string[]; // 分隔符优先级列表
}

// 默认分隔符优先级
const DEFAULT_SEPARATORS = [
  '\n\n', // 双换行 (段落)
  '\n', // 单换行
  ' ', // 空格
  '', // 字符级兜底
];

export async function splitDocuments(
  documents: Document[],
  options: Partial<SplitOptions> = {},
): Promise<Document[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: options.chunkSize ?? 1000,
    chunkOverlap: options.chunkOverlap ?? 200,
    separators: options.separators ?? DEFAULT_SEPARATORS,
  });

  const results: Document[] = [];
  for (const doc of documents) {
    const chunks = await splitter.splitDocuments([doc]);
    results.push(...chunks);
  }

  return results;
}

// 单个文本切片（用于测试）
export async function splitText(
  text: string,
  options: Partial<SplitOptions> = {},
): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: options.chunkSize ?? 1000,
    chunkOverlap: options.chunkOverlap ?? 200,
  });
  return splitter.splitText(text);
}
```

### 4.2 MarkdownSplitter（MinerU 输出专用）

MinerU 解析 PDF 后输出 Markdown，`markdown-splitter.ts` 按标题层级（# ~ ####）切块，保留标题路径作为切片标题，保证语义单元完整。

### 4.3 SemanticSplitter（高级，未接入 Pipeline）

基于句向量相似度的语义边界切片，已实现并导出（`SemanticSplitter` 类），但因需要额外调用 Embedding 计算句间相似度、延迟高，暂未接入 `ingestDocument` 流程。适用长篇论文/报告，作为可选离线策略（见 [17-rag-optimizations.md](17-rag-optimizations.md) §2.1）。

## 五、向量化嵌入 (Embeddings)

### 5.1 OpenAI 兼容 Embedding

```typescript
// packages/rag-engine/src/embeddings/openai-embeddings.ts

import { OpenAIEmbeddings } from '@langchain/openai';

interface EmbeddingConfig {
  apiKey: string;
  model: string; // 如 "text-embedding-v4"
  baseURL: string; // OpenAI 兼容端点
  dimensions?: number; // 输出维度（可选）
}

let _embeddings: OpenAIEmbeddings | null = null;

export function getEmbeddings(config: EmbeddingConfig): OpenAIEmbeddings {
  if (!_embeddings) {
    _embeddings = new OpenAIEmbeddings({
      apiKey: config.apiKey,
      model: config.model,
      configuration: {
        baseURL: config.baseURL,
      },
      dimensions: config.dimensions,
    });
  }
  return _embeddings;
}

/** 批量将文档列表向量化（自动分批处理，每批最多 10 条） */
export async function embedDocuments(
  config: EmbeddingConfig,
  texts: string[],
): Promise<number[][]> {
  const embeddings = getEmbeddings(config);
  const BATCH_SIZE = 10;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchResult = await embeddings.embedDocuments(batch);
    results.push(...batchResult);
    if (i + BATCH_SIZE < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}

/** 将单个查询词向量化 */
export async function embedQuery(config: EmbeddingConfig, query: string): Promise<number[]> {
  const embeddings = getEmbeddings(config);
  return embeddings.embedQuery(query);
}
```

**配置示例（阿里云 MaaS）：**

```json
{
  "apiKey": "sk-xxxx",
  "model": "text-embedding-v4",
  "baseURL": "https://ws-y6p6h63wplx9ccmu.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  "dimensions": 1024
}
```

## 六、向量存储 (Vector Stores)

### 6.1 PGVector Store（生产环境）

持久化向量存储，基于 PostgreSQL + pgvector 扩展。

```typescript
// packages/rag-engine/src/stores/pgvector-store.ts

import { OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore, DistanceStrategy } from '@langchain/community/vectorstores/pgvector';
import { Document } from '@langchain/core/documents';
import type { PoolConfig } from 'pg';

interface PGVectorConfig {
  postgresConnectionOptions: PoolConfig;
  tableName: string;
  columns: {
    vectorColumnName: string;
    contentColumnName: string;
    metadataColumnName: string;
  };
  distancesStrategy: DistanceStrategy | string;
}

const DEFAULT_CONFIG: Omit<PGVectorConfig, 'postgresConnectionOptions'> = {
  tableName: 'langchainjs',
  columns: {
    vectorColumnName: 'vector',
    contentColumnName: 'content',
    metadataColumnName: 'metadata',
  },
  distancesStrategy: 'cosine' as DistanceStrategy,
};

export async function createPGVectorStore(
  embeddings: OpenAIEmbeddings,
  dbConfig: PoolConfig,
  tableConfig?: Partial<Omit<PGVectorConfig, 'postgresConnectionOptions'>>,
): Promise<PGVectorStore> {
  const config = { ...DEFAULT_CONFIG, ...tableConfig, postgresConnectionOptions: dbConfig };

  const store = await PGVectorStore.initialize(embeddings, config);
  return store;
}

/** 存入文档向量 */
export async function addDocumentsToPG(
  store: PGVectorStore,
  chunks: { content: string; metadata?: Record<string, unknown> }[],
): Promise<void> {
  const documents = chunks.map(
    (c) => new Document({ pageContent: c.content, metadata: c.metadata ?? {} }),
  );
  await store.addDocuments(documents);
}

/** 相似度检索 + 评分 */
export async function searchSimilarityWithScore(
  store: PGVectorStore,
  queryVector: number[],
  topK: number = 10,
): Promise<[Document, number][]> {
  return store.similaritySearchVectorWithScore(queryVector, topK);
}
```

**Docker PGVector 配置：**

```yaml
# docker-compose.yml（节选）
services:
  postgres-vector:
    image: pgvector/pgvector:pg16
    container_name: kb-pgvector
    ports:
      - '${POSTGRES_PORT:-5433}:5432' # 宿主机默认 5433，避免与本机 PG 冲突
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-change-me-in-production}
      POSTGRES_DB: ${POSTGRES_DB:-knowledge_rag}
```

### 6.2 Memory Store（开发环境）

内存中的向量存储，无需数据库，适合本地开发和快速验证。

```typescript
// packages/rag-engine/src/stores/memory-store.ts

import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';

export async function createMemoryStore(embeddings: OpenAIEmbeddings): Promise<MemoryVectorStore> {
  return MemoryVectorStore.fromDocuments([], embeddings);
}

/** 从已有文本创建内存向量库 */
export async function createMemoryStoreFromTexts(
  embeddings: OpenAIEmbeddings,
  texts: string[],
): Promise<MemoryVectorStore> {
  const docs = texts.map((t) => new Document({ pageContent: t }));
  return MemoryVectorStore.fromDocuments(docs, embeddings);
}
```

## 七、检索器 (Retrievers)

### 7.1 相似度检索器

纯向量相似度搜索（cosine distance）。

```typescript
// packages/rag-engine/src/retrievers/similarity-retriever.ts

import type { Document } from '@langchain/core/documents';

export interface RetrievalResult {
  document: Document;
  score: number;
  sourceFile: string; // 从 metadata 中提取
}

interface SimilaritySearchParams {
  query: string;
  topK: number;
  minScore: number; // 最低相似度阈值
}

/** 执行相似度检索 */
export async function similaritySearch(
  params: SimilaritySearchParams,
  vectorStore: any, // PGVectorStore 或 MemoryVectorStore
  embeddingConfig: import('./openai-embeddings.js').EmbeddingConfig,
): Promise<RetrievalResult[]> {
  const { embedQuery } = await import('../embeddings/openai-embeddings.js');
  const queryVector = await embedQuery(embeddingConfig, params.query);

  const rawResults = await vectorStore.similaritySearchVectorWithScore(queryVector, params.topK);

  return rawResults
    .map(([doc, score]: [Document, number]) => ({
      document: doc,
      score: Number(score.toFixed(7)), // 保留7位精度
      sourceFile: doc.metadata?.source ?? 'unknown',
    }))
    .filter((r) => r.score >= params.minScore); // 过滤低分结果
}
```

### 7.2 稀疏检索器

基于 PostgreSQL `tsvector` + `tsquery` 的全文检索，实现 BM25-like 关键词匹配。

```typescript
// packages/rag-engine/src/retrievers/sparse-retriever.ts

/**
 * 稀疏检索器：对 chunks 表的 tsv 列执行 ts_rank 排序
 * 使用应用层 tokenizer.ts 进行分词（N-gram fallback，jieba 可选）
 */
export async function sparseSearch(
  query: string,
  filter: { kbId: string },
  topK: number,
  candidateMultiplier: number = 3,
): Promise<RetrievalResult[]> {
  // 1. 分词
  const tokens = tokenize(query);
  // 2. 构造 tsquery（prefix operator 支持部分匹配）
  const tsqueryStr = tokensToTsQuery(tokens);
  // 3. 执行检索
  const results = await db.query(
    `SELECT id, content, ts_rank(tsv, q) AS rank
     FROM chunks
     WHERE tsv @@ $1 AND kb_id = $2
     ORDER BY rank DESC
     LIMIT $3`,
    [tsqueryStr, filter.kbId, topK * candidateMultiplier],
  );
  return results.map((row) => ({
    content: row.content,
    score: row.rank,
    sourceFile: 'unknown',
    metadata: { chunkId: row.id, kbId: filter.kbId },
  }));
}
```

### 7.3 混合检索器（hybrid-retriever.ts）

双路并行召回 + 融合，是默认推荐的检索模式（设计细节见 [07-hybrid-retrieval.md](07-hybrid-retrieval.md)）：

```typescript
// packages/rag-engine/src/retrievers/hybrid-retriever.ts（节选）

interface HybridSearchParams {
  query: string;
  kbId: string;
  topK: number;
  minScore?: number;
  fusionMethod?: 'rrf' | 'linear'; // 默认 rrf
  rrfK?: number; // 默认 60
  denseWeight?: number; // linear 权重，默认 0.5
  candidateMultiplier?: number; // 每路候选 = topK × 倍数（硬上限 10）
  minDenseScore?: number | null; // 仅过滤 dense 候选阶段
}

// 并行执行 dense（PGVector）与 sparse（tsvector）检索，
// 各取 topK × candidateMultiplier 条候选，再经 rrfFuse / linearFuse 融合取 topK
export async function hybridSearch(
  params: HybridSearchParams,
  config: RAGConfig,
): Promise<RetrievalResult[]>;
```

## 八、重排序 (Rerankers)

### 8.1 Bi-Encoder 重排序（当前可用）

基于双编码器模型的相关性评分。

```typescript
// packages/rag-engine/src/rerankers/bi-encoder-reranker.ts

/**
 * Bi-Encoder 重排序：
 * 分别编码 query 和 document，计算余弦相似度作为重排分数
 */
export async function rerank(input: RerankInput): Promise<RetrievalResult[]> {
  // 实现略
}
```

### 8.2 Cross-Encoder 重排序（Stub / TODO）

Cross-Encoder 同时对 (query, document) 对编码，精度更高但计算成本更大。

```typescript
// packages/rag-engine/src/rerankers/cross-encoder-reranker.ts

/**
 * ⚠️ 当前为 Stub 实现——直接返回原始结果，未进行实际重排序。
 * TODO: 接入实际 Cross-Encoder 推理或云端 API
 */
export async function rerank(input: RerankInput): Promise<RetrievalResult[]> {
  return input.results.slice(0, input.topK ?? 10);
}
```

## 九、LLM 对话集成

### 9.1 Chat Service（SSE 流式生成）

```typescript
// packages/rag-engine/src/llm/chat-service.ts

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

interface LLMConfig {
  apiKey: string;
  model: string; // 如 "qwen3.7-plus"
  baseURL: string;
  temperature?: number; // 默认 0.7
}

interface ChatRequest {
  query: string;
  context: string; // 检索到的上下文拼接
  systemPrompt?: string;
}

interface StreamCallbacks {
  onSources: (sources: SourceRef[]) => void;
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

interface SourceRef {
  content: string;
  sourceFile: string;
  score: number;
}

const DEFAULT_SYSTEM_PROMPT = `你是一个知识库助手。请根据以下参考资料回答用户问题。
如果资料中没有相关信息，请明确告知。回答时请引用具体的来源信息。`;

export async function streamChat(
  request: ChatRequest,
  config: LLMConfig,
  callbacks: StreamCallbacks,
): Promise<void> {
  const llm = new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.model,
    streaming: true,
    configuration: { baseURL: config.baseURL },
  });

  // 构造 Prompt
  const systemPrompt = request.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const userPrompt = `参考资料：
${request.context}

用户问题：${request.query}`;

  try {
    const stream = await llm.stream([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    for await (const chunk of stream) {
      const content = chunk.content as string;
      if (content) {
        callbacks.onToken(content);
      }
    }

    callbacks.onDone();
  } catch (error) {
    callbacks.onError(error as Error);
  }
}

/** 构建上下文字符串 */
export function buildContext(retrievalResults: RetrievalResult[]): string {
  return retrievalResults
    .map(
      (r, i) => `[${i + 1}] ${r.document.pageContent}\n(来源: ${r.sourceFile}, 相关度: ${r.score})`,
    )
    .join('\n\n');
}
```

## 十、RAG Pipeline 编排

将上述所有组件串联为一个完整的处理流水线：

```typescript
// packages/rag-engine/src/pipeline.ts

import { loadDocument } from './loaders/index.js';
import { splitDocuments } from './splitters/recursive-splitter.js';
import { getEmbeddings, embedQuery } from './embeddings/openai-embeddings.js';
import {
  createPGVectorStore,
  addDocumentsToPG,
  searchSimilarityWithScore,
} from './stores/pgvector-store.js';
import { streamChat, buildContext } from './llm/chat-service.js';
import { similaritySearch } from './retrievers/similarity-retriever.js';
import { rerank } from './rerankers/cross-encoder-reranker.js';

/** 完整 RAG Pipeline 配置 */
export interface RAGPipelineConfig {
  // 数据库连接
  pgHost: string;
  pgPort: number;
  pgUser: string;
  pgPassword: string;
  pgDatabase: string;

  // LLM 配置
  llmApiKey: string;
  llmModel: string;
  llmBaseURL: string;
  embeddingModel: string;
  embeddingDimensions: number;

  // 切片参数
  chunkSize: number;
  chunkOverlap: number;

  // 检索参数 (默认值)
  defaultTopK: number;
  defaultMinScore: number;
  defaultDenseWeight: number;
  defaultMinDenseScore?: number | null;
  defaultCandidateMultiplier?: number;
}

/**
 * Pipeline Stage 1: Ingestion (文档摄入)
 *
 * 文件路径 → 加载 → 切片 → 向量化 → 存储
 */
export async function ingestDocument(
  filePath: string,
  config: RAGPipelineConfig,
): Promise<{ chunkCount: number }> {
  // 1. 加载
  const { documents } = await loadDocument(filePath);

  // 2. 切片
  const chunks = await splitDocuments(documents, {
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  });

  // 3. 向量化 + 存储
  const embeddings = getEmbeddings({
    apiKey: config.llmApiKey,
    model: config.embeddingModel,
    baseURL: config.llmBaseURL,
  });

  const store = await createPGVectorStore(embeddings, {
    host: config.pgHost,
    port: config.pgPort,
    user: config.pgUser,
    password: config.pgPassword,
    database: config.pgDatabase,
  });

  await addDocumentsToPG(
    store,
    chunks.map((c) => ({
      content: c.pageContent,
      metadata: c.metadata,
    })),
  );

  return { chunkCount: chunks.length };
}

/**
 * Pipeline Stage 2: Retrieval & Generation (检索与生成)
 *
 * 用户问题 → 归一化 retrievalMode → 分支检索 → [可选]重排 → 构建 Prompt → LLM 流式输出
 *
 * retrievalMode 支持: vector | keyword | hybrid
 * hybrid 模式下并行执行 dense + sparse 检索，通过 RRF 或 Linear 融合
 */
export async function retrieveAndChat(
  query: string,
  kbId: string,
  params: SearchParams,
  config: RAGPipelineConfig,
  callbacks: import('./llm/chat-service.js').StreamCallbacks,
): Promise<void> {
  // 1. 归一化：未传 retrievalMode 时按 useReranker 兼容映射（打 [DEPRECATED] 日志）
  //    useReranker=true → 'hybrid'，否则 'vector'
  const resolved = normalizeRetrievalMode(params);

  // 2. 检索（performSearch 按 retrievalMode 分支；含结果缓存与 minScore 过滤）
  let results = await performSearch(query, kbId, resolved, config);

  // 3. 发送引用来源
  callbacks.onSources(
    results.map((r) => ({ content: r.content, sourceFile: r.sourceFile, score: r.score })),
  );

  // 4. [可选] 重排序：Bi-Encoder 重排（与检索模式独立）；
  //    Cross-Encoder 为 stub（原样返回），见 17 号文档 §4.1
  if (resolved.useReranker && results.length > 0) {
    results = await rerank(query, results, config.embedding, { topK: resolved.topK });
  }

  // 5. 构建上下文并调用 LLM
  const context = buildContext(results);
  await streamChat(
    { query, context },
    { apiKey: config.llmApiKey, model: config.llmModel, baseURL: config.llmBaseURL },
    callbacks,
  );
}
```

## 十一、统一导出

```typescript
// packages/rag-engine/src/index.ts（与实际文件对齐）

// Loaders
export {
  loadCSV,
  loadXLSX,
  loadPDF,
  loadWord,
  loadDocument,
  detectFileType,
  type ParseStrategy,
  type LoadDocumentOptions,
} from './loaders/index.js';

// Splitters
export { splitDocuments, splitText } from './splitters/recursive-splitter.js';
export { splitMarkdownDocuments } from './splitters/markdown-splitter.js';
export { SemanticSplitter } from './splitters/semantic-splitter.js';

// Embeddings
export { getEmbeddings, embedDocuments, embedQuery } from './embeddings/openai-embeddings.js';

// Stores
export {
  createPGVectorStore,
  ensureCachedPGVectorStore,
  addDocumentsToPG,
  searchSimilarityWithScore,
  deleteByDocId,
} from './stores/pgvector-store.js';
export {
  writeSparseIndex,
  deleteSparseByDocId,
  deleteSparseByKbId,
} from './stores/sparse-store.js';
export { createMemoryStore, createMemoryStoreFromTexts } from './stores/memory-store.js';

// Cache
export {
  getCachedResults,
  setCachedResults,
  invalidateByKbId,
  getCacheStats,
} from './cache/search-cache.js';

// Tokenizer
export { tokenize, tokensToTsvString, tokensToTsQuery } from './tokenizer.js';

// Retrievers
export { similaritySearch, type VectorStoreLike } from './retrievers/similarity-retriever.js';
export { hybridSearch, type HybridSearchParams } from './retrievers/hybrid-retriever.js';
export { sparseSearch, type SparseSearchParams } from './retrievers/sparse-retriever.js';

// Fusion
export { rrfFuse, linearFuse } from './fusion/index.js';

// Rerankers
export { rerank } from './rerankers/bi-encoder-reranker.js';

// LLM
export { streamChat, buildContext, DEFAULT_SYSTEM_PROMPT } from './llm/chat-service.js';

// Pipeline
export { ingestDocument, retrieve, retrieveAndChat, getChunkIds } from './pipeline.js';

// Types（FileType / LoadResult / TextChunk / SearchParams / RetrievalResult /
//        SourceRef / StreamCallbacks / SearchDebugInfo / EmbeddingConfig / LLMConfig /
//        PGConfig / RAGPipelineConfig / IngestProgressCallback 等）
export type { SearchParams, RetrievalResult, SourceRef, RAGPipelineConfig } from './types.js';
```
