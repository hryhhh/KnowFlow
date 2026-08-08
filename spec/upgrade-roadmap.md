# 升级路线图

基于 `spec/` 各模块设计文档与当前项目代码分析，制定本升级路线图。

---

## 1. 升级优先级总览

| 优先级 | 模块 | 理由 |
|--------|------|------|
| P0 | 全局布局与主题 | 所有页面依赖，先行统一视觉与导航 |
| P1 | 知识库管理 | 入口页面，改动风险低，直接提升体验 |
| P1 | 文档管理 | 入口页面，与知识库强耦合，一并升级 |
| P2 | 切片管理 | 已有逻辑，视觉升级为主，低风险 |
| P2 | 知识检索 | 已有逻辑，三列布局重构，中风险 |
| P2 | 知识问答 | 已有逻辑，流式交互不变，低风险 |
| P3 | 文档解析详情 | **新功能**，需新增后端接口 |
| P3 | Open API 平台 | **新功能**，需新增后端接口 |
| P3 | 系统设置 | **新功能**，需新增后端接口 |
| P4 | Dashboard | **新功能**，需新增后端接口，数据依赖多 |
| P4 | Agent 管理 | **新功能**，需新增后端接口，架构变更大 |
| P4 | Agent 流程画布 | **新功能**，需引入画布组件库，技术风险高 |
| P4 | Agent 执行日志 | **新功能**，需新增后端接口，依赖 Agent 模块 |

---

## 2. 各页面详细计划

### Phase 0 — 全局布局与主题

**目标**：建立统一视觉体系，为后续所有页面升级奠定基础。

| 任务 | 涉及文件 | 修改类型 | 预计工作量 |
|------|----------|----------|------------|
| 安装 Ant Design X | `frontend/package.json` | 新增依赖 | 小 |
| 更新 CSS 变量 | `frontend/src/index.css` | 修改 | 小 |
| 重构 Sidebar | `frontend/src/components/Sidebar.tsx` | 重写 | 中 |
| 重构 MainLayout | `frontend/src/components/MainLayout.tsx` | 修改 | 小 |
| 新增 PageHeader | `frontend/src/components/PageHeader.tsx` | 新增 | 小 |
| 更新 TopStepsBar | `frontend/src/components/TopStepsBar.tsx` | 修改 | 小 |
| 更新路由结构 | `frontend/src/App.tsx` | 修改 | 小 |

**修改风险**：低。全局组件修改影响所有页面，需充分测试。

**依赖关系**：无前置依赖，但所有后续 Phase 依赖本阶段完成。

---

### Phase 1 — 知识库管理（`/knowledge-bases`）

**目标**：将卡片网格升级为 Table + 卡片双视图，添加高级筛选。

| 任务 | 涉及文件 | 修改类型 | 预计工作量 |
|------|----------|----------|------------|
| 重构列表页 | `frontend/src/pages/KnowledgeBase/KnowledgeBaseList.tsx` | 重写 | 中 |
| 更新创建/编辑弹窗 | `frontend/src/pages/KnowledgeBase/CreateKBModal.tsx`<br>`frontend/src/pages/KnowledgeBase/EditKBModal.tsx` | 修改 | 小 |
| 更新 kb-store | `frontend/src/stores/kb-store.ts` | 修改 | 小 |

**修改风险**：低。现有逻辑不变，主要为视觉升级。

**依赖关系**：依赖 Phase 0 完成。

---

### Phase 1 — 文档管理（`/knowledge-bases/:kbId/documents`）

**目标**：添加拖拽上传、高级筛选、状态可视化。

| 任务 | 涉及文件 | 修改类型 | 预计工作量 |
|------|----------|----------|------------|
| 重构文档列表页 | `frontend/src/pages/Document/DocumentList.tsx` | 重写 | 中 |
| 更新 api 服务 | `frontend/src/services/api.ts` | 修改 | 小 |

**修改风险**：低。上传逻辑保持不变。

**依赖关系**：依赖 Phase 0 完成。

---

### Phase 2 — 切片管理（`/knowledge-bases/:kbId/chunks`）

**目标**：左侧文档树 + 右侧切片列表的双栏布局。

