import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConversationSession } from "./entities/conversation-session.entity";
import { SessionMessage } from "./entities/session-message.entity";
import type { SourceRef } from "@knowbase-x/rag-engine";

export interface SessionListItem {
  id: string;
  kbId: string;
  title: string;
  messageCount: number;
  createdAt: string;
}

export interface SessionMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: SourceRef[] | null;
  createdAt: string;
}

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(ConversationSession)
    private readonly sessionRepo: Repository<ConversationSession>,
    @InjectRepository(SessionMessage)
    private readonly messageRepo: Repository<SessionMessage>,
  ) {}

  async list(kbId: string): Promise<SessionListItem[]> {
    const sessions = await this.sessionRepo.find({
      where: { kbId },
      order: { createdAt: "DESC" },
    });

    if (sessions.length === 0) return [];

    // 批量查询每个会话的消息数量，避免 N+1
    const sessionIds = sessions.map((s) => s.id);
    const counts = await this.messageRepo
      .createQueryBuilder("msg")
      .select("msg.sessionId", "sessionId")
      .addSelect("COUNT(*)", "count")
      .whereInIds(sessionIds)
      .groupBy("msg.sessionId")
      .getRawMany();

    const countMap = new Map<string, number>(
      counts.map((row) => [row.msg_sessionid, parseInt(row.msg_count, 10)])
    );

    return sessions.map((s) => ({
      id: s.id,
      kbId: s.kbId,
      title: s.title,
      messageCount: countMap.get(s.id) ?? 0,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  async create(kbId: string, firstMessage: string): Promise<ConversationSession> {
    const title = firstMessage.length > 30 ? firstMessage.slice(0, 30) + "…" : firstMessage;
    const session = this.sessionRepo.create({ kbId, title });
    return this.sessionRepo.save(session);
  }

  async get(id: string): Promise<ConversationSession | null> {
    return this.sessionRepo.findOne({ where: { id } });
  }

  async getMessages(sessionId: string): Promise<SessionMessageItem[]> {
    const messages = await this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: "ASC" },
    });
    return messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sources: m.sources,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  async addMessage(
    sessionId: string,
    role: "user" | "assistant",
    content: string,
    sources?: SourceRef[],
  ): Promise<SessionMessage> {
    const msg = this.messageRepo.create({ sessionId, role, content, sources: sources ?? null });
    return this.messageRepo.save(msg);
  }

  async remove(id: string): Promise<void> {
    const session = await this.sessionRepo.findOne({ where: { id } });
    if (!session) throw new NotFoundException(`会话不存在: ${id}`);
    await this.messageRepo.delete({ sessionId: id });
    await this.sessionRepo.remove(session);
  }
}
