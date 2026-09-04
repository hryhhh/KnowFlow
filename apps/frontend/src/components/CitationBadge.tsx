import { useState, useRef, useEffect } from 'react';
import type { SourceRef } from '../types';

interface CitationBadgeProps {
  index: number;
  source: SourceRef;
}

/** 行内上标引用徽章，hover 时显示来源预览 */
export default function CitationBadge({ index, source }: CitationBadgeProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 鼠标离开时延迟隐藏，避免触发闪烁
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(true);
  };
  const hide = () => {
    timerRef.current = setTimeout(() => setVisible(false), 150);
  };
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div
      ref={ref}
      className="citation-badge"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <sup className="citation-num">{index}</sup>
      {visible && (
        <div className="citation-tooltip" onMouseEnter={show} onMouseLeave={hide}>
          <div className="citation-tooltip-file">{source.sourceFile}</div>
          <div className="citation-tooltip-score">相关度 {source.score.toFixed(4)}</div>
          <div className="citation-tooltip-content">{source.content}</div>
        </div>
      )}
    </div>
  );
}
