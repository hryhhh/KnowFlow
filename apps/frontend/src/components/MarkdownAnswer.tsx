import { Children, Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CitationBadge from './CitationBadge';
import { normalizeContent } from '../stores/chat-store';
import type { Citation } from '../types';

interface MarkdownAnswerProps {
  content: string;
  citations?: Citation[];
}

/** 在文本片段中把 [N] 引用标记替换为上标徽章（沿用 citations 映射，持久化后仍有效） */
function renderTextWithCitations(
  text: string,
  citations: Citation[] | undefined,
  keyPrefix: string,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const idx = parseInt(m[1], 10);
    const source = citations?.find((c) => c.index === idx)?.source;
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    if (source) {
      parts.push(<CitationBadge key={`${keyPrefix}-${m.index}`} index={idx} source={source} />);
    } else {
      parts.push(
        <sup key={`${keyPrefix}-${m.index}`} className="citation-orphan">
          {idx}
        </sup>,
      );
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

/**
 * 引用标记替换应用于各块级元素的直接文本子节点；
 * code 内的 [N] 不转换（避免污染代码/表格对齐语法）。
 */
const textual = (citations: Citation[] | undefined) => (children: React.ReactNode) =>
  Children.map(children, (child, i) => {
    if (typeof child === 'string' && /\[\d+\]/.test(child)) {
      return <Fragment key={i}>{renderTextWithCitations(child, citations, `t${i}`)}</Fragment>;
    }
    return child;
  });

/**
 * 答案气泡 markdown 渲染：标题/列表/表格/加粗 + 引用角标。
 * react-markdown 默认不渲染原始 HTML；流式期间的不完整 markdown 可容错显示。
 */
export default function MarkdownAnswer({ content, citations }: MarkdownAnswerProps) {
  const withCitations = textual(citations);

  return (
    <div className="md-answer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{withCitations(children)}</p>,
          li: ({ children }) => <li>{withCitations(children)}</li>,
          td: ({ children }) => <td>{withCitations(children)}</td>,
          th: ({ children }) => <th>{withCitations(children)}</th>,
          h1: ({ children }) => <h4>{withCitations(children)}</h4>,
          h2: ({ children }) => <h4>{withCitations(children)}</h4>,
          h3: ({ children }) => <h4>{withCitations(children)}</h4>,
          h4: ({ children }) => <h4>{withCitations(children)}</h4>,
        }}
      >
        {normalizeContent(content)}
      </ReactMarkdown>
    </div>
  );
}
