import { useState } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import TopStepsBar from '../../components/TopStepsBar';
import { retrievalApi } from '../../services/api';
import { useKbStore } from '../../stores/kb-store';
import type { SearchResultItem, SearchDebugInfo, SearchParams } from '../../types';
import { InputNumber, Input, Select, Slider, Switch } from 'antd';
import { Settings2, ChevronDown, ChevronUp } from 'lucide-react';

type RetrievalMode = 'vector' | 'keyword' | 'hybrid';
type FusionMethod = 'rrf' | 'linear';

export default function RetrievalPage() {
  const { kbId } = useParams();
  const current = useKbStore((s) => s.current);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [debugInfo, setDebugInfo] = useState<SearchDebugInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [params, setParams] = useState<SearchParams>({
    topK: 10,
    minScore: 0.0,
    useReranker: false,
    denseWeight: 0.5,
    retrievalMode: 'vector',
    fusionMethod: 'rrf',
    rrfK: 60,
    candidateMultiplier: 3,
    debug: false,
  });

  const search = async () => {
    if (!query.trim() || !kbId) return;
    setLoading(true);
    setDebugInfo(null);
    try {
      const res = await retrievalApi.search(kbId, query, params);
      setResults(res.data.data.results);
      if (params.debug && res.data.data.debug) {
        setDebugInfo(res.data.data.debug);
        setShowDebug(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const updateParam = <K extends keyof SearchParams>(key: K, value: SearchParams[K]) => {
    setParams((p) => ({ ...p, [key]: value }));
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

  const isHybrid = params.retrievalMode === 'hybrid';

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

          {/* 检索模式 */}
          <div className="param-row">
            <label htmlFor="retrievalMode">检索模式</label>
            <Select
              style={{ width: '100%' }}
              value={params.retrievalMode}
              onChange={(v) => updateParam('retrievalMode', v as RetrievalMode)}
              options={[
                { value: 'vector', label: '仅向量（Dense）' },
                { value: 'keyword', label: '仅关键词（Sparse）' },
                { value: 'hybrid', label: '混合检索（Dense + Sparse）' },
              ]}
            />
          </div>

          {/* hybrid 专属参数 */}
          {isHybrid && (
            <>
              <div className="param-row">
                <label htmlFor="fusionMethod">融合方式</label>
                <Select
                  style={{ width: '100%' }}
                  value={params.fusionMethod}
                  onChange={(v) => updateParam('fusionMethod', v as FusionMethod)}
                  options={[
                    { value: 'rrf', label: 'RRF（默认）' },
                    { value: 'linear', label: 'Linear 加权' },
                  ]}
                />
              </div>

              {params.fusionMethod === 'rrf' && (
                <div className="param-row">
                  <label htmlFor="rrfK">RRF K 值</label>
                  <InputNumber
                    style={{ width: '100%' }}
                    min={1}
                    max={200}
                    value={params.rrfK}
                    onChange={(v) => updateParam('rrfK', Number(v ?? 60))}
                  />
                </div>
              )}

              <div className="param-row">
                <label htmlFor="candidateMultiplier">候选倍数（per route）</label>
                <InputNumber
                  style={{ width: '100%' }}
                  min={1}
                  max={10}
                  value={params.candidateMultiplier}
                  onChange={(v) => updateParam('candidateMultiplier', Number(v ?? 1))}
                />
                <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>
                  每路候选 = topK × {params.candidateMultiplier}（上限 10）
                </span>
              </div>

              <div className="param-row">
                <label htmlFor="minDenseScore">Dense 最低分（过滤候选）</label>
                <InputNumber
                  style={{ width: '100%' }}
                  step={0.05}
                  min={0}
                  max={1}
                  placeholder="不限制"
                  value={params.minDenseScore ?? undefined}
                  onChange={(v) => updateParam('minDenseScore', v ?? null)}
                />
                <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>
                  仅 hybrid 模式生效，默认 null
                </span>
              </div>

              {params.fusionMethod === 'linear' && (
                <div className="param-row">
                  <label htmlFor="denseWeight">Dense 权重（0~1）</label>
                  <Slider
                    min={0}
                    max={1}
                    step={0.1}
                    value={params.denseWeight}
                    onChange={(v) => updateParam('denseWeight', v)}
                  />
                </div>
              )}
            </>
          )}

          {/* 公共参数 */}
          <div className="param-row">
            <label htmlFor="topK">结果返回数量（TopK）</label>
            <InputNumber
              style={{ width: '100%' }}
              min={1}
              max={50}
              value={params.topK}
              onChange={(v) => updateParam('topK', Number(v ?? 10))}
            />
          </div>

          {/* minScore 仅 vector 模式显示 */}
          {params.retrievalMode !== 'hybrid' && (
            <div className="param-row">
              <label htmlFor="minScore">最低相似度阈值</label>
              <InputNumber
                style={{ width: '100%' }}
                step={0.01}
                min={0}
                max={1}
                value={params.minScore}
                onChange={(v) => updateParam('minScore', Number(v ?? 0.5))}
              />
            </div>
          )}

          <div className="param-row">
            <label>重排模型（Reranker）</label>
            <Switch
              size="small"
              checked={params.useReranker}
              onChange={(v) => updateParam('useReranker', v)}
            />
          </div>

          <div className="param-row">
            <label>调试模式（Debug）</label>
            <Switch size="small" checked={params.debug} onChange={(v) => updateParam('debug', v)} />
            <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>
              返回各通路命中明细，仅调试用
            </span>
          </div>
        </div>

        <div className="results">
          <div className="toolbar">
            <Input.Search
              placeholder="输入查询词，回车检索"
              style={{ flex: 1, minWidth: 0 }}
              allowClear
              enterButton="检索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onSearch={() => search()}
            />
          </div>

          {/* Debug 信息面板 */}
          {debugInfo && (
            <div
              style={{
                margin: '12px 0',
                padding: '12px 16px',
                background: 'var(--panel)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius)',
              }}
            >
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  padding: 0,
                }}
                onClick={() => setShowDebug((v) => !v)}
              >
                {showDebug ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                调试信息
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--text-sub)',
                    fontWeight: 400,
                    marginLeft: 4,
                  }}
                >
                  {`mode=${debugInfo.mode}`}
                  {debugInfo.fusion && `, fusion=${debugInfo.fusion}`}
                  {`, dense=${debugInfo.denseCandidates}`}
                  {`, sparse=${debugInfo.sparseCandidates}`}
                  {`, topK=${debugInfo.fusedTopK}`}
                </span>
              </button>

              {showDebug && (
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 12,
                    marginTop: 8,
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>chunkId</th>
                      <th style={thStyle}>sourceFile</th>
                      <th style={thStyle}>rankDense</th>
                      <th style={thStyle}>rankSparse</th>
                      <th style={thStyle}>scoreDense</th>
                      <th style={thStyle}>scoreSparse</th>
                      <th style={thStyle}>scoreFused</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debugInfo.items.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td style={tdStyle}>{idx + 1}</td>
                        <td style={tdStyle}>{item.chunkId.slice(0, 8)}…</td>
                        <td style={tdStyle}>{item.sourceFile}</td>
                        <td
                          style={{
                            ...tdStyle,
                            color: item.rankDense ? 'var(--text-primary)' : 'var(--text-subtle)',
                          }}
                        >
                          {item.rankDense ?? '—'}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            color: item.rankSparse ? 'var(--text-primary)' : 'var(--text-subtle)',
                          }}
                        >
                          {item.rankSparse ?? '—'}
                        </td>
                        <td style={tdStyle}>
                          {item.scoreDense != null ? item.scoreDense.toFixed(4) : '—'}
                        </td>
                        <td style={tdStyle}>
                          {item.scoreSparse != null ? item.scoreSparse.toFixed(4) : '—'}
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>
                          {item.scoreFused.toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

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

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 600,
  color: 'var(--text-sub)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  fontFamily: 'monospace',
};
