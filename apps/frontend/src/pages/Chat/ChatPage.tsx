import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import TopStepsBar from '../../components/TopStepsBar';
import { useKbStore } from '../../stores/kb-store';
import { useChatStore } from '../../stores/chat-store';
import { apiServiceApi } from '../../services/api';
import type { ApiServiceItem } from '../../types';
import CreateServiceModal from './CreateServiceModal';
import ApiUsagePanel from './ApiUsagePanel';
import { Send, Bot, Loader2, MessageSquare, Trash2, Trash, Plus } from 'lucide-react';

export default function ChatPage() {
  const { kbId } = useParams();
  const current = useKbStore((s) => s.current);
  const {
    messages,
    sources,
    searchParams,
    isStreaming,
    isCreating,
    sessions,
    currentSessionId,
    send,
    setParams,
    loadSessions,
    switchSession,
    deleteSession,
    clearAllSessions,
    createSession,
  } = useChatStore();
  const [input, setInput] = useState('');
  const [services, setServices] = useState<ApiServiceItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedService, setSelectedService] = useState<ApiServiceItem | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadServices = async () => {
    const res = await apiServiceApi.list();
    setServices(res.data.data);
  };

  useEffect(() => {
    loadServices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (kbId) {
      loadSessions(kbId);
      // 如果当前没有会话，创建一个新的
      if (sessions.length === 0) {
        // 不自动创建，让用户手动创建或发送第一条消息
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId]);

  const onSubmit = () => {
    if (!kbId || !input.trim()) return;
    send(kbId, input.trim());
    setInput('');
  };

  const handleClearAll = async () => {
    if (!kbId) return;
    if (!confirm('确认删除全部会话记录？此操作不可恢复。')) return;
    await clearAllSessions(kbId);
  };

  const handleCreateSession = async () => {
    if (!kbId || isStreaming || isCreating) return;
    // 如果当前已有空白会话，直接切换过去，不重复创建
    const activeSession = sessions.find(
      (s) => s.id === currentSessionId && s.messageCount === 0,
    );
    if (activeSession) {
      switchSession(activeSession.id);
      return;
    }
    await createSession(kbId, '');
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (confirmDeleteId === sessionId) {
      await deleteSession(sessionId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(sessionId);
      setTimeout(() => setConfirmDeleteId(null), 3000);
    }
  };

  const formatTime = (dateStr: string) => {
    // 用 Date.parse 获取 UTC 时间戳，避免 ISO 字符串时区解析歧义
    const dateTs = Date.parse(dateStr);
    const nowTs = Date.now();
    const diff = nowTs - dateTs;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return new Date(dateTs).toLocaleDateString('zh-CN');
  };

  return (
    <div className="content chat-page">
      <PageHeader title="知识问答" breadcrumb={current?.name ?? kbId} />
      <TopStepsBar active={2} />

      <div className="chat">
        {/* 左：会话历史 + 引用来源 */}
        <div className="left-panel">
          {/* 上：会话历史 */}
          <div className="session-history">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                <MessageSquare size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                会话历史
              </h3>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn"
                  style={{ padding: '4px 10px', fontSize: 12, height: 28 }}
                  onClick={handleCreateSession}
                  disabled={isStreaming || isCreating}
                  title="新建空白会话"
                >
                  <Plus size={12} style={{ marginRight: 4 }} />
                  新建
                </button>
                <button
                  className="btn"
                  style={{ padding: '4px 10px', fontSize: 12, height: 28 }}
                  onClick={handleClearAll}
                  title="清空全部会话记录"
                  disabled={sessions.length === 0}
                >
                  <Trash size={12} style={{ marginRight: 4 }} />
                  清空
                </button>
              </div>
            </div>
            <div className="session-list">
              {sessions.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-sub)', margin: 0 }}>暂无历史会话</p>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
                    onClick={() => switchSession(session.id)}
                  >
                    <div className="session-item-content">
                      <div className="session-item-title">{session.title}</div>
                      <div className="session-item-time">
                        {formatTime(session.createdAt)} · {session.messageCount} 条消息
                      </div>
                    </div>
                    <button
                      className="session-item-delete"
                      onClick={(e) => handleDeleteSession(e, session.id)}
                      title={confirmDeleteId === session.id ? '确认删除' : '删除会话'}
                    >
                      {confirmDeleteId === session.id ? '确认?' : <Trash2 size={14} />}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 下：引用来源 */}
          <div className="sources">
            <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 600 }}>引用来源</h3>
            <p style={{ color: 'var(--text-sub)', fontSize: 12, margin: '0 0 12px' }}>
              回答使用到的命中切片将显示在此
            </p>
            {sources.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-sub)' }}>暂无来源</p>
            ) : (
              sources.map((s, i) => (
                <div key={i} className="source-item">
                  <div>
                    <span className="score">{s.sourceFile}</span> · score {s.score.toFixed(4)}
                  </div>
                  <pre>{s.content}</pre>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 中：对话 */}
        <div className="conversation">
          <div className="messages">
            {messages.length === 0 ? (
              <div className="empty">
                <Bot
                  size={40}
                  strokeWidth={1.5}
                  style={{ color: 'var(--text-subtle)', marginBottom: 12 }}
                />
                <p style={{ fontWeight: 500, fontSize: 15 }}>知识库助手</p>
                <p>我可以阅读知识库的资料并使用自然语言回答你的问题</p>
                <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 8 }}>
                  开始对话后将自动创建新会话
                </p>
              </div>
            ) : (
              <>
                {messages.map((m, i) => (
                  <div key={i} className={'msg ' + m.role}>
                    {m.content}
                  </div>
                ))}
                {isStreaming && (
                  <div className="msg assistant thinking">
                    <Loader2 size={16} className="thinking-icon" />
                    <span>正在思考…</span>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="chat-input">
            <input
              className="input"
              placeholder="我可以阅读知识库的资料并使用自然语言回答你的问题"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
            />
            <button className="btn primary" onClick={onSubmit} disabled={isStreaming}>
              <Send size={16} />
              {isStreaming ? '回答中…' : '发送'}
            </button>
          </div>
        </div>

        {/* 右：参数设置 */}
        <div className="params" style={panelStyle}>
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 600 }}>模型回答参数</h3>
          <p style={{ color: 'var(--text-sub)', fontSize: 12, margin: '0 0 16px' }}>
            调整检索参数，预览知识库命中效果
          </p>
          <ParamRow label="结果返回数量">
            <input
              className="input"
              type="number"
              value={searchParams.topK}
              onChange={(e) => setParams({ topK: Number(e.target.value) })}
            />
          </ParamRow>
          <ParamRow label="最低相似度">
            <input
              className="input"
              type="number"
              step="0.01"
              value={searchParams.minScore}
              onChange={(e) => setParams({ minScore: Number(e.target.value) })}
            />
          </ParamRow>
          <ParamRow label="重排模型">
            <span
              className={'toggle' + (searchParams.useReranker ? ' on' : '')}
              onClick={() => setParams({ useReranker: !searchParams.useReranker })}
            />
          </ParamRow>
          <ParamRow label="Dense Weight">
            <input
              className="input"
              type="number"
              step="0.1"
              value={searchParams.denseWeight}
              onChange={(e) => setParams({ denseWeight: Number(e.target.value) })}
            />
          </ParamRow>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '18px 0' }} />

          <h3 style={{ fontSize: 15, fontWeight: 600 }}>服务调用</h3>
          <p style={{ color: 'var(--text-sub)', fontSize: 12, margin: '0 0 12px' }}>
            发布当前问答参数，生成 API Key 供外部系统集成
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className="btn" onClick={() => setShowCreate(true)}>
              创建服务调用
            </button>
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateServiceModal
          kbId={kbId ?? ''}
          onClose={() => setShowCreate(false)}
          onCreated={(svc) => {
            setSelectedService(svc);
            loadServices();
          }}
        />
      )}
    </div>
  );
}

const panelStyle: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
  overflow: 'auto',
  boxShadow: 'var(--shadow-sm)',
};

function ParamRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="param-row">
      <label>{label}</label>
      {children}
    </div>
  );
}
