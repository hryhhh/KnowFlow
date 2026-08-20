import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import TopStepsBar from '../../components/TopStepsBar';
import { useKbStore } from '../../stores/kb-store';
import { apiServiceApi } from '../../services/api';
import type { ApiServiceItem } from '../../types';
import { Play, Loader2, Copy, CheckCircle, ServerCrash } from 'lucide-react';

interface LogEntry {
  id: number;
  time: string;
  type: 'event' | 'token' | 'source' | 'error' | 'info';
  content: string;
}

export default function ApiTestPage() {
  const { kbId } = useParams<{ kbId: string }>();
  const navigate = useNavigate();
  const current = useKbStore((s) => s.current);
  const [services, setServices] = useState<ApiServiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [topK, setTopK] = useState(5);
  const [denseWeight, setDenseWeight] = useState(0.6);
  const [isTesting, setIsTesting] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addLog = (type: LogEntry['type'], content: string) => {
    setLogs((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), type, content },
    ]);
  };

  useEffect(() => {
    if (!kbId) return;
    setLoading(true);
    apiServiceApi
      .list()
      .then((res) => setServices(res.data.data))
      .finally(() => setLoading(false));
  }, [kbId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleTest = async () => {
    if (!apiKeyInput.trim() || !queryInput.trim()) return;
    setIsTesting(true);
    setLogs([]);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const selectedService = services.find((s) => s.id === apiKeyInput.split(':')[0]);
    const token = apiKeyInput.includes(':') ? apiKeyInput.split(':')[1] : apiKeyInput;

    addLog('info', `开始测试 → ${selectedService?.serviceName ?? '自定义'} / ${queryInput}`);

    try {
      const response = await fetch(`/api/service-calls/${selectedService?.id}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: queryInput,
          params: { topK, minScore: 0.1, useReranker: false, denseWeight },
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      addLog('event', `✅ 连接成功 (${response.status})`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          try {
            const event = JSON.parse(payload);
            switch (event.type) {
              case 'session_id':
                addLog('event', `📋 session_id: ${event.value ?? '(新建)'}`);
                break;
              case 'sources':
                const srcs = event.value as Array<{ sourceFile: string; score: number }>;
                addLog(
                  'source',
                  `📎 ${srcs.length} 个来源 → ${srcs.map((s) => s.sourceFile).join(', ')}`,
                );
                break;
              case 'token':
                addLog('token', event.value);
                break;
              case 'done':
                addLog('event', '✅ 回答完成');
                break;
              case 'error':
                addLog('error', `❌ ${event.value}`);
                break;
            }
          } catch {
            addLog('error', `解析失败: ${payload.slice(0, 100)}`);
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        addLog('info', '⏹ 测试已取消');
      } else {
        addLog('error', `❌ ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setIsTesting(false);
    }
  };

  const handleCopyKey = (key: string, id: string) => {
    navigator.clipboard.writeText(key);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="content">
      <PageHeader title="API 调用测试" breadcrumb={current?.name ?? kbId} />
      <TopStepsBar active={3} />

      <div className="retrieval">
        {/* 左侧：服务列表 + 测试面板 */}
        <div className="params" style={{ flex: '0 0 340px' }}>
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 600 }}>已发布的 API 服务</h3>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-sub)' }}>
              <Loader2 size={16} className="thinking-icon" />
            </div>
          ) : services.length === 0 ? (
            <div
              style={{ padding: 20, textAlign: 'center', color: 'var(--text-sub)', fontSize: 13 }}
            >
              暂无 API 服务
              <br />
              <button
                className="btn primary"
                style={{ marginTop: 8 }}
                onClick={() => navigate(`../chat`)}
              >
                去创建服务
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {services.map((svc) => (
                <div
                  key={svc.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 12,
                    background: 'var(--panel)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{svc.serviceName}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>
                      {svc.callCount} 次调用
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
                    {svc.keyPrefix}...
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn"
                      style={{ flex: 1, padding: '4px 8px', fontSize: 12, height: 28 }}
                      onClick={() => handleCopyKey(svc.id, svc.id)}
                    >
                      {copiedId === svc.id ? <CheckCircle size={12} /> : <Copy size={12} />}
                      复制服务 ID
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

          <h3 style={{ fontSize: 15, fontWeight: 600, marginTop: 0 }}>快速测试</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label
                style={{
                  fontSize: 12,
                  color: 'var(--text-sub)',
                  marginBottom: 4,
                  display: 'block',
                }}
              >
                API Key（格式：服务ID:完整key）
              </label>
              <input
                className="input"
                placeholder="390baef4-...:ek_xxxxxxxx"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
              />
            </div>
            <div>
              <label
                style={{
                  fontSize: 12,
                  color: 'var(--text-sub)',
                  marginBottom: 4,
                  display: 'block',
                }}
              >
                查询内容
              </label>
              <input
                className="input"
                placeholder="输入要测试的问题..."
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTest()}
              />
            </div>
            <div>
              <label htmlFor="apitest-topk" style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                TopK
              </label>
              <input
                id="apitest-topk"
                className="input"
                type="number"
                min={1}
                max={50}
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="apitest-dense" style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                DenseWeight
              </label>
              <input
                id="apitest-dense"
                className="input"
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={denseWeight}
                onChange={(e) => setDenseWeight(Number(e.target.value))}
              />
            </div>
            <button
              className="btn primary"
              onClick={handleTest}
              disabled={isTesting || !apiKeyInput.trim() || !queryInput.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {isTesting ? <Loader2 size={14} className="thinking-icon" /> : <Play size={14} />}
              发送测试
            </button>
          </div>
        </div>

        {/* 右侧：日志输出 */}
        <div
          className="results"
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>调用日志</h3>
            {logs.length > 0 && (
              <button
                className="btn"
                style={{ padding: '4px 10px', fontSize: 12, height: 28 }}
                onClick={() => setLogs([])}
              >
                清空
              </button>
            )}
          </div>
          {logs.length === 0 ? (
            <div
              className="empty"
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ServerCrash
                size={32}
                strokeWidth={1.5}
                style={{ color: 'var(--text-subtle)', marginBottom: 8 }}
              />
              <p style={{ fontWeight: 500, fontSize: 14 }}>选择 API 服务并发送测试请求</p>
              <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
                日志将在此处实时显示
              </p>
            </div>
          ) : (
            <div
              style={{
                background: '#1e1e1e',
                borderRadius: 8,
                padding: 12,
                flex: 1,
                overflow: 'auto',
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.8,
              }}
            >
              {logs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    display: 'flex',
                    gap: 8,
                    color:
                      log.type === 'error'
                        ? '#f87171'
                        : log.type === 'token'
                          ? '#d4d4d4'
                          : log.type === 'source'
                            ? '#86efac'
                            : log.type === 'event'
                              ? '#60a5fa'
                              : '#94a3b8',
                  }}
                >
                  <span style={{ color: '#64748b', flexShrink: 0 }}>{log.time}</span>
                  <span>{log.content}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
