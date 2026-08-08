# 多智能体编排设计方案（v2 — 针对本项目细化）

## 目标

将现有单链路 RAG 改造为 1 主智能体 + 3 子智能体，主智能体自动决定调用哪些助手、如何组合信息。

---

## 三个子智能体

| 子智能体 | 职责 | 数据来源 | 是否依赖 LLM |
|---------|------|---------|------------|
| **DB Query Agent** | 回答系统统计/列表问题 | PostgreSQL 直查（TypeORM） | 否，规则精确匹配 |
| **Web Search Agent** | 回答需实时信息的問題 | 外部搜索 API（Tavily/Serper） | 是，需综合搜索结果 |
| **RAGFlow Agent** | 回答知识库文档问题 | 复用现有 `retrieveAndChat` | 是，现有链路不变 |

---

## 调度策略：规则优先 + LLM 兜底

```
用户提问
  │
  ▼
IntentRouter（规则层，零 LLM 调用）
  ├── 有 kbId 且含文档相关词 → RAGFlow（置信度 0.95）
  ├── 含"多少/统计/数量/列表" → DB Query（置信度 0.90）
  ├── 含"最新/发布/新闻/动态" → Web Search（置信度 0.85）
  └── 组合问题（同时命中多条） → 并行调用多个 Agent
       │
       └── 全部未命中 → 轻量 LLM 意图分类兜底
            │
            ▼
       Dispatcher（框架层）
       ├── 单 Agent → 直接执行 → 返回结果
       └── 多 Agent → 并行执行 → LLM 合成综合回答
            │
            ▼
       流式 SSE 推送（token/sources/done/error，格式不变）
```

---

## 目录结构

```
packages/agents/
  ├── types.ts                # AgentResult / AgentInput / StreamCallbacks 等
  ├── orchestrator.ts         # 主入口：route() / routeStream()
  ├── router.ts               # IntentRouter：规则 + LLM 兜底
  ├── dispatcher.ts           # 调度执行：单/并行 + 结果合成
  └── agents/
      ├── db-query-agent.ts   # 直查 PostgreSQL，规则返回 stats/list
      ├── web-search-agent.ts # 调用搜索 API，LLM 综合
      └── ragflow-agent.ts    # 封装现有 retrieveAndChat

apps/server/src/modules/agents/
  ├── agents.module.ts
  └── agents.service.ts       # 组装三个 Agent + Orchestrator
```

---

## 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| DB Query 不用 LLM | 规则直接查库 | 统计数据必须精确，杜绝幻觉 |
| Web Search 可插拔 | provider 可配置，未配置时降级 | 不强制依赖外部 API |
| RAGFlow 零改造 | 直接委托 `retrieveAndChat` | 保持现有行为不变 |
| 路由调用成本 | 简单问题 0 次 LLM，复杂问题 1 次 | 平衡速度与灵活性 |
| 前端兼容 | SSE 事件格式完全不变 | 零前端改动 |

---

## 改造范围

- **新增** `packages/agents/` 独立包（~8 个文件）
- **新增** `apps/server/src/modules/agents/`（2 个文件）
- **修改** `app.module.ts`、`chat.controller.ts`、`rag-config.provider.ts`
- **可选** `.env` 新增 `WEB_SEARCH_PROVIDER` / `WEB_SEARCH_API_KEY`
- **不改** 前端、rag-engine、数据库结构
