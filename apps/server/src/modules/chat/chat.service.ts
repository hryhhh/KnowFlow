import { Injectable, Inject } from '@nestjs/common';
import { Observable, Subscriber } from 'rxjs';
import { MessageEvent } from 'http';
import { generateTraceId } from '@knowbase-x/agents';
import { retrieveAndChat } from '@knowbase-x/rag-engine';
import type { RAGPipelineConfig, SearchParams, SourceRef } from '@knowbase-x/rag-engine';
import { RAG_CONFIG } from '../../config/rag-config.provider';
import { RETRIEVAL_DEFAULTS } from '../../config/defaults';
import { env } from '../../config/env';
import { UsageLogService } from '../usage/usage-log.service';
import { SessionService } from '../session/session.service';
import { AgentChatService } from '../agents/agent-chat.service';

export interface ChatStreamBody {
  query: string;
  kbId: string;
  sessionId?: string;
  params?: {
    topK?: number;
    minScore?: number;
    useReranker?: boolean;
    denseWeight?: number;
    retrievalMode?: 'vector' | 'keyword' | 'hybrid';
    fusionMethod?: 'rrf' | 'linear';
    rrfK?: number;
    candidateMultiplier?: number;
    minDenseScore?: number;
  };
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(RAG_CONFIG) private readonly ragConfig: RAGPipelineConfig,
    private readonly usageLog: UsageLogService,
    private readonly sessionService: SessionService,
    private readonly agentChat: AgentChatService,
  ) {}

  stream(body: ChatStreamBody, request?: any): Observable<MessageEvent> {
    const params = body.params ?? {};
    const startTime = Date.now();
    // 请求未带 x-trace-id 时按系统约定生成 16 位 nanoid（usage_logs.traceId 等列以此为准）
    const traceId = request?.traceId || generateTraceId();
    const apiKeyId = request?.apiKey?.id ?? null;

    // 会话管理：有 sessionId 就用，否则新建
    let sessionIdPromise: Promise<void>;
    let sessionId = body.sessionId ?? null;
    if (!sessionId) {
      sessionIdPromise = this.sessionService
        .create(body.kbId, body.query)
        .then((session) => {
          sessionId = session.id;
        })
        .catch(() => {});
    } else {
      sessionIdPromise = Promise.resolve();
    }

    return new Observable<MessageEvent>((subscriber: Subscriber<MessageEvent>) => {
      const emit = (type: string, value: unknown) => {
        subscriber.next({ data: JSON.stringify({ type, value }) } as MessageEvent);
      };

      const record = (status: string) => {
        this.usageLog.record({
          type: 'chat',
          kbId: body.kbId,
          apiKeyId,
          traceId,
          duration: Date.now() - startTime,
          status,
        });
      };

      const normalizedParams: SearchParams = {
        topK: params.topK ?? 10,
        minScore: params.minScore ?? RETRIEVAL_DEFAULTS.minScore,
        useReranker: params.useReranker ?? false,
        denseWeight: params.denseWeight ?? 0.5,
        retrievalMode: params.retrievalMode,
        fusionMethod: params.fusionMethod,
        rrfK: params.rrfK,
        candidateMultiplier: params.candidateMultiplier ?? RETRIEVAL_DEFAULTS.candidateMultiplier,
        minDenseScore: params.minDenseScore ?? RETRIEVAL_DEFAULTS.minDenseScore,
      };

      // AGENTS_ENABLED=true 时走 Agent 编排链路，否则降级传统 RAG
      if (env.agents.enabled) {
        let assistantContent = '';
        let sources: SourceRef[] = [];
        void sessionIdPromise.then(async () => {
          // 捕获本次请求的 sessionId，避免并发请求共享变量
          const reqSessionId = sessionId;
          // 保存用户消息
          if (reqSessionId) {
            await this.sessionService.addMessage(reqSessionId, 'user', body.query).catch(() => {});
          }
          emit('session_id', reqSessionId);

          this.agentChat
            .stream(
              body.query,
              body.kbId,
              normalizedParams,
              {
                onSources: (capturedSources: SourceRef[]) => {
                  sources = capturedSources;
                  emit('sources', capturedSources);
                },
                onToken: (token: string) => {
                  assistantContent += token;
                  emit('token', token);
                },
                onDone: () => {
                  emit('done', null);
                  record('success');
                  // 保存助手回复到会话
                  if (reqSessionId && assistantContent.trim()) {
                    void this.sessionService
                      .addMessage(reqSessionId, 'assistant', assistantContent, sources)
                      .catch(() => {});
                  }
                  subscriber.complete();
                },
                onError: (err: Error) => {
                  emit('error', err.message);
                  record('error');
                  if (reqSessionId) {
                    void this.sessionService
                      .addMessage(reqSessionId, 'assistant', `⚠️ ${err.message}`, sources)
                      .catch(() => {});
                  }
                  subscriber.complete();
                },
                // AgentRuntime/Orchestrator 事件（tool_call/process/agent_completed 等）经 meta 包装转发
                onMeta: (meta) => emit('meta', meta),
              },
              traceId,
              apiKeyId,
              sessionId,
            )
            .catch((err: unknown) => {
              emit('error', err instanceof Error ? err.message : String(err));
              record('error');
              subscriber.complete();
            });
        });
        return;
      }

      // 传统 RAG 单链路
      let assistantContent = '';
      let sources: SourceRef[] = [];
      void sessionIdPromise.then(() => {
        // 捕获本次请求的 sessionId，避免并发请求共享变量
        const reqSessionId = sessionId;
        retrieveAndChat(body.query, body.kbId, normalizedParams, this.ragConfig, {
          onSources: (capturedSources: SourceRef[]) => {
            sources = capturedSources;
            emit('sources', capturedSources);
          },
          onToken: (token: string) => {
            assistantContent += token;
            emit('token', token);
          },
          onDone: () => {
            emit('done', null);
            record('success');
            if (reqSessionId) {
              void this.sessionService
                .addMessage(reqSessionId, 'assistant', assistantContent, sources)
                .catch(() => {});
            }
            subscriber.complete();
          },
          onError: (err: Error) => {
            emit('error', err.message);
            record('error');
            if (reqSessionId) {
              void this.sessionService
                .addMessage(reqSessionId, 'assistant', `⚠️ ${err.message}`, sources)
                .catch(() => {});
            }
            subscriber.complete();
          },
        }).catch((err) => {
          emit('error', err instanceof Error ? err.message : String(err));
          record('error');
          subscriber.complete();
        });
      });
    });
  }
}
