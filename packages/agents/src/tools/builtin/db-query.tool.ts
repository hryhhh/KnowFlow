import type { Tool, ToolContext, ToolResult } from '../base-tool';
import type { DbQueryExecuteFn } from '../../agents';

/**
 * query_database 工具 — 通过预定义 SQL 模板查询结构化数据
 *
 * 接收外部注入的 executeFn，templateId 使用 enum 约束，
 * LLM 只能选预定义模板，不能传任意 SQL，防止 SQL 注入。
 */
export class DbQueryTool implements Tool {
  readonly name = 'query_database';
  readonly description =
    '查询结构化数据库（知识库元数据、业务数据等）。通过预定义 SQL 模板执行参数化查询，防止 SQL 注入。';
  readonly parameters = {
    type: 'object',
    properties: {
      templateId: {
        type: 'string',
        enum: [
          'kb_stats',
          'doc_stats',
          'chunk_stats',
          'doc_list',
          'kb_list',
          'doc_creation_trend',
          'top_docs_by_chunks',
        ],
        description: '查询模板 ID，从可用模板列表中选择',
      },
      params: {
        type: 'array',
        description: '模板参数数组（由系统自动填充 kbId 等必需参数，用户无需传入）',
        items: { type: 'string' },
      },
    },
    required: ['templateId'],
  };

  constructor(private readonly executeFn: DbQueryExecuteFn) {}

  async execute(args: Record<string, any>, _ctx: ToolContext): Promise<ToolResult> {
    const rows = await this.executeFn(args.templateId, args.params ?? [], 100);
    const content = this.formatRows(rows);
    return {
      toolCallId: '',
      content,
      isError: false,
      structured: { rowCount: rows.length, rows },
    };
  }

  private formatRows(rows: any[]): string {
    if (!rows.length) return '查询结果为空';
    if (rows.length === 1 && Object.keys(rows[0]).length === 1) {
      const key = Object.keys(rows[0])[0];
      return `总计 ${rows[0][key]} 条`;
    }
    const cols = Object.keys(rows[0]);
    return [
      cols.join(' | '),
      ...rows.map((r) => cols.map((c) => String(r[c] ?? '')).join(' | ')),
    ].join('\n');
  }
}
