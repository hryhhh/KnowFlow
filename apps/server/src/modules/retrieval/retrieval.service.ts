import { Injectable, Inject } from "@nestjs/common";
import { retrieve } from "@knowbase-x/rag-engine";
import type { RAGPipelineConfig, SearchParams, RetrievalResult } from "@knowbase-x/rag-engine";
import { RAG_CONFIG } from "../../config/rag-config.provider";
import { SearchDto } from "./dto/search.dto";
import { UsageLogService } from "../usage/usage-log.service";

export interface SearchResultItem {
  chunkId: string;
  content: string;
  sourceFile: string;
  score: number;
}

@Injectable()
export class RetrievalService {
  constructor(
    @Inject(RAG_CONFIG) private readonly ragConfig: RAGPipelineConfig,
    private readonly usageLog: UsageLogService,
  ) {}

  async search(dto: SearchDto): Promise<SearchResultItem[]> {
    const startTime = Date.now();
    const params: SearchParams = {
      topK: dto.topK ?? 10,
      minScore: dto.minScore ?? 0.70,
      useReranker: dto.useReranker ?? false,
      denseWeight: dto.denseWeight ?? 0.5,
    };

    try {
      const results: RetrievalResult[] = await retrieve(
        dto.query,
        dto.kbId,
        params,
        this.ragConfig,
      );

      this.usageLog.record({
        type: "retrieval",
        kbId: dto.kbId,
        duration: Date.now() - startTime,
        status: "success",
      });

      return results.map((r) => ({
        // 向量结果未直接暴露 chunkId，使用来源文件作为去重键
        chunkId: `${r.sourceFile}#${r.score}`,
        content: r.content,
        sourceFile: r.sourceFile,
        score: r.score,
      }));
    } catch (err) {
      this.usageLog.record({
        type: "retrieval",
        kbId: dto.kbId,
        duration: Date.now() - startTime,
        status: "error",
      });
      throw err;
    }
  }
}
