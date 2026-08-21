import { useState } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import TopStepsBar from '../../components/TopStepsBar';
import { retrievalApi } from '../../services/api';
import { useKbStore } from '../../stores/kb-store';
import type { SearchResultItem, SearchParams } from '../../types';
import { Search, Settings2 } from 'lucide-react';

export default function RetrievalPage() {
  const { kbId } = useParams();
  const current = useKbStore((s) => s.current);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<SearchParams>({
    topK: 10,
    minScore: 0.0,
    useReranker: false,
    denseWeight: 0.5,
  });

  const search = async () => {
    if (!query.trim() || !kbId) return;
    setLoading(true);
    try {
      const res = await retrievalApi.search(kbId, query, params);
      setResults(res.data.data.results);
    } finally {
      setLoading(false);
    }
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} style={{ background: '#fff3a1', padding: '1px 2px', borderRadius: 2 }}>
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  return (
    <div className="content">
      <PageHeader title="知识检索" breadcrumb={current?.name ?? kbId} />
      <TopStepsBar active={2} />

      <div className="retrieval">
        <div className="params">
          <h3
            style={{
              marginTop: 0,
              fontSize: 15,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Settings2 size={16} /> 检索参数
          </h3>
          <p style={{ color: 'var(--text-sub)', fontSize: 12, margin: '0 0 16px' }}>
            调整检索参数，预览知识库命中效果
          </p>

          <div className="param-row">
            <label htmlFor="topK">结果返回数量 (TopK)</label>
            <input id="topK"
              className="input"
              type="number"
              min={1}
              max={50}
              value={params.topK}
              onChange={(e) => setParams((p) => ({ ...p, topK: Number(e.target.value) }))}
            />
          </div>

          <div className="param-row">
            <label htmlFor="minScore">最低相似度阈值</label>
            <input id="minScore"
              className="input"
              type="number"
              step="0.01"
              min={0}
              max={1}
              value={params.minScore}
              onChange={(e) => setParams((p) => ({ ...p, minScore: Number(e.target.value) }))}
            />
          </div>

          <div className="param-row">
            <label>重排模型 (Reranker)</label>
            <span
              className={'toggle' + (params.useReranker ? ' on' : '')}
              onClick={() => setParams((p) => ({ ...p, useReranker: !p.useReranker }))}
            />
          </div>

          <div className="param-row">
            <label htmlFor="denseWeight">Dense Weight (0~1)</label>
            <input id="denseWeight"
              className="input"
              type="number"
              step="0.1"
              min={0}
              max={1}
              value={params.denseWeight}
              onChange={(e) => setParams((p) => ({ ...p, denseWeight: Number(e.target.value) }))}
            />
          </div>
        </div>

        <div className="results">
          <div className="toolbar">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius)',
                background: 'var(--panel)',
                overflow: 'hidden',
                flex: 1,
              }}
            >
              <Search
                size={16}
                style={{
                  padding: '0 8px',
                  color: 'var(--text-subtle)',
                  borderRight: '1px solid var(--border)',
                  flexShrink: 0,
                }}
              />
              <input
                className="search-input"
                style={{
                  flex: 1,
                  border: 'none',
                  borderRadius: 0,
                  boxShadow: 'none',
                  width: 'auto',
                  minWidth: 0,
                }}
                placeholder="输入查询词，回车检索"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
            </div>
            <button className="btn primary" onClick={search} disabled={loading}>
              {loading ? '检索中…' : '检索'}
            </button>
          </div>

          {results.length === 0 ? (
            <div className="empty">
              <p>输入查询词后查看命中结果</p>
            </div>
          ) : (
            results.map((r, i) => (
              <div key={i} className="result-item">
                <span className="score">相似度 {r.score.toFixed(4)}</span>
                <span className="src">{r.sourceFile}</span>
                <pre>{highlightMatch(r.content, query)}</pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
