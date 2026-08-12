import * as fs from "node:fs";
import * as path from "node:path";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Client } from "pg";
import * as yaml from "js-yaml";

/**
 * 数据库查询服务
 */
@Injectable()
export class DbQueryService implements OnModuleInit {
  private readonly logger = new Logger(DbQueryService.name);
  private client: Client | null = null;
  private templates: Map<string, any> = new Map();

  async onModuleInit(): Promise<void> {
    await this.init();
  }

  /**
   * 初始化数据库连接
   */
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
      throw err;
    }

    // 加载查询模板
    this.loadTemplates();
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }

  /**
   * 加载查询模板
   */
  private loadTemplates(): void {
    // 尝试多个可能的路径
    const possiblePaths = [
      path.resolve(process.cwd(), "config/db-queries.yml"),
      path.resolve(__dirname, "../../../../config/db-queries.yml"),
      path.resolve("/home/hhhry/projects/knowledge-ai-main/config/db-queries.yml"),
    ];

    for (const templatePath of possiblePaths) {
      try {
        if (fs.existsSync(templatePath)) {
          const content = fs.readFileSync(templatePath, "utf-8");
          const config = yaml.load(content) as { templates: any[] };
          for (const template of config.templates) {
            this.templates.set(template.id, template);
          }
          this.logger.log(`已加载 ${this.templates.size} 个查询模板: ${templatePath}`);
          return;
        }
      } catch (err: any) {
        this.logger.warn(`加载查询模板失败 (${templatePath}): ${err.message}`);
      }
    }

    this.logger.warn("未找到查询模板文件");
  }

  /**
   * 执行查询
   */
  async execute(queryId: string, params: any[], maxRows: number = 100): Promise<any[]> {
    if (!this.client) {
      throw new Error("数据库未连接");
    }

    const template = this.templates.get(queryId);
    if (!template) {
      throw new Error(`查询模板不存在: ${queryId}`);
    }

    // 参数化查询，防止 SQL 注入
    const sql = template.queryTemplate;
    const safeParams = params.map((p) => this.sanitizeParam(p));

    try {
      const result = await this.client.query(sql, safeParams);
      // 限制返回行数
      return result.rows.slice(0, maxRows);
    } catch (err: any) {
      this.logger.error(`查询执行失败: ${err.message}`);
      throw err;
    }
  }

  /**
   * 安全参数处理
   */
  private sanitizeParam(param: any): any {
    if (param === null || param === undefined) {
      return null;
    }
    // 防止 SQL 注入：只允许数字、字符串、UUID
    if (typeof param === "number") {
      return param;
    }
    if (typeof param === "string") {
      // 如果是 UUID 格式，验证格式
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param)) {
        return param;
      }
      // 普通字符串，直接返回（PostgreSQL 参数化查询会处理转义）
      return param;
    }
    return String(param);
  }
}
