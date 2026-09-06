/**
 * Tool 抽象层 — 所有工具必须实现的接口
 *
 * 保持轻量，不依赖 LangChain.js 框架（避免增加耦合）。
 * ToolContext 由 Runtime 注入，Tool 不感知外部依赖。
 */

import type { AgentEvent } from '../types';

/** 工具执行预算 */
export interface ToolBudget {
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

/** 工具执行上下文 — 由 Runtime 注入，Tool 不感知外部依赖 */
export interface ToolContext {
  runId: string;
  sessionId: string;
  kbId: string;
  signal: AbortSignal;
  budget?: ToolBudget;
  emitEvent: (event: AgentEvent) => void;
}

/** LLM 生成的工具调用描述 */
export interface ToolCall {
  id: string;
  toolName: string;
  arguments: Record<string, any>;
}

/** 工具执行结果 */
export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
  error?: { message: string; code: string };
  durationMs?: number;
  structured?: Record<string, any>;
}

/**
 * Tool 接口 — 所有工具必须实现
 * name / description / parameters 用于 LLM tool calling 描述。
 * execute() 负责实际执行并返回结果。
 */
export interface Tool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema，用于 LLM tool calling 参数描述 */
  readonly parameters: Record<string, any>;
  execute(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult>;
}
