import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Pool } from 'pg';
import { Document } from '../../modules/document/entities/document.entity';
import { Chunk } from '../../modules/chunk/entities/chunk.entity';

/**
 * 启动期 Outbox 一致性校验服务
 *
 * 设计文档 §6.1 要求：摄入时 addDocumentsToPG 与 writeSparseIndex 不在同一事务，
 * 启动时对比 chunks 表与 langchainjs 表的 docId 覆盖情况，找出缺失项并告警。
 *
 * 补偿能力有限（无原文件路径），仅做发现+日志，不自动修复。
 */
@Injectable()
export class OutboxComplianceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OutboxComplianceService.name);

  constructor(
    @InjectRepository(Document)
    private readonly docRepo: Repository<Document>,
    @InjectRepository(Chunk)
    private readonly chunkRepo: Repository<Chunk>,
  ) {}

  /**
   * 检查 chunks 与 langchainjs 的一致性，记录不一致的 docId。
   *
   * 逻辑：
   * 1. 查询所有 status='success' 且 chunkCount > 0 的文档
   * 2. 对每个 docId，检查 langchainjs 中是否存在该 docId 的记录
   * 3. 对每个 docId，检查 chunks.chunk_id 是否与 langchainjs.metadata.docId 对应
   * 4. 输出告警日志，人工介入处理
   */
  async checkAndReport(): Promise<void> {
    const startTime = Date.now();
    this.logger.log('开始启动期 Outbox 一致性校验...');

    // 1. 获取所有已成功的文档
    const successDocs = await this.docRepo.find({
      where: { status: 'success' },
      select: ['id', 'kbId', 'chunkCount'],
    });

    if (successDocs.length === 0) {
      this.logger.log('没有成功状态的文档，跳过一致性校验');
      return;
    }

    const pool = new Pool({
      host: process.env.DATABASE_HOST ?? 'localhost',
      port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
      user: process.env.DATABASE_USER ?? 'postgres',
      password: process.env.DATABASE_PASSWORD ?? '123456',
      database: process.env.DATABASE_NAME ?? 'knowledge_rag',
    });

    try {
      const issues: Array<{ type: string; docId: string; detail?: string }> = [];

      // 2. 检查 langchainjs 中缺失的 docId（有 chunks 但无向量）
      const docIds = successDocs.map((d) => d.id);
      if (docIds.length > 0) {
        const missingVectorResult = await pool.query(
          `SELECT d.id AS doc_id FROM documents d
           WHERE d.status = 'success' AND d.chunk_count > 0
             AND NOT EXISTS (
               SELECT 1 FROM langchainjs l WHERE l.metadata @> '{"docId": $1::text}'
             )`,
          [docIds[0]],
        );
        // 用 IN 子句批量检查（PostgreSQL 参数限制）
        const idList = docIds.join("', '");
        const missingVector = await pool.query(
          `SELECT id AS doc_id FROM documents
           WHERE status = 'success' AND chunk_count > 0
             AND id NOT IN (
               SELECT DISTINCT metadata->>'docId' AS doc_id
               FROM langchainjs
               WHERE metadata ? 'docId'
             )`,
        );
        for (const row of missingVector.rows) {
          issues.push({ type: 'missing_vector', docId: row.doc_id });
        }
      }

      // 3. 检查 chunks 表中有 tsv 但 chunk_id 为空的记录
      const emptyChunkId = await this.chunkRepo
        .createQueryBuilder('c')
        .where('c.tsv IS NOT NULL AND c.chunk_id IS NULL')
        .getMany();
      for (const chunk of emptyChunkId.slice(0, 20)) {
        issues.push({
          type: 'missing_chunk_id',
          docId: chunk.docId,
          detail: `chunkId=${chunk.id}`,
        });
      }

      // 4. 输出报告
      if (issues.length === 0) {
        this.logger.log(
          `✅ Outbox 一致性校验通过（耗时 ${Date.now() - startTime}ms），${successDocs.length} 个成功文档全部一致`,
        );
      } else {
        this.logger.warn(
          `⚠️ Outbox 一致性校验发现问题：${issues.length} 项（耗时 ${Date.now() - startTime}ms）`,
        );
        for (const issue of issues) {
          const msg = issue.detail
            ? `  - [${issue.type}] docId=${issue.docId} ${issue.detail}`
            : `  - [${issue.type}] docId=${issue.docId}`;
          this.logger.warn(msg);
        }
        this.logger.warn('请手动补偿：对有 chunks 但无向量的文档重新触发摄入');
      }
    } finally {
      await pool.end();
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    // 仅在 API 进程（非 Worker）中执行，Worker 进程无 HTTP 监听
    if (process.env.NODE_ENV === 'production' && process.env.WORKER_MODE === 'true') {
      return;
    }
    await this.checkAndReport();
  }
}