| 任务 | 涉及文件 | 修改类型 | 预计工作量 |
|------|----------|----------|------------|
| 重构知识库切片页 | `frontend/src/pages/Chunk/KbChunkList.tsx` | 重写 | 中 |
| 重构文档切片页 | `frontend/src/pages/Chunk/ChunkList.tsx` | 修改 | 小 |
| 更新切片弹窗 | `frontend/src/pages/Chunk/ChunkModal.tsx` | 修改 | 小 |
| 更新 api 服务 | `frontend/src/services/api.ts` | 修改 | 小 |

**修改风险**：中。布局变化较大，需确保切片 CRUD 逻辑不受影响。

**依赖关系**：依赖 Phase 0、1 完成。

---

### Phase 2 — 知识检索（`/knowledge-bases/:kbId/retrieval`）

**目标**：左侧参数面板 + 右侧结果区的布局，添加检索链路可视化。

| 任务 | 涉及文件 | 修改类型 | 预计工作量 |
|------|----------|----------|------------|
| 重构检索页 | `frontend/src/pages/Retrieval/RetrievalPage.tsx` | 重写 | 中 |
| 更新类型定义 | `frontend/src/types/index.ts` | 修改 | 小 |

**修改风险**：低。检索逻辑完全复用现有接口。

**依赖关系**：依赖 Phase 0 完成。

---

### Phase 2 — 知识问答（`/knowledge-bases/:kbId/chat`）

**目标**：三列布局（参数 + 对话 + 引用），升级对话组件。

| 任务 | 涉及文件 | 修改类型 | 预计工作量 |
|------|----------|----------|------------|
| 重构聊天页 | `frontend/src/pages/Chat/ChatPage.tsx` | 重写 | 中 |
| 重构 API 调用面板 | `frontend/src/pages/Chat/ApiUsagePanel.tsx` | 修改 | 小 |
| 更新聊天 store | `frontend/src/stores/chat-store.ts` | 修改 | 小 |
| 更新 SSE 服务 | `frontend/src/services/sse.ts` | 修改 | 小 |
| 更新服务创建弹窗 | `frontend/src/pages/Chat/CreateServiceModal.tsx` | 修改 | 小 |

**修改风险**：低。流式对话逻辑保持不变。

**依赖关系**：依赖 Phase 0 完成。

---

### Phase 3 — 文档解析详情（新增 `/knowledge-bases/:kbId/documents/:docId`）

**目标**：展示文档处理流程步骤、解析日志、文本预览。

| 任务 | 涉及文件 | 修改类型 | 预计工作量 |
|------|----------|----------|------------|
| 新增详情页 | `frontend/src/pages/Document/DocumentDetail.tsx` | 新增 | 中 |
| 更新 api 服务 | `frontend/src/services/api.ts` | 修改 | 小 |
| 更新类型定义 | `frontend/src/types/index.ts` | 修改 | 小 |
| 更新路由 | `frontend/src/App.tsx` | 修改 | 小 |
| **后端新增接口** | `apps/server/src/modules/document/` | 新增 | 中 |

**修改风险**：中。需要新增后端接口支持。

**依赖关系**：依赖 Phase 0、1 完成。需要后端配合。

---

### Phase 3 — Open API 平台（新增 `/api-platform`）

**目标**：API 密钥管理、调用统计、接口文档。

| 任务 | 涉及文件 | 修改类型 | 预计工作量 |
|------|----------|----------|------------|
| 新增 API 平台页 | `frontend/src/pages/API/APIPlatform.tsx` | 新增 | 大 |
| 新增密钥管理子页 | `frontend/src/pages/API/KeyManagement.tsx` | 新增 | 中 |
| 新增文档指南子页 | `frontend/src/pages/API/DocGuide.tsx` | 新增 | 中 |
| 更新 api 服务 | `frontend/src/services/api.ts` | 修改 | 小 |
| 更新类型定义 | `frontend/src/types/index.ts` | 修改 | 小 |
| 更新路由 | `frontend/src/App.tsx` | 修改 | 小 |
| 更新 Sidebar | `frontend/src/components/Sidebar.tsx` | 修改 | 小 |
| **后端新增接口** | `apps/server/src/modules/api-service/` | 修改 | 中 |

**修改风险**：中。涉及多页面新建和后端接口扩展。

**依赖关系**：依赖 Phase 0 完成。现有 API Service 接口已具备基础，需扩展统计和详情接口。

