import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pool } from 'pg';
import { Document } from '../../modules/document/entities/document.entity';
import { Chunk } from '../../modules/chunk/entities/chunk.entity';
import { env } from '../../config/env';

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
   * 2. 对每个成功文档，检查 chunks 表中是否存在对应记录、langchainjs 中是否存在向量
   * 3. 检查 chunks 表中 chunkId 为空的记录
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
      host: env.database.host,
      port: env.database.port,
      user: env.database.user,
      password: env.database.password,
      database: env.database.name,
    });

    try {
      const issues: Array<{ type: string; docId: string; detail?: string }> = [];

      // 2. 检查 chunks 表中缺失的 docId（有文档但无 chunks）
      const docIds = successDocs.map((d) => d.id);
      if (docIds.length > 0) {
        const docsWithChunks = await this.chunkRepo
          .createQueryBuilder('c')
          .select('c."docId"')
          .where('c."docId" IN (:...ids)', { ids: docIds })
          .getMany();
        const docsWithChunksSet = new Set(docsWithChunks.map((r: { docId: string }) => r.docId));
        for (const doc of successDocs) {
          if (!docsWithChunksSet.has(doc.id)) {
            issues.push({ type: 'missing_chunks', docId: doc.id });
          }
        }

        // 批量检查有 chunks 但 langchainjs 中无对应向量的文档
        const idList = docIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
        const missingVectorResult = await pool.query(
          `SELECT id AS doc_id FROM documents
           WHERE status = 'success' AND "chunkCount" > 0
             AND id NOT IN (
               SELECT DISTINCT (metadata->>'docId')::uuid AS doc_id
               FROM langchainjs
               WHERE metadata ? 'docId'
             )
             AND id IN (${idList})`,
        );
        for (const row of missingVectorResult.rows) {
          issues.push({ type: 'missing_vector', docId: row.doc_id });
        }
      }

      // 3. 检查 chunks 表中有 tsv 但 chunkId 为空的记录
      const emptyChunkId = await this.chunkRepo
        .createQueryBuilder('c')
        .where('c."chunkId" IS NULL')
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
        this.logger.warn('请手动补偿：对不一致文档重新触发摄入（有文档无 chunks 或无向量）');
      }
    } catch (err) {
      this.logger.error(`Outbox 一致性校验失败: ${err}`);
    } finally {
      await pool.end();
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    // 仅在 API 进程（非 Worker）中执行，Worker 进程无 HTTP 监听
    if (env.isProduction && env.workerMode) {
      return;
    }
    await this.checkAndReport();
  }
}
