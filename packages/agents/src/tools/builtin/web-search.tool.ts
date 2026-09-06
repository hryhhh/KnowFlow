import type { SearchProvider, SearchResult } from '../../types';
import type { Tool, ToolContext, ToolResult } from '../base-tool';

/**
 * web_search 工具 — 搜索互联网获取最新信息
 *
 * 复用 SearchProvider 接口，支持 Tavily / Serper 等可插拔 provider。
 */
export class WebSearchTool implements Tool {
  readonly name = 'web_search';
  readonly description = '搜索互联网获取最新信息。适用于查询新闻、实时动态、概念科普等外部信息。';
  readonly parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      maxResults: {
        type: 'integer',
        description: '最大返回结果数，默认 3',
        default: 3,
      },
    },
    required: ['query'],
  };

  constructor(private readonly provider: SearchProvider) {}

  async execute(args: Record<string, any>, _ctx: ToolContext): Promise<ToolResult> {
    const results = await this.provider.search(args.query, {
      max_results: args.maxResults ?? 3,
    });
    const content = results.map((r: SearchResult) => `【${r.title}】\n${r.snippet}`).join('\n\n');
    return {
      toolCallId: '',
      content: content || '未找到相关结果',
      isError: false,
      structured: { count: results.length, results },
    };
  }
}
