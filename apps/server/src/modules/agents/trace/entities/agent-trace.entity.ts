import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

export interface AgentTraceStep {
  type: 'llm_call' | 'tool_call' | 'final_answer' | 'memory_load';
  timestamp: number;
  data: Record<string, any>;
}

export interface AgentTraceTokens {
  prompt: number;
  completion: number;
  total: number;
}

export interface AgentTraceSummary {
  totalDurationMs: number;
  llmCalls: number;
  toolCalls: number;
  tokensUsed: AgentTraceTokens;
}

@Entity('agent_traces')
export class AgentTrace {
  @PrimaryColumn('varchar')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  sessionId: string;

  @Column({ type: 'varchar', length: 36 })
  kbId: string;

  @Column({ type: 'text' })
  query: string;

  @Column({ type: 'varchar', length: 16, default: 'running' })
  status: 'running' | 'completed' | 'failed' | 'truncated';

  @CreateDateColumn()
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'jsonb', default: '[]' })
  steps: AgentTraceStep[];

  @Column({ type: 'jsonb', nullable: true })
  summary: AgentTraceSummary | null;

  @Column({ type: 'jsonb', nullable: true })
  tokensUsed: AgentTraceTokens | null;

  @Column({ type: 'text', nullable: true })
  errorMsg: string | null;
}
