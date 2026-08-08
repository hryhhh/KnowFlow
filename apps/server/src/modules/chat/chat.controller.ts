import { Controller, Sse, Body, RequestMethod } from "@nestjs/common";
import { Observable } from "rxjs";
import { MessageEvent } from "http";
import { ChatService } from "./chat.service";
import { ChatStreamBody } from "./chat.service";

@Controller("chat")
export class ChatController {
  constructor(private readonly service: ChatService) {}

  @Sse("stream", { method: RequestMethod.POST })
  stream(@Body() body: ChatStreamBody): Observable<MessageEvent> {
    return this.service.stream(body);
  }
}
