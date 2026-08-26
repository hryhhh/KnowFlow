import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'node:path';

/**
 * TypeORM 数据源配置（供 migration:run 和 migration:revert 脚本使用）
 *
 * Worker 进程（NODE_ENV=production）必须通过 migration 路径管理 schema，
 * 不能依赖 synchronize，防止 Worker 意外修改表结构。
 */
const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
  username: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? '123456',
  database: process.env.DATABASE_NAME ?? 'knowledge_rag',
  ssl: process.env.DATABASE_SSL === 'true',
  entities: [path.join(__dirname, '../modules/**/*.entity{.ts,.js}')],
  migrations: [path.join(__dirname, '../migrations/*{.ts,.js}')],
});

export default dataSource;
