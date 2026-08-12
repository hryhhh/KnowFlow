import { Injectable, Inject } from "@nestjs/common";
import { Observable, Subscriber } from "rxjs";
import { MessageEvent } from "http";
import { retrieveAndChat } from "@knowbase-x/rag-engine";
import type { RAGPipelineConfig, SearchParams, SourceRef } from "@knowbase-x/rag-engine";
import { RAG_CONFIG } from "../../config/rag-config.provider";
import { UsageLogService } from "../usage/usage-log.service";
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
    private readonly sessionService: SessionService,
  ) {}

  stream(body: ChatStreamBody, request?: any): Observable<MessageEvent> {
    const params = body.params ?? {};
    const startTime = Date.now();
    const traceId = request?.traceId ?? "";
    const apiKeyId = request?.apiKey?.id ?? null;

    return new Observable<MessageEvent>((subscriber: Subscriber<MessageEvent>) => {
      const emit = (type: string, value: unknown) => {
        subscriber.next({ data: JSON.stringify({ type, value }) } as MessageEvent);
      };

      // 会话管理：有 sessionId 就用，否则新建
      let sessionId = body.sessionId ?? null;
      if (!sessionId) {
        this.sessionService.create(body.kbId, body.query).then((session) => {
          sessionId = session.id;
          emit("session_id", sessionId);
          return this.sessionService.addMessage(sessionId, "user", body.query);
        }).catch(() => {});
      } else {
        emit("session_id", sessionId);
      }

      let assistantContent = "";

      const record = (status: string) => {
        this.usageLog.record({
          type: "chat",
          kbId: body.kbId,
          apiKeyId,
          traceId,
          duration: Date.now() - startTime,
          status,
        });
      };

      const normalizedParams: SearchParams = {
        topK: params.topK ?? 10,
        minScore: params.minScore ?? (Number(process.env.DEFAULT_MIN_SCORE) || 0.70),
        useReranker: params.useReranker ?? false,
        denseWeight: params.denseWeight ?? 0.5,
      };

      retrieveAndChat(body.query, body.kbId, normalizedParams, this.ragConfig, {
        onSources: (sources: SourceRef[]) => emit("sources", sources),
        onToken: (token: string) => {
          assistantContent += token;
          emit("token", token);
        },
        onDone: () => {
          emit("done", null);
          record("success");
          if (sessionId) {
            this.sessionService.addMessage(sessionId, "assistant", assistantContent).catch(() => {});
          }
          subscriber.complete();
        },
        onError: (err: Error) => {
          emit("error", err.message);
          record("error");
          if (sessionId) {
            this.sessionService.addMessage(sessionId, "assistant", `⚠️ ${err.message}`).catch(() => {});
          }
          subscriber.complete();
        },
      }).catch((err) => {
        emit("error", err instanceof Error ? err.message : String(err));
        record("error");
        subscriber.complete();
      });
    });
  }
}
