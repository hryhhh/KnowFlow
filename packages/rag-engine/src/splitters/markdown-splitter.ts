import type { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

/** Markdown 感知分隔符：优先在标题层级处切分，兜底到字符级 */
const MARKDOWN_SEPARATORS = [
  '\n# ', // H1
  '\n## ', // H2
  '\n### ', // H3
  '\n#### ', // H4
  '\n\n', // 段落间空行
  '\n', // 单换行
  ' ',
  '',
];

interface HeadingTracker {
  /** 当前 heading 路径，如 ["引言", "2.1 方法"]，用于注入到每个 chunk 前缀 */
  path: string[];
  /** 当前 heading 的完整 Markdown 字符串，如 "## 方法" */
  currentHeading: string;
}

/**
 * Markdown 切片器：
 * - 优先按标题层级（# / ## / ###）切分大块
 * - 每个大块内部再用 RecursiveCharacterTextSplitter 按 chunkSize 切分
 * - 每个最终 chunk 自动携带 heading 上下文前缀，检索时保留章节语义
 * - 无标题文档退化为普通文本切分（整文限长 fallback）
 */
export interface MarkdownSplitOptions {
  /** 每个 chunk 最大字符数，默认 1000 */
  chunkSize?: number;
  /** 相邻 chunk 重叠字符数，默认 200 */
  chunkOverlap?: number;
  /** 是否在每个 chunk 前注入 heading 路径前缀，默认 true */
  prefixHeadings?: boolean;
}

/**
 * 将 MinerU 输出的 Markdown Document 切片为 TextChunk[]。
 * 同时维护 heading 上下文栈，使每个 chunk 都携带从文档顶部到当前位置的路径。
 */
export async function splitMarkdownDocuments(
  documents: Document[],
  options: MarkdownSplitOptions = {},
): Promise<Document[]> {
  const chunkSize = options.chunkSize ?? 1000;
  const chunkOverlap = options.chunkOverlap ?? 200;
  const prefixHeadings = options.prefixHeadings ?? true;

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: MARKDOWN_SEPARATORS,
  });

  const results: Document[] = [];

  for (const doc of documents) {
    const rawContent = doc.pageContent;
    const lines = rawContent.split('\n');

    // 构建 heading 上下文栈
    const tracker: HeadingTracker = { path: [], currentHeading: '' };

    // 先按标题层级粗分大块（heading 行不包含在 content 中，作为 metadata 单独保留）
    const sections: Array<{ headingLine: string; headingPath: string[]; content: string }> = [];
    let currentSectionLines: string[] = [];
    let currentSectionHeading: string = '';
    let currentSectionHeadingPath: string[] = [];

    for (const line of lines) {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        // 保存上一段
        if (currentSectionLines.length > 0) {
          sections.push({
            headingLine: currentSectionHeading,
            headingPath: [...currentSectionHeadingPath],
            content: currentSectionLines.join('\n'),
          });
        }
        // 计算新 heading 路径
        const level = match[1].length;
        const headingText = match[2];
        currentSectionHeadingPath = tracker.path.slice(0, level - 1);
        currentSectionHeadingPath.push(headingText);
        tracker.path = [...currentSectionHeadingPath];
        currentSectionHeading = match[0];
        currentSectionLines = []; // heading 行不进入 content
      } else {
        currentSectionLines.push(line);
      }
    }
    // 保存最后一段
    if (currentSectionLines.length > 0) {
      sections.push({
        headingLine: currentSectionHeading,
        headingPath: [...currentSectionHeadingPath],
        content: currentSectionLines.join('\n'),
      });
    }

    // 对每个大块独立切片（保持标题上下文完整）
    for (const section of sections) {
      if (!section.content.trim()) continue;

      const chunkPrefix = section.headingLine ? `${section.headingLine}\n` : '';

      const sectionDocs: Document[] = [
        {
          pageContent: section.content,
          metadata: {
            ...doc.metadata,
            headingPath: section.headingPath.join(' > '),
            headingLine: section.headingLine,
          },
        },
      ];

      const chunks = await splitter.splitDocuments(sectionDocs);

      for (const chunk of chunks) {
        const content = chunk.pageContent.trim();
        if (!content) continue;

        if (prefixHeadings && section.headingPath.length > 0) {
          results.push({
            pageContent: chunkPrefix + content,
            metadata: {
              ...chunk.metadata,
              headingPath: section.headingPath.join(' > '),
            },
          });
        } else {
          results.push(chunk);
        }
      }
    }

    // fallback：如果粗分后没有任何 section（例如全文无标题），用普通切分
    if (sections.length === 0 && rawContent.trim().length > 0) {
      const fallbackChunks = await splitter.splitText(rawContent);
      for (const text of fallbackChunks) {
        if (!text.trim()) continue;
        results.push({
          pageContent: text,
          metadata: { ...doc.metadata },
        });
      }
    }
  }

  return results;
}
