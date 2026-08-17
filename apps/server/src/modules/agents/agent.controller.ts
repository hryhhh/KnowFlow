import { Controller, Sse, Post, Body, Headers, RequestMethod } from "@nestjs/common";
import { Observable } from "rxjs";
import { MessageEvent } from "http";
import { AgentChatService } from "./agent-chat.service";
import type { StreamCallbacks } from "@knowbase-x/rag-engine";

export interface AgentChatStreamBody {
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

@Controller("agents")
export class AgentController {
  constructor(private readonly service: AgentChatService) {}

  /**
   * POST /api/agents/routeStream — SSE 流式路由
   * 事件流：trace_id / agent_start / agent_done / sources / token / done / error
   */
  @Sse("routeStream", { method: RequestMethod.POST })
  routeStream(
    @Body() body: AgentChatStreamBody,
    @Headers("x-trace-id") traceIdHeader?: string,
  ): Observable<MessageEvent> {
    const resolvedTraceId = traceIdHeader ?? "";

    return new Observable<MessageEvent>((subscriber) => {
      const emit = (type: string, value: unknown) => {
        subscriber.next({ data: JSON.stringify({ type, value }) } as MessageEvent);
      };

      // 先发 trace_id 事件
      emit("trace", { traceId: resolvedTraceId });

      const callbacks: StreamCallbacks & { onMeta?: (event: { type: string; value: any; agent?: string; traceId?: string }) => void } = {
        onSources: (sources) => emit("sources", sources),
        onToken: (token) => emit("token", token),
        onDone: () => {
          emit("done", null);
          subscriber.complete();
        },
        onError: (err: Error) => {
          emit("error", err.message);
          subscriber.complete();
        },
        onMeta: (meta) => emit("meta", meta),
      };

      this.service
        .stream(body.query, body.kbId, this.normalizeParams(body.params), callbacks, resolvedTraceId, null)
        .catch((err) => {
          emit("error", err instanceof Error ? err.message : String(err));
          subscriber.complete();
        });
    });
  }

  /**
   * POST /api/agents/route — 同步路由（非流式，返回合成结果）
   */
  @Post("route")
  async route(@Body() body: AgentChatStreamBody) {
    const result = await this.service.orchestrate(
      body.query,
      body.kbId,
      this.normalizeParams(body.params),
    );
    return result;
  }

  /**
   * POST /api/agents/rules/reload — 手动触发路由规则热重载
   */
  @Post("rules/reload")
  reloadRules() {
    this.service.reloadRules();
    return { message: "路由规则已重新加载" };
  }

  private normalizeParams(params: AgentChatStreamBody["params"]) {
    return {
      topK: params?.topK ?? 10,
      minScore: params?.minScore ?? 0.70,
      useReranker: params?.useReranker ?? false,
      denseWeight: params?.denseWeight ?? 0.5,
    };
  }
}
