import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolResult } from '../base-tool';

/** 单文件读取上限，防止超大文件占满内存（结果在 ToolExecutor 层还有 4000 字符截断） */
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * read_file 工具 — 读取已上传文件的内容
 *
 * 安全约束：只允许读取 uploads 目录内的常规文本文件，禁止路径穿越与符号链接逃逸。
 */
export class ReadFileTool implements Tool {
  readonly name = 'read_file';
  readonly description =
    '读取已上传文本文件的内容（txt/md/csv/json 等）。适用于需要查看原始文件内容的场景。';
  readonly parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对于 uploads 目录）',
      },
    },
    required: ['path'],
  };

  async execute(args: Record<string, any>, _ctx: ToolContext): Promise<ToolResult> {
    const uploadsDir = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), 'uploads');
    const resolvedPath = path.resolve(uploadsDir, args.path);

    // 路径穿越防护：relative 结果为 "../" 开头或绝对路径即越界
    // （startsWith 前缀比较会被兄弟目录绕过，如 uploads2）
    const rel = path.relative(uploadsDir, resolvedPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      return {
        toolCallId: '',
        content: '',
        isError: true,
        error: { message: '路径访问被拒绝', code: 'PATH_TRAVERSAL' },
      };
    }

    try {
      // 符号链接逃逸防护：以真实路径再做一次越界校验
      const realUploads = await fs.promises.realpath(uploadsDir);
      const realPath = await fs.promises.realpath(resolvedPath);
      const realRel = path.relative(realUploads, realPath);
      if (!realRel || realRel.startsWith('..') || path.isAbsolute(realRel)) {
        return {
          toolCallId: '',
          content: '',
          isError: true,
          error: { message: '路径访问被拒绝', code: 'PATH_TRAVERSAL' },
        };
      }

      const stat = await fs.promises.stat(realPath);
      if (!stat.isFile()) {
        return {
          toolCallId: '',
          content: '',
          isError: true,
          error: { message: '目标不是常规文件', code: 'FILE_READ_ERROR' },
        };
      }
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        return {
          toolCallId: '',
          content: '',
          isError: true,
          error: {
            message: `文件过大（${Math.round(stat.size / 1024 / 1024)}MB，上限 5MB）`,
            code: 'FILE_TOO_LARGE',
          },
        };
      }

      const content = await fs.promises.readFile(realPath, 'utf-8');
      return {
        toolCallId: '',
        content,
        isError: false,
        structured: { size: content.length },
      };
    } catch (err) {
      return {
        toolCallId: '',
        content: '',
        isError: true,
        error: {
          message: err instanceof Error ? err.message : String(err),
          code: 'FILE_READ_ERROR',
        },
      };
    }
  }
}