---

### Phase 3 — 系统设置（新增 `/settings`）

**目标**：主题、安全、日志、系统信息集中管理。

| 任务 | 涉及文件 | 修改类型 | 预计工作量 |
|------|----------|----------|------------|
| 新增设置页 | `frontend/src/pages/Settings/SettingsPage.tsx` | 新增 | 中 |
| 更新路由 | `frontend/src/App.tsx` | 修改 | 小 |
| 更新 Sidebar | `frontend/src/components/Sidebar.tsx` | 修改 | 小 |
| **后端新增接口** | `apps/server/src/modules/settings/` | 新增 | 中 |

**修改风险**：低。纯配置类页面，无核心业务逻辑。

**依赖关系**：依赖 Phase 0 完成。需要后端配合。

---

### Phase 4 — Dashboard 工作台（新增 `/dashboard`）

**目标**：KPI 概览、趋势图表、最近活动。

| 任务 | 涉及文件 | 修改类型 | 预计工作量 |
|------|----------|----------|------------|
| 新增 Dashboard 页 | `frontend/src/pages/Dashboard/DashboardPage.tsx` | 新增 | 大 |
| 新增统计卡片组件 | `frontend/src/components/StatCard.tsx` | 新增 | 小 |
| 新增图表组件 | `frontend/src/components/UsageChart.tsx` | 新增 | 中 |
| 更新 api 服务 | `frontend/src/services/api.ts` | 修改 | 小 |
| 更新路由 | `frontend/src/App.tsx` | 修改 | 小 |
| 更新 Sidebar | `frontend/src/components/Sidebar.tsx` | 修改 | 小 |
| **后端新增接口** | `apps/server/src/modules/dashboard/` | 新增 | 大 |

**修改风险**：高。需要引入图表库，后端需新增聚合统计接口。

**依赖关系**：依赖 Phase 0-3 完成。后端数据依赖知识库、文档、切片等模块。

---

### Phase 4 — Agent 管理（新增 `/agents`）

**目标**：Agent 列表、创建、配置、状态管理。

| 任务 | 涉及文件 | 修改类型 | 预计工作量 |
|------|----------|----------|------------|
| 新增 Agent 列表页 | `frontend/src/pages/Agent/AgentList.tsx` | 新增 | 中 |
| 新增 Agent 详情页 | `frontend/src/pages/Agent/AgentDetail.tsx` | 新增 | 中 |
| 新增 Agent 创建/编辑弹窗 | `frontend/src/pages/Agent/AgentModal.tsx` | 新增 | 中 |
| 更新 api 服务 | `frontend/src/services/api.ts` | 修改 | 小 |
| 更新类型定义 | `frontend/src/types/index.ts` | 修改 | 小 |
| 更新路由 | `frontend/src/App.tsx` | 修改 | 小 |
| 更新 Sidebar | `frontend/src/components/Sidebar.tsx` | 修改 | 小 |
| **后端新增模块** | `apps/server/src/modules/agent/` | 新增 | 大 |

**修改风险**：高。全新模块，需设计完整的后端架构。

**依赖关系**：依赖 Phase 0 完成。完全新后端模块。

---

### Phase 4 — Agent 流程画布（新增 `/agent-flows`）

**目标**：可视化流程编排，节点拖拽编辑。

| 任务 | 涉及文件 | 修改类型 | 预计工作量 |
|------|----------|----------|------------|
| 新增流程列表页 | `frontend/src/pages/AgentFlow/FlowList.tsx` | 新增 | 中 |
| 新增流程画布页 | `frontend/src/pages/AgentFlow/FlowCanvas.tsx` | 新增 | 大 |
| 新增节点属性面板 | `frontend/src/pages/AgentFlow/NodePanel.tsx` | 新增 | 中 |
| 更新 api 服务 | `frontend/src/services/api.ts` | 修改 | 小 |
| 更新类型定义 | `frontend/src/types/index.ts` | 修改 | 小 |
| 更新路由 | `frontend/src/App.tsx` | 修改 | 小 |
| 更新 Sidebar | `frontend/src/components/Sidebar.tsx` | 修改 | 小 |
| **后端新增模块** | `apps/server/src/modules/agent-flow/` | 新增 | 大 |
| **引入画布库** | `frontend/package.json` | 新增依赖 | 中 |

