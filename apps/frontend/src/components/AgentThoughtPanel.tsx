import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { AgentActivityEvent } from '../types';

interface AgentThoughtPanelProps {
  events: AgentActivityEvent[];
  isOpen: boolean;
  onToggle: () => void;
  /** agent 是否仍在执行（仅流式中的最新消息为 true），决定是否显示进行中状态行 */
  isStreaming?: boolean;
}

/** 压缩空白为单行，避免多行 markdown 摘要在事件行里堆叠 */
function oneLine(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

/** 展开/收起 pill 按钮：固定行尾，样式与事件文本区分 */
function ToggleButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
    >
      {expanded ? '收起' : '详情'}
      {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
    </button>
  );
}

/** 单条事件；参数/结果支持展开查看完整内容 */
function EventItem({ event }: { event: AgentActivityEvent }) {
  const [expanded, setExpanded] = useState(false);

  if (event.type === 'agent_start') {
    return (
      <div className="flex items-center gap-2 text-blue-600 text-xs font-medium">
        <Clock size={12} className="shrink-0 animate-spin" />
        <span>Agent 开始执行</span>
        {event.data?.agent && <span className="text-blue-400">— {event.data.agent}</span>}
      </div>
    );
  }

  if (event.type === 'tool_call') {
    const hasArgs = event.args && Object.keys(event.args).length > 0;
    return (
      <div className="text-xs text-gray-600">
        <div className="flex items-center gap-2">
          <Clock size={12} className="text-blue-500 shrink-0" />
          <span className="shrink-0">
            调用 <strong>{event.toolName}</strong>
          </span>
          {event.args?.query && (
            <span className="min-w-0 flex-1 truncate text-gray-400">
              "{truncate(oneLine(event.args.query), 30)}"
            </span>
          )}
          {hasArgs && <ToggleButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />}
        </div>
        {expanded && hasArgs && (
          <pre className="ml-5 mt-1 rounded border border-gray-100 bg-gray-50 p-2 text-[11px] leading-relaxed font-mono whitespace-pre-wrap overflow-x-auto">
            {JSON.stringify(event.args, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  if (event.type === 'tool_result') {
    const icon = event.isError ? (
      <AlertCircle size={12} className="text-red-500 shrink-0" />
    ) : (
      <CheckCircle size={12} className="text-green-500 shrink-0" />
    );
    const hasResult = !!event.result;
    return (
      <div className="pl-4 text-xs text-gray-600">
        <div className="flex items-center gap-2">
          {icon}
          <span className="shrink-0">{event.toolName} 完成</span>
          {event.durationMs && event.durationMs > 0 ? (
            <span className="shrink-0 text-gray-400">{event.durationMs}ms</span>
          ) : null}
          {event.result && (
            <span className="min-w-0 flex-1 truncate text-gray-400">
              — {truncate(oneLine(event.result), 40)}
            </span>
          )}
          {hasResult && (
            <ToggleButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
          )}
        </div>
        {expanded && hasResult && (
          <pre className="mt-1 rounded border border-gray-100 bg-gray-50 p-2 text-[11px] leading-relaxed font-mono whitespace-pre-wrap overflow-x-auto">
            {event.result}
          </pre>
        )}
      </div>
    );
  }

  if (event.type === 'reasoning_summary') {
    return (
      <div className="truncate pl-4 text-xs text-gray-400 italic">
        💭 {oneLine(event.summary ?? '')}
      </div>
    );
  }

  if (event.type === 'agent_completed') {
    const isTruncated = event.status === 'truncated';
    return (
      <div className="flex items-center gap-2 text-xs border-t pt-1.5 mt-1">
        {isTruncated ? (
          <AlertCircle size={12} className="text-amber-500 shrink-0" />
        ) : (
          <CheckCircle size={12} className="text-green-500 shrink-0" />
        )}
        <span className={isTruncated ? 'text-amber-600' : 'text-gray-500'}>
          {isTruncated ? '推理步骤已达上限，答案可能不完整' : 'Agent 完成'}
        </span>
        {event.tokensUsed && (
          <span className="text-gray-400">· {event.tokensUsed.total} tokens</span>
        )}
      </div>
    );
  }

  return null;
}

/** 进行中状态行：仍在执行的工具显示 spinner，否则显示思考中 */
function RunningRow({
  events,
  isStreaming,
}: {
  events: AgentActivityEvent[];
  isStreaming?: boolean;
}) {
  if (!isStreaming) return null;
  if (events.some((e) => e.type === 'agent_completed')) return null;

  // 串行执行：最后一个未收到配对 tool_result 的 tool_call 即正在执行的工具
  let pendingTool: string | null = null;
  for (const e of events) {
    if (e.type === 'tool_call') pendingTool = e.toolName ?? null;
    else if (e.type === 'tool_result') pendingTool = null;
  }

  return (
    <div className="flex items-center gap-2 text-blue-600 text-xs font-medium">
      <Loader2 size={12} className="shrink-0 animate-spin" />
      <span>{pendingTool ? `正在执行 ${pendingTool}…` : '思考中…'}</span>
    </div>
  );
}

export default function AgentThoughtPanel({
  events,
  isOpen,
  onToggle,
  isStreaming,
}: AgentThoughtPanelProps) {
  // Hook 必须在条件 return 之前调用，否则 events 数量在 0/非 0 间变化时会
  // 触发 React "Rendered more hooks" 崩溃
  const navigate = useNavigate();

  if (events.length === 0) return null;

  // trace 落库主键是 runtime 内部生成的 runId（agent_completed 事件携带），
  // 请求级 traceId 不一定存在（主聊天链路可能为空）且不等于 trace.id
  const runId = events.find((e) => e.type === 'agent_completed')?.data?.runId;

  return (
    <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
      {/* 标题栏 */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
          🔍 Agent Activity
          <span className="text-xs text-gray-400">({events.length} 步)</span>
          {isStreaming && !events.some((e) => e.type === 'agent_completed') && (
            <Loader2 size={12} className="animate-spin text-blue-500" />
          )}
        </span>
        {isOpen ? (
          <ChevronUp size={14} className="text-gray-500" />
        ) : (
          <ChevronDown size={14} className="text-gray-500" />
        )}
      </button>

      {/* 事件列表 */}
      {isOpen && (
        <div className="px-3 py-2 space-y-1.5 max-h-64 overflow-y-auto bg-white text-xs">
          {events.map((event, idx) => (
            <EventItem key={idx} event={event} />
          ))}
          <RunningRow events={events} isStreaming={isStreaming} />
          {runId && (
            <button
              onClick={() => navigate(`/traces/${runId}`)}
              className="w-full text-center text-blue-500 hover:text-blue-700 hover:underline py-1 text-xs flex items-center justify-center gap-1"
            >
              🔗 查看完整 Trace 详情
              <ChevronRight size={12} className="inline" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
