import { Processor, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'node:fs';
import { Document } from '../document/entities/document.entity';
import { Chunk } from '../chunk/entities/chunk.entity';
import { IngestionQueue } from './ingestion.queue';
import { DOCUMENT_INGEST_QUEUE_NAME, PROCESS_DOCUMENT_JOB_NAME } from './ingestion.constants';
import type { DocumentIngestJobPayload } from './ingestion.types';
import {
  ingestDocument,
  deleteByDocId,
  writeSparseIndex,
  getChunkIds,
} from '@knowbase-x/rag-engine';
import type { RAGPipelineConfig, ParseStrategy } from '@knowbase-x/rag-engine';
import { RAG_CONFIG } from '../../config/rag-config.provider';

/**
 * 文档摄入 Worker Processor
 *
 * 在独立的 Worker 进程中运行，从 BullMQ 队列消费 job，
 * 执行解析、切片、embedding、PGVector 写入和 chunks 落库。
 */
@Injectable()
@Processor(DOCUMENT_INGEST_QUEUE_NAME)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly ingestionQueue: IngestionQueue,
    @InjectRepository(Document)
    private readonly docRepo: Repository<Document>,
    @InjectRepository(Chunk)
    private readonly chunkRepo: Repository<Chunk>,
    @Inject(RAG_CONFIG)
    private readonly ragConfig: RAGPipelineConfig,
  ) {
    super();
  }

  /**
   * 处理队列中的 job
   *
   * NestJS BullMQ v11 要求通过 process() 方法处理所有进入队列的 job，
   * 通过 job.name 或 job.data 进行路由。
   */
  async process(job: Job<DocumentIngestJobPayload>): Promise<void> {
    // 根据 job name 进行路由
    if (job.name !== PROCESS_DOCUMENT_JOB_NAME) {
      this.logger.warn(`未知的 job 类型: ${job.name}，跳过处理`);
      return;
    }

    const { docId, kbId, filePath, fileType, parseStrategy, originalName } = job.data;
    const attempt = job.attemptsMade;
    const logCtx = { docId, kbId, attempt };

    this.logger.log(`[${docId}] 开始处理，attempt=${attempt}`);

    // ── 1. 校验文档存在且状态为 processing（并发保护）─────────────
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) {
      this.logger.warn(`[${docId}] 文档不存在，跳过`);
      return;
    }
    if (doc.status !== 'processing') {
      this.logger.warn(`[${docId}] 文档已非 processing 状态（${doc.status}），跳过`);
      return;
    }

    // ── 2. 重试幂等清理：删除上次执行残留的向量和 chunks ──────────
    if (attempt > 1) {
      this.logger.log(`[${docId}] 重试，清理上次残留数据`);
      try {
        await deleteByDocId(this.ragConfig.pg, this.ragConfig.pgTableName, docId);
      } catch (err) {
        this.logger.error(`[${docId}] 清理 PGVector 失败: ${err}`);
      }
      try {
        await this.chunkRepo.delete({ docId });
      } catch (err) {
        this.logger.error(`[${docId}] 清理 chunks 失败: ${err}`);
      }
      // 重试时重置进度为 queued(0)，避免前端显示残留中间值
      doc.progress = 0;
      doc.processingStage = 'queued';
      await this.docRepo.save(doc);
    }

    // ── 3. 文件存在性检查（不可重试错误）──────────────────────────
    if (!fs.existsSync(filePath)) {
      const err = new Error(`文件不存在: ${filePath}`);
      await this.markFailed(docId, err.message, attempt);
      throw err;
    }

    // ── 4. 调用 RAG 摄入（含 docId 和进度回调）───────────────────
    try {
      const { chunkCount, chunks } = await ingestDocument(
        filePath,
        kbId,
        this.ragConfig,
        parseStrategy as ParseStrategy,
        undefined, // agentOptions（暂不支持）
        docId, // docId 必须传入，写入 metadata
        (event) => this.updateProgress(docId, event),
      );

      // ── 5. 落库 chunks（chunkId 使用 pipeline 注入的 UUID，与 dense 侧一致）──
      await this.updateProgress(docId, { percent: 92, stage: 'persisting' });
      const chunkEntities = chunks.map((c, i) =>
        this.chunkRepo.create({
          docId,
          kbId,
          chunkIndex: i,
          content: c.content,
          tokenCount: c.tokenCount,
          sourceFile: (c.metadata.source as string) ?? originalName,
          chunkId: c.metadata.chunkId as string,
        }),
      );
      await this.chunkRepo.save(chunkEntities);

      // ── 5.5 写稀疏索引（tsvector on chunks，使用 chunk_id 关联键）──
      try {
        const chunkIds = getChunkIds(chunks);
        await writeSparseIndex(
          this.ragConfig.pg,
          'chunks',
          chunkEntities.map((e, i) => ({ id: e.id, content: e.content, chunkId: chunkIds[i] })),
        );
      } catch (err) {
        this.logger.warn(`[${docId}] 稀疏索引写入失败: ${err}`);
        // 不阻塞成功标记，启动期校验任务补偿
      }

      // ── 6. 标记成功 ───────────────────────────────────────────
      doc.status = 'success';
      doc.chunkCount = chunkCount;
      doc.progress = 100;
      doc.processingStage = 'completed';
      doc.errorMessage = '';
      await this.docRepo.save(doc);

      this.logger.log(`[${docId}] 处理完成，chunkCount=${chunkCount}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // 不可重试错误（文件/格式/空文档/网络等）→ 立即标 failed，不消耗 retry budget
      if (this.isUnrecoverable(err)) {
        this.logger.warn(`[${docId}] 不可重试错误: ${msg}`);
        await this.markFailed(docId, msg, attempt);
        // 抛出 UnrecoverableError，BullMQ v8+ 会直接标记失败而不重试
        const unrecoverable = new Error(msg);
        (unrecoverable as any).name = 'UnrecoverableError';
        throw unrecoverable;
      }

      // 可重试错误：记录进度并重新抛出，让 BullMQ 负责重试
      this.logger.warn(`[${docId}] 处理失败，attempt=${attempt}: ${msg}`);
      throw err;
    }
  }

  /**
   * 更新文档进度和阶段到数据库（BullMQ job.progress 仅为备份，前端读 DB）
   */
  private async updateProgress(
    docId: string,
    event: { percent: number; stage: string },
  ): Promise<void> {
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) return;
    doc.progress = Math.max(0, Math.min(100, event.percent));
    doc.processingStage = event.stage as any;
    await this.docRepo.save(doc);
  }

  /**
   * 标记文档为 failed 并写入错误信息
   */
  private async markFailed(docId: string, errorMessage: string, attempt: number): Promise<void> {
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) return;
    doc.status = 'failed';
    doc.errorMessage = errorMessage;
    // 保留最后一次有效进度，不清零
    await this.docRepo.save(doc);
    this.logger.error(`[${docId}] 标记为 failed: ${errorMessage}`);
  }

  /**
   * 判断错误是否不可重试
   *
   * 不可重试：文件不存在、格式不支持、空文档（无内容可解析）。
   * 可重试：网络超时、MinerU 5xx、embedding 临时失败等。
   */
  private isUnrecoverable(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    // 文件/格式相关
    if (lower.includes('文件不存在') || lower.includes('file not found')) return true;
    if (lower.includes('格式不支持') || lower.includes('unsupported format')) return true;
    if (lower.includes('空文档') || lower.includes('no content')) return true;
    if (lower.includes('无法解析') || lower.includes('parse error')) return true;
    // 用户明确标记的不可重试错误
    if ((err as any)?.name === 'UnrecoverableError') return true;
    return false;
  }

  /**
   * 监听 BullMQ 失败事件（所有 job 失败最终都会触发此事件）
   *
   * 注意：process 中已处理不可重试错误的标记，这里兜底处理超过最大尝试次数的情况。
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error): Promise<void> {
    const { docId } = job.data;
    const maxAttempts = job.opts.attempts ?? 3;
    const attempt = job.attemptsMade;
    this.logger.warn(
      `[${docId}] BullMQ 失败事件：attempt=${attempt}/${maxAttempts}，error=${err.message}`,
    );

    // 只有达到最大尝试次数才标记 failed（否则 processor 中的错误已处理）
    if (attempt >= maxAttempts) {
      await this.markFailed(docId, err.message, attempt);
    }
  }
}
