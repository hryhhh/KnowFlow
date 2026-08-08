import { useState } from "react";
import { useParams } from "react-router-dom";
import TopStepsBar from "../../components/TopStepsBar";
import { retrievalApi } from "../../services/api";
import { useKbStore } from "../../stores/kb-store";
import type { SearchResultItem, SearchParams } from "../../types";

export default function RetrievalPage() {
  const { kbId } = useParams();
  const current = useKbStore((s) => s.current);
  const [query, setQuery] = useState("");
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

  return (
    <div className="content">
      <div className="header">知识检索 · {current?.name ?? kbId}</div>
      <TopStepsBar active={2} />

      <div className="retrieval">
        <div className="params">
          <h3 style={{ marginTop: 0 }}>📊 检索参数</h3>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>
            调整检索参数，预览知识库命中效果
          </p>

          <div className="param-row">
            <label>结果返回数量</label>
            <input
              className="input"
              type="number"
              value={params.topK}
              onChange={(e) =>
                setParams((p) => ({ ...p, topK: Number(e.target.value) }))
              }
            />
          </div>

          <div className="param-row">
            <label>最低相似度</label>
            <input
              className="input"
              type="number"
              step="0.01"
              value={params.minScore}
              onChange={(e) =>
                setParams((p) => ({ ...p, minScore: Number(e.target.value) }))
              }
            />
          </div>

          <div className="param-row">
            <label>重排模型</label>
            <span
              className={"toggle" + (params.useReranker ? " on" : "")}
              onClick={() =>
                setParams((p) => ({ ...p, useReranker: !p.useReranker }))
              }
            />
          </div>

          <div className="param-row">
            <label>Dense Weight</label>
            <input
              className="input"
              type="number"
              step="0.1"
              value={params.denseWeight}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  denseWeight: Number(e.target.value),
                }))
              }
            />
          </div>
        </div>

        <div className="results">
          <div className="toolbar">
            <input
              className="search-input"
              style={{ flex: 1 }}
              placeholder="输入查询词，回车检索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
            />
            <button
              className="btn primary"
              onClick={search}
              disabled={loading}
            >
              {loading ? "检索中…" : "检索"}
            </button>
          </div>

          {results.length === 0 ? (
            <div className="empty">输入查询词后查看命中结果</div>
          ) : (
            results.map((r, i) => (
              <div key={i} className="result-item">
                <span className="score">相似度 {r.score}</span>
                <span className="src">{r.sourceFile}</span>
                <pre>{r.content}</pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
