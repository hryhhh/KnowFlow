import { Injectable, Inject } from "@nestjs/common";
import { Observable, Subscriber } from "rxjs";
import { MessageEvent } from "http";
import { RAG_CONFIG } from "../../config/rag-config.provider";
import type { RAGPipelineConfig } from "@knowbase-x/rag-engine";
import { UsageLogService } from "../usage/usage-log.service";
import { AgentChatService } from "../agents/agent-chat.service";
import { SessionService } from "../session/session.service";

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
    private readonly agentChat: AgentChatService,
    private readonly sessionService: SessionService,
  ) {}

  stream(body: ChatStreamBody, request?: any): Observable<MessageEvent> {
    const params = body.params ?? {};
    const startTime = Date.now();

    return new Observable<MessageEvent>((subscriber: Subscriber<MessageEvent>) => {
      const emit = (type: string, value: unknown) => {
        subscriber.next({ data: JSON.stringify({ type, value }) } as MessageEvent);
      };

      const traceId = request?.traceId ?? "";
      const apiKeyId = request?.apiKey?.id ?? null;

      // 会话管理：有 sessionId 就用，否则新建
      let sessionId = body.sessionId ?? null;
      if (!sessionId) {
        this.sessionService.create(body.kbId, body.query).then((session) => {
          sessionId = session.id;
          emit("session_id", sessionId);
          return this.sessionService.addMessage(sessionId, "user", body.query);
        }).catch(() => {});
      } else {
        // 已有会话，立即通知前端保持同步
        emit("session_id", sessionId);
      }

      let assistantContent = "";

      const callbacks = {
        onSources: (sources: import("@knowbase-x/rag-engine").SourceRef[]) => emit("sources", sources),
        onToken: (token: string) => emit("token", token),
        onDone: () => {
          emit("done", null);
          this.usageLog.record({
            type: "chat",
            kbId: body.kbId,
            apiKeyId,
            traceId,
            duration: Date.now() - startTime,
            status: "success",
          });
          // 保存助手消息（异步，不阻塞响应）
          if (sessionId) {
            this.sessionService.addMessage(sessionId, "assistant", assistantContent).catch(() => {});
          }
          subscriber.complete();
        },
        onError: (err: Error) => {
          emit("error", err.message);
          this.usageLog.record({
            type: "chat",
            kbId: body.kbId,
            apiKeyId,
            traceId,
            duration: Date.now() - startTime,
            status: "error",
          });
          if (sessionId) {
            this.sessionService.addMessage(sessionId, "assistant", `⚠️ ${err.message}`).catch(() => {});
          }
          subscriber.complete();
        },
        onMeta: (event: { type: string; value?: any; agent?: string; traceId?: string }) => {
          emit("meta", event);
        },
      };

      const normalizedParams: import("@knowbase-x/rag-engine").SearchParams = {
        topK: params.topK ?? 10,
        minScore: params.minScore ?? 0.70,
        useReranker: params.useReranker ?? false,
        denseWeight: params.denseWeight ?? 0.5,
      };

      // 拦截 onToken 来累积助手回复
      const wrappedCallbacks = {
        ...callbacks,
        onToken: (token: string) => {
          assistantContent += token;
          callbacks.onToken(token);
        },
      };

      this.agentChat.stream(body.query, body.kbId, normalizedParams, wrappedCallbacks, traceId, apiKeyId);
    });
  }
}
