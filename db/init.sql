# Knowledge AI — 数据库初始化
# 在 PostgreSQL 首次启动时由 docker-entrypoint-initdb.d 自动执行

-- 启用 pgvector 向量扩展（LangChain PGVectorStore 依赖）
CREATE EXTENSION IF NOT EXISTS vector;
