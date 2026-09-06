import 'reflect-metadata';
import * as dotenv from 'dotenv';
// CLI 入口负责加载 .env（env.ts 不做加载，避免污染测试环境）；dotenv 不覆盖已有变量
dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
import { DataSource } from 'typeorm';
import * as path from 'node:path';
import { env } from '../config/env';

/**
 * TypeORM 数据源配置（供 migration:run 和 migration:revert 脚本使用）
 *
 * Worker 进程（NODE_ENV=production）必须通过 migration 路径管理 schema，
 * 不能依赖 synchronize，防止 Worker 意外修改表结构。
 */
const dataSource = new DataSource({
  type: 'postgres',
  host: env.database.host,
  port: env.database.port,
  username: env.database.user,
  password: env.database.password,
  database: env.database.name,
  ssl: env.database.ssl,
  entities: [path.join(__dirname, '../modules/**/*.entity{.ts,.js}')],
  migrations: [path.join(__dirname, '../migrations/*{.ts,.js}')],
});

export default dataSource;
