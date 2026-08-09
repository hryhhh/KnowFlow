import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KnowledgeBase } from "../knowledge-base/entities/knowledge-base.entity";
import { Document } from "../document/entities/document.entity";
import { Chunk } from "../chunk/entities/chunk.entity";

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(Document)
    private readonly docRepo: Repository<Document>,
    @InjectRepository(Chunk)
    private readonly chunkRepo: Repository<Chunk>,
  ) {}

  async getSummary() {
    const [kbCount, docCount, chunkCount, processingCount, errorCount] = await Promise.all([
      this.kbRepo.count(),
      this.docRepo.count(),
      this.chunkRepo.count(),
      this.docRepo.count({ where: { status: "processing" } }),
      this.docRepo.count({ where: { status: "failed" } }),
    ]);
    return {
      knowledgeBaseCount: kbCount,
      documentCount: docCount,
      chunkCount: chunkCount,
      processingCount,
      storageUsage: `${(chunkCount * 0.5).toFixed(1)} MB`,
      activeKbCount: kbCount,
      errorCount,
    };
  }

  async getUsageTrends() {
    const series: Array<{ date: string; apiCalls: number; retrievalCalls: number; chatCalls: number; }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      series.push({
        date,
        apiCalls: Math.floor(Math.random() * 50) + 10,
        retrievalCalls: Math.floor(Math.random() * 80) + 20,
        chatCalls: Math.floor(Math.random() * 30) + 5,
      });
    }
    return { series };
  }

  async getRecentActivities() {
    const [kbs, docs] = await Promise.all([
      this.kbRepo.find({ order: { createdAt: "DESC" }, take: 5 }),
      this.docRepo.find({ order: { createdAt: "DESC" }, take: 5 }),
    ]);
    const kbItems = kbs.map((kb) => ({
      id: kb.id,
      title: `创建知识库「${kb.name}」`,
      type: "kb",
      agent: "系统",
      duration: 0,
      status: "success",
      createdAt: kb.createdAt.toISOString(),
    }));
    const docItems = docs.map((d) => ({
      id: d.id,
      title: `上传文档「${d.name}」`,
      type: "doc",
      agent: d.status === "success" ? "Loader" : "系统",
      duration: 0,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
    }));
    const items = [...kbItems, ...docItems]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);
    return { items };
  }
}
