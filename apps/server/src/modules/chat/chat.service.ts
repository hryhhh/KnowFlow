import { Injectable, Inject } from '@nestjs/common';
import { Observable, Subscriber } from 'rxjs';
import { MessageEvent } from 'http';
import { retrieveAndChat } from '@knowbase-x/rag-engine';
import type { RAGPipelineConfig, SearchParams, SourceRef } from '@knowbase-x/rag-engine';
import { RAG_CONFIG } from '../../config/rag-config.provider';
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
    const traceId = request?.traceId ?? '';
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
        minScore: params.minScore ?? (Number(process.env.DEFAULT_MIN_SCORE) || 0.1),
        useReranker: params.useReranker ?? false,
        denseWeight: params.denseWeight ?? 0.5,
      };

      // AGENTS_ENABLED=true 时走 Agent 编排链路，否则降级传统 RAG
      if (process.env.AGENTS_ENABLED === 'true') {
        let assistantContent = '';
        void sessionIdPromise.then(async () => {
          // 保存用户消息
          if (sessionId) {
            await this.sessionService.addMessage(sessionId, 'user', body.query).catch(() => {});
          }
          emit('session_id', sessionId);

          this.agentChat
            .stream(
              body.query,
              body.kbId,
              normalizedParams,
              {
                onSources: (sources: SourceRef[]) => emit('sources', sources),
                onToken: (token: string) => {
                  assistantContent += token;
                  emit('token', token);
                },
                onDone: () => {
                  emit('done', null);
                  record('success');
                  // 保存助手回复到会话
                  if (sessionId && assistantContent.trim()) {
                    void this.sessionService
                      .addMessage(sessionId, 'assistant', assistantContent)
                      .catch(() => {});
                  }
                  subscriber.complete();
                },
                onError: (err: Error) => {
                  emit('error', err.message);
                  record('error');
                  if (sessionId) {
                    void this.sessionService
                      .addMessage(sessionId, 'assistant', `⚠️ ${err.message}`)
                      .catch(() => {});
                  }
                  subscriber.complete();
                },
              },
              traceId,
              apiKeyId,
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
      void sessionIdPromise.then(() => {
        retrieveAndChat(body.query, body.kbId, normalizedParams, this.ragConfig, {
          onSources: (sources: SourceRef[]) => emit('sources', sources),
          onToken: (token: string) => {
            assistantContent += token;
            emit('token', token);
          },
          onDone: () => {
            emit('done', null);
            record('success');
            if (sessionId) {
              void this.sessionService
                .addMessage(sessionId, 'assistant', assistantContent)
                .catch(() => {});
            }
            subscriber.complete();
          },
          onError: (err: Error) => {
            emit('error', err.message);
            record('error');
            if (sessionId) {
              void this.sessionService
                .addMessage(sessionId, 'assistant', `⚠️ ${err.message}`)
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
