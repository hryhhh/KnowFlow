import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import TopStepsBar from '../../components/TopStepsBar';
import { traceApi } from '../../services/api';
import { Card, Spin, Tag } from 'antd';
import { ChevronRight, Clock, CheckCircle, AlertCircle, XCircle } from 'lucide-react';
import type { AgentTrace } from '../../types';

interface TraceStep {
  type: 'llm_call' | 'tool_call' | 'final_answer' | 'memory_load';
  timestamp: number;
  data: Record<string, any>;
}

export default function TracePage() {
  const { traceId } = useParams<{ traceId: string }>();
  const [trace, setTrace] = useState<AgentTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!traceId) return;
    traceApi
      .get(traceId)
      .then((res) => {
        setTrace(res.data.data);
        setLoading(false);
      })
      .catch((e) => {
        const status = e?.response?.status;
        setError(status ? `HTTP ${status}` : e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [traceId]);

  if (loading) {
    return (
      <div className="content">
        <PageHeader title="Trace 详情" breadcrumb="" />
        <TopStepsBar active={2} />
        <div style={{ padding: '80px 0', textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      </div>
    );
  }

  if (error || !trace) {
    return (
      <div className="content">
        <PageHeader title="Trace 详情" breadcrumb="" />
        <TopStepsBar active={2} />
        <div className="empty" style={{ marginTop: 40 }}>
          <AlertCircle size={40} style={{ color: 'var(--text-subtle)', marginBottom: 12 }} />
          <p>{error ?? 'Trace 不存在'}</p>
          <Link to="/dashboard" className="btn" style={{ marginTop: 16 }}>
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      <PageHeader title="Trace 详情" breadcrumb={trace.traceId ?? traceId ?? ''} />
      <TopStepsBar active={2} />

      <div className="trace-detail" style={{ maxWidth: 900, margin: '24px auto' }}>
        {/* 顶部导航：返回对话页（定位到产生本次 trace 的会话），kbId 缺失时降级首页 */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 13 }}>
          <Link
            to={
              trace.kbId
                ? `/knowledge-bases/${trace.kbId}/chat?sessionId=${trace.sessionId}`
                : '/dashboard'
            }
            className="text-blue-500 hover:underline"
          >
            ← 返回对话
          </Link>
          <Link to="/dashboard" className="text-blue-500 hover:underline">
            返回 Dashboard
          </Link>
        </div>

        {/* 头部概览 */}
        <Card className="trace-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            {statusIcon(trace.status)}
            <h2 style={{ margin: 0, fontSize: 18 }}>{trace.query}</h2>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 24,
              flexWrap: 'wrap',
              fontSize: 13,
              color: 'var(--text-sub)',
            }}
          >
            <span>
              <Clock size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              耗时 {trace.summary?.totalDurationMs ?? 0}ms
            </span>
            <span>LLM 调用 {trace.summary?.llmCalls ?? 0} 次</span>
            <span>工具调用 {trace.summary?.toolCalls ?? 0} 次</span>
            {trace.tokensUsed && (
              <span>
                Tokens: {trace.tokensUsed.total} (prompt {trace.tokensUsed.prompt} / completion{' '}
                {trace.tokensUsed.completion})
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 8 }}>
            Session: {trace.sessionId} · KB: {trace.kbId} ·{' '}
            {new Date(trace.startedAt).toLocaleString('zh-CN')}
          </div>
          {trace.errorMsg && (
            <div style={{ color: 'red', fontSize: 13, marginTop: 8 }}>❌ {trace.errorMsg}</div>
          )}
        </Card>

        {/* 执行步骤 */}
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>执行步骤</h3>
          {trace.steps.length === 0 ? (
            <Card>
              <p style={{ color: 'var(--text-sub)', margin: 0 }}>暂无步骤记录</p>
            </Card>
          ) : (
            trace.steps.map((step, idx) => <StepCard key={idx} step={step} />)
          )}
        </div>

        {/* 返回按钮 */}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Link to="/dashboard" className="btn">
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}

function StepCard({ step }: { step: TraceStep }) {
  const time = new Date(step.timestamp).toLocaleTimeString('zh-CN');
  switch (step.type) {
    case 'llm_call':
      return (
        <Card size="small" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {stepTypeBadge('llm_call')}
            <span style={{ fontSize: 13, color: 'var(--text-sub)' }}>
              {step.data.model} · {step.data.latencyMs}ms · prompt {step.data.inputTokens} /
              completion {step.data.outputTokens} tokens
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>{time}</div>
        </Card>
      );
    case 'tool_call':
      return (
        <Card size="small" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {stepTypeBadge('tool_call')}
            <strong style={{ fontSize: 13 }}>{step.data.toolName}</strong>
            {step.data.durationMs !== undefined && (
              <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                {step.data.durationMs}ms
              </span>
            )}
            {step.data.isError && <span style={{ fontSize: 12, color: 'red' }}>❌ 失败</span>}
          </div>
          {step.data.input && (
            <pre style={codeBlockStyle}>{JSON.stringify(step.data.input, null, 2)}</pre>
          )}
          {step.data.outputLength !== undefined && step.data.outputLength > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
              输出长度: {step.data.outputLength} 字符
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>{time}</div>
        </Card>
      );
    case 'final_answer':
      return (
        <Card size="small" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {stepTypeBadge('final_answer')}
            <span style={{ fontSize: 13, color: 'var(--text-sub)' }}>
              回答长度 {step.data.answerLength} 字符
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>{time}</div>
        </Card>
      );
    case 'memory_load':
      return (
        <Card size="small" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {stepTypeBadge('memory_load')}
            <span style={{ fontSize: 13, color: 'var(--text-sub)' }}>
              加载了 {step.data.messageCount} 条历史消息
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>{time}</div>
        </Card>
      );
    default:
      return null;
  }
}

function statusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckCircle size={24} className="text-green-500" />;
    case 'failed':
      return <XCircle size={24} className="text-red-500" />;
    case 'truncated':
      return <AlertCircle size={24} className="text-amber-500" />;
    default:
      return <Clock size={24} />;
  }
}

function stepTypeBadge(type: string) {
  const colors: Record<string, string> = {
    llm_call: '#3b82f6',
    tool_call: '#8b5cf6',
    final_answer: '#10b981',
    memory_load: '#f59e0b',
  };
  const labels: Record<string, string> = {
    llm_call: 'LLM',
    tool_call: 'Tool',
    final_answer: '答案',
    memory_load: '记忆',
  };
  return <Tag color={colors[type] ?? '#6b7280'}>{labels[type] ?? type}</Tag>;
}

const codeBlockStyle: React.CSSProperties = {
  background: '#f3f4f6',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  overflowX: 'auto',
  margin: '8px 0 4px',
  fontFamily: 'monospace',
  whiteSpace: 'pre-wrap',
};
