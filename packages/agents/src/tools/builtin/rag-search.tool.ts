/** 检索结果（与 rag-engine RetrievalResult 结构一致，避免跨包依赖） */
interface RetrievalResultLike {
  content: string;
  score: number;
  sourceFile: string;
  metadata: Record<string, unknown>;
}
import type { Tool, ToolContext, ToolResult } from '../base-tool';

/**
 * rag_search 工具 — 在知识库中检索文档片段
 *
 * 接收外部注入的 retrieve 函数（来自 @knowbase-x/rag-engine），
 * 不调用 LLM，只返回检索到的文档片段供 LLM 参考。
 */
export class RagSearchTool implements Tool {
  readonly name = 'rag_search';
  readonly description = '在知识库中搜索与查询相关的文档片段。适用于需要内部文档信息回答问题时。';
  readonly parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索查询词' },
      topK: {
        type: 'integer',
        description: '返回结果数量，默认 5，最大 20',
        default: 5,
      },
      minScore: {
        type: 'number',
        description: '最低相关度分数，默认 0.5',
        default: 0.5,
      },
    },
    required: ['query'],
  };

  constructor(
    private readonly retrieveFn: (
      query: string,
      kbId: string,
      params: { topK: number; minScore: number },
    ) => Promise<RetrievalResultLike[]>,
  ) {}

  async execute(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    const topK = Math.max(1, Math.min(args.topK ?? 5, 20));
    const minScore = args.minScore ?? 0.5;

    const results = await this.retrieveFn(args.query, ctx.kbId, {
      topK,
      minScore,
    });

    const documents = results.map((r, i) => `[${i + 1}] ${r.content}`).join('\n\n');
    const sources = results.map((r) => ({
      sourceFile: r.sourceFile,
      score: r.score,
    }));

    return {
      toolCallId: '',
      content: documents || '未找到相关文档',
      isError: false,
      structured: { count: results.length, sources },
    };
  }
}