**修改风险**：高。需要引入第三方画布组件库（如 `@ant-design/charts` 或 `react-flow`），技术复杂度最高。

**依赖关系**：依赖 Phase 4 Agent 管理完成。

---

### Phase 4 — Agent 执行日志（新增 `/agent-executions/:id`）

**目标**：执行链路可视化 + 时间轴日志。

| 任务 | 涉及文件 | 修改类型 | 预计工作量 |
|------|----------|----------|------------|
| 新增执行日志页 | `frontend/src/pages/AgentLog/ExecutionLog.tsx` | 新增 | 大 |
| 新增链路图组件 | `frontend/src/components/ExecutionFlow.tsx` | 新增 | 中 |
| 更新 api 服务 | `frontend/src/services/api.ts` | 修改 | 小 |
| 更新类型定义 | `frontend/src/types/index.ts` | 修改 | 小 |
| 更新路由 | `frontend/src/App.tsx` | 修改 | 小 |
| **后端新增接口** | `apps/server/src/modules/agent-execution/` | 新增 | 大 |

**修改风险**：高。需要链路图可视化，数据结构复杂。

**依赖关系**：依赖 Phase 4 Agent 管理和 Agent 流程画布完成。

---

## 3. 修改风险汇总

| 风险等级 | 模块 | 风险说明 |
|----------|------|----------|
| 低 | 全局布局 | 影响面广但逻辑简单，需充分回归测试 |
| 低 | 知识库管理 | 视觉升级，逻辑不变 |
| 低 | 文档管理 | 视觉升级，上传逻辑复用 |
| 低 | 知识检索 | 视觉升级，接口复用 |
| 低 | 知识问答 | 视觉升级，流式逻辑复用 |
| 低 | 系统设置 | 纯配置页，无核心业务 |
| 中 | 切片管理 | 布局变化大，需验证 CRUD |
| 中 | 文档解析详情 | 需新增后端接口 |
| 中 | Open API 平台 | 多页面新建，需扩展后端 |
| 高 | Dashboard | 需图表库，后端聚合接口复杂 |
| 高 | Agent 管理 | 全新模块，架构设计风险 |
| 高 | Agent 流程画布 | 需引入画布库，技术复杂度最高 |
| 高 | Agent 执行日志 | 链路图复杂，数据结构复杂 |

---

## 4. 依赖关系图

```
Phase 0 (全局布局)
    │
    ├──→ Phase 1 (知识库管理)
    │       │
    │       ├──→ Phase 2 (切片管理)
    │       │
    │       ├──→ Phase 3 (文档解析详情)
    │       │
    │       └──→ Phase 2 (知识检索)
    │               │
    │               └──→ Phase 2 (知识问答)
    │
    ├──→ Phase 3 (Open API 平台)
    │
    ├──→ Phase 3 (系统设置)
    │
    └──→ Phase 4 (Dashboard)
            │
            └──→ Phase 4 (Agent 管理)
                    │
                    ├──→ Phase 4 (Agent 流程画布)
                    │
                    └──→ Phase 4 (Agent 执行日志)
```

---

## 5. 建议执行顺序

1. **第 1 步**：完成 Phase 0，建立统一视觉基础
2. **第 2 步**：并行完成 Phase 1（知识库 + 文档管理）
3. **第 3 步**：完成 Phase 2（切片、检索、问答）
4. **第 4 步**：完成 Phase 3（文档详情、API 平台、设置）
5. **第 5 步**：完成 Phase 4（Dashboard、Agent 系列）

---

## 6. 待确认事项

1. **Ant Design X 引入**：需确认是否引入 `@ant-design/x` 或仅使用 `antd`。当前项目未安装任何 UI 框架，需评估引入成本。
2. **图表库选择**：Dashboard 需要图表，建议 `@ant-design/charts` 或 `recharts`。
3. **画布库选择**：Agent 流程需要画布组件，建议 `@xyflow/react`（原 react-flow）。
4. **后端接口**：Phase 3-4 涉及多个新后端模块，需后端同学配合设计数据模型和接口。
5. **现有功能保留**：Phase 2 升级时需确保现有 API 接口不变，保证前端向后兼容。
