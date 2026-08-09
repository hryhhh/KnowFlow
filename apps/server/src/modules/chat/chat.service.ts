import { Injectable, Inject } from "@nestjs/common";
import { Observable, Subscriber } from "rxjs";
import { MessageEvent } from "http";
import { retrieveAndChat } from "@knowbase-x/rag-engine";
import type { RAGPipelineConfig, SearchParams, SourceRef } from "@knowbase-x/rag-engine";
import { RAG_CONFIG } from "../../config/rag-config.provider";
import { UsageLogService } from "../usage/usage-log.service";

export interface ChatStreamBody {
  query: string;
  kbId: string;
  params?: Partial<SearchParams>;
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(RAG_CONFIG) private readonly ragConfig: RAGPipelineConfig,
    private readonly usageLog: UsageLogService,
  ) {}

  stream(body: ChatStreamBody): Observable<MessageEvent> {
    const params: SearchParams = {
      topK: body.params?.topK ?? 10,
      minScore: body.params?.minScore ?? 0.70,
      useReranker: body.params?.useReranker ?? false,
      denseWeight: body.params?.denseWeight ?? 0.5,
    };

    const startTime = Date.now();
    return new Observable<MessageEvent>((subscriber: Subscriber<MessageEvent>) => {
      const emit = (type: string, value: unknown) => {
        subscriber.next({ data: JSON.stringify({ type, value }) } as MessageEvent);
      };

      const record = (status: string) => {
        this.usageLog.record({
          type: "chat",
          kbId: body.kbId,
          apiKeyId: null,
          duration: Date.now() - startTime,
          status,
        });
      };

      retrieveAndChat(body.query, body.kbId, params, this.ragConfig, {
        onSources: (sources: SourceRef[]) => emit("sources", sources),
        onToken: (token: string) => emit("token", token),
        onDone: () => {
          emit("done", null);
          record("success");
          subscriber.complete();
        },
        onError: (err: Error) => {
          emit("error", err.message);
          record("error");
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
