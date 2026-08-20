# RAG Engine 核心引擎设计文档

> RAG (Retrieval-Augmented Generation) 核心引擎的模块化设计，涵盖文档加载、文本切片、向量化嵌入、向量存储、检索器与 LLM 集成。

## 一、引擎架构总览

```
packages/rag-engine/src/
│
├── loaders/              # 文档加载层 — 将原始文件解析为 Document[]
│   ├── csv-loader.ts         # CSV 文件加载
│   ├── xlsx-loader.ts        # Excel (XLSX) 加载
│   ├── pdf-loader.ts         # PDF 加载
│   └── word-loader.ts        # Word (.docx) 加载
│
├── splitters/            # 文本切片层 — 将 Document 拆分为语义块
│   ├── recursive-splitter.ts  # 递归字符分割器（默认）
│   └── semantic-splitter.ts   # 语义感知分割器（高级）
│
├── embeddings/           # 向量化层 — 将文本转换为稠密向量
│   └── openai-embeddings.ts   # OpenAI 兼容 Embedding 接口
│
├── stores/               # 向量存储层 — 持久化 & 检索向量数据
│   ├── pgvector-store.ts      # PGVector 持久化向量库
│   └── memory-store.ts        # 内存向量库（开发 / 测试用）
│
├── retrievers/           # 检索层 — 从向量库中召回相关内容
│   ├── similarity-retriever.ts    # 纯向量相似度检索
│   └── hybrid-retriever.ts        # 混合检索 (BM25 + Vector)
│
├── rerankers/            # 重排序层 — 对检索结果精排
│   └── cross-encoder-reranker.ts  # Cross-Encoder 重排序
│
├── llm/                  # LLM 集成层 — 流式生成回答
│   └── chat-service.ts          # 对话服务 (SSE 流式)
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

### 3.3 PDF Loader

**职责：** 解析 PDF 文件，按页面或段落切分。

```typescript
// packages/rag-engine/src/loaders/pdf-loader.ts

import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';

export async function loadPDF(filePath: string): Promise<Document[]> {
  const loader = new PDFLoader(filePath, {
    parsedItemSeparator: '\n\n', // 页面间分隔符
  });
  return await loader.load();
}
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
// packages/rag-engine/src/loaders/index.ts

import path from 'node:path';

type FileType = 'csv' | 'xlsx' | 'pdf' | 'word';

export function detectFileType(filename: string): FileType {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, FileType> = {
    '.csv': 'csv',
    '.xlsx': 'xls',
    '.xls': 'xlsx',
    '.pdf': 'pdf',
    '.docx': 'word',
    '.doc': 'word',
  };
  return map[ext] ?? 'csv'; // 默认当 CSV 处理
}

export interface LoadResult {
  documents: Document[];
  fileType: FileType;
  totalChars: number;
}

