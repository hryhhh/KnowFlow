import { Tooltip } from 'antd';
import type { SourceRef } from '../types';

interface CitationBadgeProps {
  index: number;
  source: SourceRef;
}

/** 行内上标引用徽章，hover 时显示来源预览（antd Tooltip） */
export default function CitationBadge({ index, source }: CitationBadgeProps) {
  return (
    <Tooltip
      title={
        <div>
          <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{source.sourceFile}</div>
          <div style={{ fontSize: 11, opacity: 0.75, margin: '2px 0 4px' }}>
            相关度 {source.score.toFixed(4)}
          </div>
          <div
            style={{
              fontSize: 12,
              maxHeight: 180,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.5,
            }}
          >
            {source.content}
          </div>
        </div>
      }
      styles={{ root: { maxWidth: 420 } }}
    >
      <span className="citation-badge">
        <sup className="citation-num">{index}</sup>
      </span>
    </Tooltip>
  );
}
