import { Controller, Sse, Body, Headers, RequestMethod } from "@nestjs/common";
import { Observable } from "rxjs";
import { MessageEvent } from "http";
import { ChatService } from "./chat.service";
import type { ChatStreamBody } from "./chat.service";

@Controller("chat")
export class ChatController {
  constructor(private readonly service: ChatService) {}

  @Sse("stream", { method: RequestMethod.POST })
  stream(
    @Body() body: ChatStreamBody,
    @Headers("x-trace-id") traceId?: string,
  ): Observable<MessageEvent> {
    const request: any = { traceId };
    return this.service.stream(body, request);
  }
}
