import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { SessionService } from "./session.service";
import type { SessionListItem, SessionMessageItem } from "./session.service";

@Controller("chat/sessions")
export class SessionController {
  constructor(private readonly service: SessionService) {}

  @Get()
  async list(@Query("kbId") kbId: string): Promise<{ code: 0; data: SessionListItem[] }> {
    if (!kbId) throw new Error("kbId is required");
    return { code: 0, data: await this.service.list(kbId) };
  }

  @Post()
  async create(
    @Body() body: { kbId: string; firstMessage: string },
  ): Promise<{ code: 0; data: { id: string; title: string; createdAt: string } }> {
    const session = await this.service.create(body.kbId, body.firstMessage);
    return {
      code: 0,
      data: { id: session.id, title: session.title, createdAt: session.createdAt.toISOString() },
    };
  }

  @Get(":id/messages")
  async getMessages(
    @Param("id") id: string,
  ): Promise<{ code: 0; data: SessionMessageItem[] }> {
    return { code: 0, data: await this.service.getMessages(id) };
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string): Promise<void> {
    await this.service.remove(id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearAll(@Query("kbId") kbId: string): Promise<void> {
    if (!kbId) throw new Error("kbId is required");
    await this.service.clearAll(kbId);
  }
}
