import { useEffect, useState, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { App, Button, InputNumber, Slider, Switch } from 'antd';
import { Bubble, Conversations, Sender, Welcome } from '@ant-design/x';
import PageHeader from '../../components/PageHeader';
import TopStepsBar from '../../components/TopStepsBar';
import MarkdownAnswer from '../../components/MarkdownAnswer';
import { useKbStore } from '../../stores/kb-store';
import { useChatStore } from '../../stores/chat-store';
import { apiServiceApi } from '../../services/api';
import type { ApiServiceItem, ProcessIndicator } from '../../types';
import CreateServiceModal from './CreateServiceModal';
import ApiUsagePanel from './ApiUsagePanel';
import AgentThoughtPanel from '../../components/AgentThoughtPanel';
import { Bot, Loader2, MessageSquare, Trash2, Trash, Plus } from 'lucide-react';

export default function ChatPage() {
  const { kbId } = useParams();
  const [urlSearchParams, setSearchParams] = useSearchParams();
  const current = useKbStore((s) => s.current);
  // 使用 selector 订阅每个状态，确保变化时触发重渲染
  const messages = useChatStore((s) => s.messages);
  const sources = useChatStore((s) => s.sources);
  const processIndicators = useChatStore((s) => s.processIndicators);
  const searchParams = useChatStore((s) => s.searchParams);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const send = useChatStore((s) => s.send);
  const setParams = useChatStore((s) => s.setParams);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const switchSession = useChatStore((s) => s.switchSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const clearAllSessions = useChatStore((s) => s.clearAllSessions);
  const createSession = useChatStore((s) => s.createSession);
  const agentEvents = useChatStore((s) => s.agentEvents);
  const showAgentActivity = useChatStore((s) => s.showAgentActivity);
  const toggleAgentActivity = useChatStore((s) => s.toggleAgentActivity);
  const [input, setInput] = useState('');
  const [services, setServices] = useState<ApiServiceItem[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 过滤掉空白会话（messageCount === 0），只显示有消息的会话
  const visibleSessions = sessions.filter((s) => s.messageCount > 0);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedService, setSelectedService] = useState<ApiServiceItem | null>(null);

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

  // 会话深链：/chat?sessionId=xxx（Trace 详情页「返回对话」入口）
  // 挂载时恢复指定会话；会话可能已被删除，失败时静默降级为普通聊天页
  useEffect(() => {
    const sid = urlSearchParams.get('sessionId');
    if (sid) {
      if (sid !== currentSessionId) {
        switchSession(sid).catch(() => {});
      }
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新消息或处理中指示器出现时自动滚动到底部
  useEffect(() => {
    const el = messagesEndRef.current;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, processIndicators]);

  const onSubmit = () => {
    if (!kbId || !input.trim()) return;
    send(kbId, input.trim());
    setInput('');
  };

  const { modal } = App.useApp();

  const handleClearAll = () => {
    if (!kbId) return;
    modal.confirm({
      title: '清空全部会话记录？',
      content: '此操作不可恢复。',
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => clearAllSessions(kbId),
    });
  };

  const handleCreateSession = async () => {
    if (!kbId || isStreaming) return;
    // 用 Zustand getState() 读取最新状态，避免 React 闭包捕获旧值导致判断失效
    const { sessions, currentSessionId } = useChatStore.getState();
    const current = sessions.find((s) => s.id === currentSessionId && s.messageCount === 0);
    if (current) return; // 已有空白会话，不重复创建
    await createSession(kbId, '');
  };

  const handleDeleteSession = async (sessionId: string) => {
    await deleteSession(sessionId);
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
                  disabled={isStreaming}
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
                  disabled={visibleSessions.length === 0}
                >
                  <Trash size={12} style={{ marginRight: 4 }} />
                  清空
                </button>
              </div>
            </div>
            <Conversations
              items={visibleSessions.map((s) => ({ key: s.id, label: s.title }))}
              activeKey={currentSessionId ?? undefined}
              onActiveChange={(id) => switchSession(String(id))}
              menu={(session) => ({
                items: [{ key: 'delete', danger: true, label: '删除', icon: <Trash2 size={12} /> }],
                onClick: ({ key }) => {
                  if (key === 'delete') handleDeleteSession(String(session.key));
                },
              })}
            />
            {visibleSessions.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-sub)', margin: 0 }}>暂无历史会话</p>
            )}
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
              <Welcome
                variant="borderless"
                icon={<Bot size={28} strokeWidth={1.5} />}
                title="知识库助手"
                description="我可以阅读知识库的资料并使用自然语言回答你的问题"
                extra={
                  <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                    开始对话后将自动创建新会话
                  </span>
                }
              />
            ) : (
              <>
                {messages.map((m, i) => (
                  <div key={i} className={'msg ' + m.role}>
                    {m.role === 'assistant' ? (
                      <MarkdownAnswer content={m.content} citations={m.citations} />
                    ) : (
                      m.content
                    )}
                    {/* Agent Activity 面板：历史回答展示各自挂载的事件；
                        流式中的最新回答实时展示全局事件流 */}
                    {m.role === 'assistant' &&
                      ((m.agentEvents?.length ?? 0) > 0 ||
                        (isStreaming && i === messages.length - 1 && agentEvents.length > 0)) && (
                        <AgentThoughtPanel
                          events={(m.agentEvents?.length ?? 0) > 0 ? m.agentEvents! : agentEvents}
                          isStreaming={isStreaming && i === messages.length - 1}
                          isOpen={showAgentActivity}
                          onToggle={toggleAgentActivity}
                        />
                      )}
                  </div>
                ))}
                {processIndicators.length > 0 && (
                  <div className="process-indicators">
                    {processIndicators.map((p, i) => (
                      <div key={i} className="msg assistant process-indicator">
                        <Loader2 size={14} className="thinking-icon" />
                        <span>{p.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
          <Sender
            placeholder="我可以阅读知识库的资料并使用自然语言回答你的问题"
            value={input}
            onChange={(v) => setInput(v)}
            onSubmit={() => onSubmit()}
            onCancel={() => {}}
            loading={isStreaming}
          />
        </div>

        {/* 右：参数设置 */}
        <div className="params" style={panelStyle}>
          <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 600 }}>模型回答参数</h3>
          <p style={{ color: 'var(--text-sub)', fontSize: 12, margin: '0 0 16px' }}>
            调整检索参数，预览知识库命中效果
          </p>
          <ParamRow label="结果返回数量">
            <InputNumber
              style={{ width: '100%' }}
              min={1}
              max={50}
              value={searchParams.topK}
              onChange={(v) => setParams({ topK: Number(v ?? 10) })}
            />
          </ParamRow>
          <ParamRow label="最低相似度">
            <InputNumber
              style={{ width: '100%' }}
              step={0.01}
              min={0}
              max={1}
              value={searchParams.minScore}
              onChange={(v) => setParams({ minScore: Number(v ?? 0.7) })}
            />
          </ParamRow>
          <ParamRow label="重排模型">
            <Switch
              size="small"
              checked={searchParams.useReranker}
              onChange={(v) => setParams({ useReranker: v })}
            />
          </ParamRow>
          <ParamRow label="Dense Weight">
            <Slider
              min={0}
              max={1}
              step={0.1}
              value={searchParams.denseWeight}
              onChange={(v) => setParams({ denseWeight: v })}
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