export async function loadDocument(filePath: string, fileType?: FileType): Promise<LoadResult> {
  const detectedType = fileType || detectFileType(filePath);
  let documents: Document[] = [];

  switch (detectedType) {
    case 'csv':
      documents = await loadCSV({ filePath });
      break;
    case 'xlsx':
      documents = await loadXLSX({ filePath });
      break;
    case 'pdf':
      documents = await loadPDF(filePath);
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

### 4.2 SemanticSplitter（高级）

基于语义边界的智能切片（可选增强功能）：

```typescript
// packages/rag-engine/src/splitters/semantic-splitter.ts

/**
 * 语义切片思路：
 * 1. 先用 Embedding 计算相邻句子的相似度
 * 2. 相似度骤降的位置作为边界
 * 3. 在语义边界处切分
 *
 * 适用场景：长篇论文、报告等结构化程度低的文档
 */
export class SemanticSplitter {
  // 实现略，依赖 Embedding 模型
}
```

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
# docker-compose.yml
services:
  postgres-vector-server:
    image: pgvector/pgvector:pg16
    container_name: postgres-vector-server
    ports:
      - '5432:5432'
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: 123456
      POSTGRES_DB: rag
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

纯向量相似度搜索。

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

### 7.2 混合检索器（可选增强）

结合 BM25 关键词匹配 + 向量语义相似度的混合检索。

```typescript
// packages/rag-engine/src/retrievers/hybrid-retriever.ts

/**
 * Hybrid Retriever:
 * - BM25 (关键词匹配) 权重: (1 - denseWeight)
 * - Vector (语义相似度) 权重: denseWeight
 * - 结果融合后重打分 (Reciprocal Rank Fusion)
 */
export interface HybridSearchParams extends SimilaritySearchParams {
  useReranker: boolean;
  denseWeight: number; // 0~1, 默认 0.50
}
```

## 八、重排序 (Rerankers)

### 8.1 Cross-Encoder 重排序

对初步检索结果做精细排序，提升最终相关性。

```typescript
// packages/rag-engine/src/rerankers/cross-encoder-reranker.ts

interface RerankInput {
  query: string;
  results: RetrievalResult[];
  topK?: number; // 返回前 N 条
}

/**
 * Cross-Encoder 重排序：
 * 同时输入 (query, document) 对，输出精确的相关性分数
 *
 * 注：需要额外部署 Cross-Encoder 模型（如 cross-encoder/ms-marco-MiniLM-L-6-v2）
 * 或使用云端 API 提供的重排序接口
 */
export async function rerank(input: RerankInput): Promise<RetrievalResult[]> {
  if (!input.results.length) return [];

  // TODO: 实现 Cross-Encoder 推理
  // 1. 对每个 (query, doc.content) 对调用模型
  // 2. 得到新的相关性分数
  // 3. 按分数降序排列
  // 4. 截取 topK 条

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

import { loadDocument } from "./loaders/index.js";
import { splitDocuments } from "./splitters/recursive-splitter.js";
import { getEmbeddings, embedQuery } from "./embeddings/openai-embeddings.js";
import { createPGVectorStore, addDocumentsToPG, searchSimilarityWithScore } from "./stores/pgvector-store.js";
import { streamChat, buildContext } from "./llm/chat-service.js";
import { similaritySearch } from "./retrievers/similarity-retriever.js";
import { rerank } from "./rerankers/cross-encoder-reranker.js";

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

  // 切片参数
  chunkSize: number;
  chunkOverlap: number;

  // 检索参数 (默认值)
  defaultTopK: number;
  defaultMinScore: number;
  defaultDenseWeight: number;
}

/**
 * Pipeline Stage 1: Ingestion (文档摄入)
 *
 * 文件路径 → 加载 → 切片 → 向量化 → 存储
 */
export async function ingestDocument(
  filePath: string,
  config: RAGPipelineConfig
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

  await addDocumentsToPG(store, chunks.map(c => ({
    content: c.pageContent,
    metadata: c.metadata,
  })));

  return { chunkCount: chunks.length };
}

/**
 * Pipeline Stage 2: Retrieval & Generation (检索与生成)
 *
 * 用户问题 → 向量检索 → [可选]重排序 → 构建 Prompt → LLM 流式输出
 */
export async function retrieveAndChat(
  query: string,
  kbId: string,
  params: {
    topK: number;
    minScore: number;
    useReranker: boolean;
    denseWeight: number;
  },
  config: RAGPipelineConfig,
  callbacks: import("./llm/chat-service.js").StreamCallbacks
): Promise<void> {
  // 1. 检索
  let results = await similaritySearch(
    { query, ...params },
    /* vectorStore */,
    { apiKey: config.llmApiKey, model: config.embeddingModel, baseURL: config.llmBaseURL }
  );

  // 2. 过滤低分结果
  results = results.filter(r => r.score >= params.minScore);

  // 3. 发送引用来源
  callbacks.onSources(results.map(r => ({
    content: r.document.pageContent,
    sourceFile: r.sourceFile,
    score: r.score,
  })));

  // 4. [可选] 重排序
  if (params.useReranker && results.length > 0) {
    results = await rerank({ query, results, topK: params.topK });
  }

  // 5. 构建上下文并调用 LLM
  const context = buildContext(results);
  await streamChat(
    { query, context },
    {
      apiKey: config.llmApiKey,
      model: config.llmModel,
      baseURL: config.llmBaseURL,
    },
    callbacks
  );
}
```

## 十一、统一导出

```typescript
// packages/rag-engine/src/index.ts

// Loaders
export { loadCSV } from './loaders/csv-loader.js';
export { loadXLSX } from './loaders/xlsx-loader.js';
export { loadPDF } from './loaders/pdf-loader.js';
export { loadWord } from './loaders/word-loader.js';
export { loadDocument, detectFileType } from './loaders/index.js';

// Splitters
export { splitDocuments, splitText } from './splitters/recursive-splitter.js';

// Embeddings
export { getEmbeddings, embedDocuments, embedQuery } from './embeddings/openai-embeddings.js';

// Stores
export {
  createPGVectorStore,
  addDocumentsToPG,
  searchSimilarityWithScore,
} from './stores/pgvector-store.js';
export { createMemoryStore, createMemoryStoreFromTexts } from './stores/memory-store.js';

// Retrievers
export { similaritySearch } from './retrievers/similarity-retriever.js';

// Rerankers
export { rerank } from './rerankers/cross-encoder-reranker.js';

// LLM
export { streamChat, buildContext } from './llm/chat-service.js';

// Pipeline
export { ingestDocument, retrieveAndChat } from './pipeline.js';

// Types
export type { RAGPipelineConfig } from './pipeline.js';
export type { RetrievalResult, SourceRef } from './llm/chat-service.js';
```
