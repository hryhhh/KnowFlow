import { Controller, Sse, Body, Post, Headers, RequestMethod } from "@nestjs/common";
import { Observable } from "rxjs";
import { MessageEvent } from "http";
import { AgentChatService } from "./agent-chat.service";
import type { StreamCallbacks } from "@knowbase-x/rag-engine";

export interface AgentChatStreamBody {
  query: string;
  kbId: string;
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

  @Sse("routeStream", { method: RequestMethod.POST })
  routeStream(
    @Body() body: AgentChatStreamBody,
    @Headers("x-trace-id") traceId?: string,
  ): Observable<MessageEvent> {
    const resolvedTraceId = traceId ?? "";

    return new Observable<MessageEvent>((subscriber) => {
      const emit = (type: string, value: unknown) => {
        subscriber.next({ data: JSON.stringify({ type, value }) } as MessageEvent);
      };

      const callbacks: StreamCallbacks = {
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
      };

      this.service.stream(body.query, body.kbId, this.normalizeParams(body.params), callbacks, resolvedTraceId, null);
    });
  }

  private normalizeParams(params: AgentChatStreamBody["params"]): import("@knowbase-x/rag-engine").SearchParams {
    return {
      topK: params?.topK ?? 10,
      minScore: params?.minScore ?? 0.70,
      useReranker: params?.useReranker ?? false,
      denseWeight: params?.denseWeight ?? 0.5,
    };
  }

  @Post("route")
  async route(@Body() body: AgentChatStreamBody) {
    return {
      query: body.query,
      kbId: body.kbId,
      agentsEnabled: process.env.AGENTS_ENABLED === "true",
      message: "Agent 编排已启用（当前为占位实现，实际流式输出请使用 /agents/routeStream）",
    };
  }

  @Post("rules/reload")
  reloadRules() {
    // 路由规则已移除，使用固定流程
    return { message: "路由规则已移除，使用固定流程：RAGFlow -> DB Query + Web Search" };
  }
}
