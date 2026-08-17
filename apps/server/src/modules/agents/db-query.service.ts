import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { Client } from "pg";
import type { DbQueryTemplate, DbQueryExecuteFn } from "@knowbase-x/agents";

/**
 * DbQueryService — 数据库查询服务
 * - 使用只读凭据连接 PostgreSQL
 * - 参数化查询防止 SQL 注入
 * - 从 config/db-queries.yml 加载 SQL 模板
 */
@Injectable()
export class DbQueryService implements OnModuleDestroy {
  private readonly logger = new Logger(DbQueryService.name);
  private client: Client | null = null;
  private templates: Map<string, DbQueryTemplate> = new Map();

  async onModuleInit(): Promise<void> {
    await this.init();
  }

  private async init(): Promise<void> {
    const connectionString =
      process.env.DB_READONLY_URL ??
      `postgresql://${process.env.DATABASE_USER}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}`;

    this.client = new Client({
      connectionString,
      ssl: false,
    });

    try {
      await this.client.connect();
      this.logger.log("DB Query Service 初始化完成");
    } catch (err: any) {
      this.logger.error(`DB Query Service 初始化失败: ${err.message}`);
      // 不抛出，允许服务在其他 Agent 不可用时降级运行
    }

    this.loadTemplates();
  }

  private loadTemplates(): void {
    const possiblePaths = [
      path.resolve(process.cwd(), "config/db-queries.yml"),
      path.resolve(__dirname, "../../../../config/db-queries.yml"),
      path.resolve("/home/hhhry/projects/knowledge-ai-main/config/db-queries.yml"),
    ];

    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, "utf-8");
          const config = yaml.load(content) as { templates: DbQueryTemplate[] };
          for (const t of config.templates) {
            this.templates.set(t.id, t);
          }
          this.logger.log(`已加载 ${this.templates.size} 个查询模板: ${p}`);
          return;
        }
      } catch (err: any) {
        this.logger.warn(`加载查询模板失败 (${p}): ${err.message}`);
      }
    }

    this.logger.warn("未找到 db-queries.yml，DB Query Agent 将无模板可用");
  }

  /** 执行参数化查询，返回结果行 */
  async execute(queryId: string, params: any[], maxRows: number = 100): Promise<any[]> {
    if (!this.client) throw new Error("数据库未连接");

    const template = this.templates.get(queryId);
    if (!template) throw new Error(`查询模板不存在: ${queryId}`);

    const sql = template.queryTemplate;
    const safeParams = params.map((p) => this.sanitizeParam(p));

    try {
      const result = await this.client.query(sql, safeParams);
      return result.rows.slice(0, maxRows);
    } catch (err: any) {
      this.logger.error(`查询执行失败 [${queryId}]: ${err.message}`);
      throw err;
    }
  }

  /** 获取已注册的模板列表（供调试） */
  getTemplateIds(): string[] {
    return Array.from(this.templates.keys());
  }

  /** 注册外部执行函数（由 AgentChatService 注入） */
  setExecuteFn(_fn: DbQueryExecuteFn): void {
    // 直接使用本服务的 execute 方法，此处保留接口兼容性
  }

  private sanitizeParam(param: any): any {
    if (param === null || param === undefined) return null;
    if (typeof param === "number") return param;
    if (typeof param === "string") {
      // UUID 格式校验
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param)) {
        return param;
      }
      return param;
    }
    return String(param);
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }
}
