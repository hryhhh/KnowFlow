import {
  Controller,
  Sse,
  Post,
  Body,
  Param,
  UseGuards,
  RequestMethod,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { MessageEvent } from "http";
import { ApiKeyGuard } from "./api-key.guard";
import { ChatService } from "../chat/chat.service";
import { CurrentApiKey } from "../../common/decorators/current-api-key.decorator";
import type { ApiKeyClaim } from "../../common/decorators/current-api-key.decorator";
import { ChatStreamBody } from "../chat/chat.service";
import { UsageLogService } from "../usage/usage-log.service";

@Controller("service-calls")
export class ServiceCallController {
  constructor(
    private readonly chatService: ChatService,
    private readonly usageLog: UsageLogService,
  ) {}

  @Sse(":svcId/chat/stream", { method: RequestMethod.POST })
  @UseGuards(ApiKeyGuard)
  stream(
    @Param("svcId") svcId: string,
    @Body() body: Pick<ChatStreamBody, "query" | "params">,
    @CurrentApiKey() apiKey: ApiKeyClaim,
  ): Observable<MessageEvent> {
    // svcId 仅用于展示；实际 kbId 来自已校验的 API Key 声明
    void svcId;
    const startTime = Date.now();

    const record = (status: string) => {
      this.usageLog.record({
        type: "api",
        kbId: null,
        apiKeyId: apiKey.id,
        duration: Date.now() - startTime,
        status,
      });
    };

    return new Observable<MessageEvent>((subscriber) => {
      const source = this.chatService.stream({
        query: body.query,
        kbId: apiKey.kbId,
        params: body.params,
      });
      const sub = source.subscribe({
        next: (event) => subscriber.next(event),
        complete: () => {
          record("success");
          subscriber.complete();
        },
        error: (err) => {
          record("error");
          subscriber.error(err);
        },
      });
      subscriber.add(sub);
    });
  }
}
