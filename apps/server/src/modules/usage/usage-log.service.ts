import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UsageLog } from "./entities/usage-log.entity";
import type { UsageType } from "./entities/usage-log.entity";

@Injectable()
export class UsageLogService {
  constructor(
    @InjectRepository(UsageLog)
    private readonly repo: Repository<UsageLog>,
  ) {}

  async record(params: {
    type: UsageType;
    kbId?: string | null;
    apiKeyId?: string | null;
    traceId?: string | null;
    duration?: number;
    status?: string;
    triggeredLlmArbitration?: boolean;
    ragIncludedBy?: string | null;
    composeUsedRagPriority?: boolean;
    llmArbitrationAgent?: string | null;
  }): Promise<void> {
    await this.repo.insert({
      type: params.type,
      kbId: params.kbId ?? null,
      apiKeyId: params.apiKeyId ?? null,
      traceId: params.traceId ?? null,
      duration: params.duration ?? 0,
      status: params.status ?? "success",
      triggeredLlmArbitration: params.triggeredLlmArbitration ?? false,
      ragIncludedBy: params.ragIncludedBy ?? null,
      composeUsedRagPriority: params.composeUsedRagPriority ?? false,
      llmArbitrationAgent: params.llmArbitrationAgent ?? null,
    });
  }

  async getTrends(): Promise<
    Array<{ date: string; apiCalls: number; retrievalCalls: number; chatCalls: number }>
  > {
    const now = new Date();
    const dates: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }

    const rows = await this.repo
      .createQueryBuilder("u")
      .select("DATE(u.\"createdAt\")", "date")
      .addSelect("SUM(CASE WHEN u.type = 'api' THEN 1 ELSE 0 END)", "apiCalls")
      .addSelect("SUM(CASE WHEN u.type = 'retrieval' THEN 1 ELSE 0 END)", "retrievalCalls")
      .addSelect("SUM(CASE WHEN u.type = 'chat' THEN 1 ELSE 0 END)", "chatCalls")
      .where("DATE(u.\"createdAt\") IN (:...dates)", { dates })
      .groupBy("DATE(u.\"createdAt\")")
      .orderBy("date", "ASC")
      .getRawMany();

    const map = new Map<string, Record<string, string | number>>();
    for (const row of rows ?? []) {
      map.set(row.date, row);
    }
    const series = dates.map((date) => {
      const r = map.get(date);
      return {
        date,
        apiCalls: Number(r?.apiCalls ?? 0),
        retrievalCalls: Number(r?.retrievalCalls ?? 0),
        chatCalls: Number(r?.chatCalls ?? 0),
      };
    });
    return series;
  }
}
