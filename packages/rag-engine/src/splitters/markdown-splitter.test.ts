import { describe, it, expect } from 'vitest';
import { splitMarkdownDocuments } from './markdown-splitter.js';
import { Document } from '@langchain/core/documents';

function makeDoc(content: string, metadata: Record<string, unknown> = {}): Document {
  return new Document({ pageContent: content, metadata });
}

const SAMPLE_MARKDOWN = `# 引言

这是引言部分内容。

## 第一章：背景

这是第一章的内容。包含一些详细说明。

### 1.1 子章节

这是子章节内容。

## 第二章：方法

这是第二章的内容。

# 结论

总结部分。
`;

describe('splitMarkdownDocuments', () => {
  it('should split by heading hierarchy', async () => {
    const doc = makeDoc(SAMPLE_MARKDOWN, { source: 'test.md' });
    const results = await splitMarkdownDocuments([doc], { chunkSize: 100, chunkOverlap: 10 });
    expect(results.length).toBeGreaterThan(1);
  });

  it('should inject heading prefix when prefixHeadings is true', async () => {
    const doc = makeDoc(SAMPLE_MARKDOWN, { source: 'test.md' });
    const results = await splitMarkdownDocuments([doc], {
      chunkSize: 100,
      chunkOverlap: 10,
      prefixHeadings: true,
    });
    // At least some chunks should have heading prefix
    const hasPrefix = results.some(
      (r) => r.pageContent.startsWith('#') || r.pageContent.startsWith('##'),
    );
    expect(hasPrefix).toBe(true);
  });

  it('should not inject heading prefix when prefixHeadings is false', async () => {
    const doc = makeDoc(SAMPLE_MARKDOWN, { source: 'test.md' });
    const results = await splitMarkdownDocuments([doc], {
      chunkSize: 100,
      chunkOverlap: 10,
      prefixHeadings: false,
    });
    results.forEach((r) => {
      expect(r.pageContent.startsWith('#')).toBe(false);
    });
  });

  it('should preserve headingPath in metadata', async () => {
    const doc = makeDoc(SAMPLE_MARKDOWN, { source: 'test.md' });
    const results = await splitMarkdownDocuments([doc], { chunkSize: 100, chunkOverlap: 10 });
    const withHeadingPath = results.filter((r) => r.metadata.headingPath);
    expect(withHeadingPath.length).toBeGreaterThan(0);
    // Check heading path format
    withHeadingPath.forEach((r) => {
      expect(typeof r.metadata.headingPath).toBe('string');
    });
  });

  it('should fallback to plain text splitting for no-title documents', async () => {
    const plainText =
      '这是一段没有标题的纯文本内容。需要被切分成多个块。每个块的大小由chunkSize控制。';
    const doc = makeDoc(plainText, { source: 'plain.txt' });
    const results = await splitMarkdownDocuments([doc], { chunkSize: 20, chunkOverlap: 5 });
    expect(results.length).toBeGreaterThan(0);
  });

  it('should skip empty sections', async () => {
    // Document with only headings and no content
    const doc = makeDoc('# 标题一\n\n## 标题二\n\n', { source: 'empty.md' });
    const results = await splitMarkdownDocuments([doc], { chunkSize: 100, chunkOverlap: 10 });
    // Should not produce empty chunks
    expect(results.every((r) => r.pageContent.trim())).toBe(true);
  });

  it('should respect chunkSize within sections', async () => {
    const longSection = '## 长章节\n\n' + '重复文本 '.repeat(200);
    const doc = makeDoc(longSection, { source: 'long.md' });
    const results = await splitMarkdownDocuments([doc], { chunkSize: 50, chunkOverlap: 10 });
    results.forEach((r) => {
      expect(r.pageContent.length).toBeLessThanOrEqual(60); // chunkSize + some buffer
    });
  });

  it('should handle mixed markdown content (headings, tables, code)', async () => {
    const mixed = `# 文档

## 表格示例

| 列A | 列B |
|-----|-----|
| 值1 | 值2 |

## 代码示例

\`\`\`
def hello():
    print("world")
\`\`\`

## 说明文字

这是一段说明文字。`;
    const doc = makeDoc(mixed, { source: 'mixed.md' });
    const results = await splitMarkdownDocuments([doc], { chunkSize: 100, chunkOverlap: 10 });
    expect(results.length).toBeGreaterThan(0);
    const contents = results.map((r) => r.pageContent);
    expect(contents.some((c) => c.includes('| 列A |'))).toBe(true);
    expect(contents.some((c) => c.includes('def hello'))).toBe(true);
    expect(contents.some((c) => c.includes('说明文字'))).toBe(true);
  });

  it('should preserve original metadata', async () => {
    const doc = makeDoc('# 标题\n\n内容', { kbId: 'test-kb', customField: 'value' });
    const results = await splitMarkdownDocuments([doc], { chunkSize: 100, chunkOverlap: 10 });
    results.forEach((r) => {
      expect(r.metadata.kbId).toBe('test-kb');
      expect(r.metadata.customField).toBe('value');
    });
  });

  it('should handle empty document', async () => {
    const doc = makeDoc('', { source: 'empty.md' });
    const results = await splitMarkdownDocuments([doc], { chunkSize: 100, chunkOverlap: 10 });
    expect(results).toHaveLength(0);
  });
});
