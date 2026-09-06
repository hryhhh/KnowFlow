import { CheckCircleOutlined, WarningOutlined, RightOutlined } from '@ant-design/icons';
import { Bot, Loader2 } from 'lucide-react';
import { Button, Card, Switch } from 'antd';
import { ThoughtChain } from '@ant-design/x';
import type { ThoughtChainItemType } from '@ant-design/x';
import { useNavigate } from 'react-router-dom';
import type { AgentActivityEvent } from '../types';

interface AgentThoughtPanelProps {
  events: AgentActivityEvent[];
  isOpen: boolean;
  onToggle: () => void;
  /** agent 是否仍在执行（仅流式中的最新消息为 true），决定是否显示进行中状态 */
  isStreaming?: boolean;
}

function oneLine(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

/** 把 SSE 事件流折叠为 ThoughtChain 节点：tool_call 与配对的 tool_result 合并为一个节点 */
function buildItems(events: AgentActivityEvent[], isStreaming?: boolean): ThoughtChainItemType[] {
  const items: ThoughtChainItemType[] = [];

  for (const e of events) {
    if (e.type === 'agent_start') {
      items.push({
        key: `start-${items.length}`,
        icon: <Bot size={14} />,
        title: `Agent 开始执行${e.data?.agent ? ` — ${e.data.agent}` : ''}`,
        status: 'success',
      });
    } else if (e.type === 'reasoning_summary') {
      items.push({
        key: `reason-${items.length}`,
        icon: <span>💭</span>,
        title: '推理',
        description: truncate(oneLine(e.summary ?? ''), 80),
        status: 'success',
      });
    } else if (e.type === 'tool_call') {
      items.push({
        key: `tool-${items.length}`,
        icon: <span>🛠</span>,
        title: `调用 ${e.toolName}`,
        description: e.args?.query ? `"${truncate(oneLine(e.args.query), 30)}"` : undefined,
        content: e.args ? (
          <pre
            style={{
              margin: 0,
              padding: 8,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 11,
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              overflowX: 'auto',
            }}
          >
            {JSON.stringify(e.args, null, 2)}
          </pre>
        ) : undefined,
        status: 'loading',
        collapsible: !!e.args,
      });
    } else if (e.type === 'tool_result') {
      // 回填最后一个仍处于 loading 的工具节点
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.key?.startsWith('tool-') && it.status === 'loading') {
          it.status = e.isError ? 'error' : 'success';
          it.description = (
            <span>
              {it.description}
              {e.durationMs && e.durationMs > 0 ? ` · ${e.durationMs}ms` : ''}
              {e.isError ? ' · 失败' : ''}
            </span>
          );
          it.content = (
            <pre
              style={{
                margin: 0,
                padding: 8,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 11,
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                overflowX: 'auto',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {e.result}
            </pre>
          );
          it.collapsible = true;
          break;
        }
      }
    } else if (e.type === 'agent_completed') {
      const isTruncated = e.status === 'truncated';
      items.push({
        key: `done-${items.length}`,
        icon: isTruncated ? (
          <WarningOutlined style={{ color: '#faad14' }} />
        ) : (
          <CheckCircleOutlined style={{ color: '#52c41a' }} />
        ),
        title: isTruncated ? '推理步骤已达上限，答案可能不完整' : 'Agent 完成',
        description: e.tokensUsed ? `${e.tokensUsed.total} tokens` : undefined,
        status: isTruncated ? 'error' : 'success',
      });
    }
  }

  // 流式进行中：末尾补一条执行中状态
  if (isStreaming && !events.some((e) => e.type === 'agent_completed')) {
    let pendingTool: string | null = null;
    for (const e of events) {
      if (e.type === 'tool_call') pendingTool = e.toolName ?? null;
      else if (e.type === 'tool_result') pendingTool = null;
    }
    items.push({
      key: 'running',
      icon: <Loader2 size={14} className="thinking-icon" />,
      title: pendingTool ? `正在执行 ${pendingTool}…` : '思考中…',
      status: 'loading',
      blink: true,
    });
  }

  return items;
}

export default function AgentThoughtPanel({
  events,
  isOpen,
  onToggle,
  isStreaming,
}: AgentThoughtPanelProps) {
  // Hook 必须在条件 return 之前调用
  const navigate = useNavigate();

  if (events.length === 0) return null;

  // trace 落库主键是 runtime 内部生成的 runId（agent_completed 事件携带）
  const runId = events.find((e) => e.type === 'agent_completed')?.data?.runId;
  const items = buildItems(events, isStreaming);

  return (
    <Card
      size="small"
      style={{ marginTop: 8 }}
      styles={{
        header: { padding: '6px 12px', minHeight: 'auto' },
        body: { padding: isOpen ? '8px 12px' : 0 },
      }}
      title={
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          🔍 Agent Activity
          <span style={{ fontSize: 12, color: 'var(--text-subtle)', marginLeft: 6 }}>
            ({events.length} 步)
          </span>
          {isStreaming && !events.some((e) => e.type === 'agent_completed') && (
            <Loader2
              size={12}
              className="thinking-icon"
              style={{ marginLeft: 8, verticalAlign: 'middle' }}
            />
          )}
        </span>
      }
      extra={<Switch size="small" checked={isOpen} onChange={onToggle} />}
    >
      {isOpen && (
        <>
          <ThoughtChain
            items={items}
            style={{ background: 'transparent' }}
            styles={{ itemContent: { fontSize: 12 } }}
          />
          {runId && (
            <Button
              type="link"
              size="small"
              icon={<RightOutlined />}
              onClick={() => navigate(`/traces/${runId}`)}
              style={{ display: 'flex', margin: '0 auto' }}
            >
              查看完整 Trace 详情
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
