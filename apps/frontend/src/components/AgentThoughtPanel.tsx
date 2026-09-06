import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { AgentActivityEvent } from '../types';

interface AgentThoughtPanelProps {
  events: AgentActivityEvent[];
  isOpen: boolean;
  onToggle: () => void;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function EventItem({ event }: { event: AgentActivityEvent }) {
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
    return (
      <div className="flex items-center gap-2 text-gray-600 text-xs">
        <Clock size={12} className="text-blue-500 shrink-0" />
        <span>
          调用 <strong>{event.toolName}</strong>
        </span>
        {event.args?.query && (
          <span className="text-gray-400">"{truncate(event.args.query, 30)}"</span>
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
    return (
      <div className="flex items-center gap-2 text-gray-600 text-xs pl-4">
        {icon}
        <span>{event.toolName} 完成</span>
        {event.durationMs !== undefined && (
          <span className="text-gray-400">{event.durationMs}ms</span>
        )}
        {event.result && <span className="text-gray-400">— {truncate(event.result, 40)}</span>}
      </div>
    );
  }

  if (event.type === 'reasoning_summary') {
    return <div className="pl-4 text-gray-400 text-xs italic">💭 {event.summary}</div>;
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

export default function AgentThoughtPanel({ events, isOpen, onToggle }: AgentThoughtPanelProps) {
  if (events.length === 0) return null;
  const navigate = useNavigate();

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
          {runId && (
            <button
              onClick={() => navigate(`/traces/${runId}`)}
              className="w-full text-center text-blue-500 hover:text-blue-700 hover:underline py-1 text-xs"
            >
              🔗 查看完整 Trace 详情
            </button>
          )}
        </div>
      )}
    </div>
  );
}
