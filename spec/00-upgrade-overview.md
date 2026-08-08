# 00-upgrade-overview.md

| 模块 | 旧版 | 新版 |
| - | - | - |
| 导航 | 简单菜单 | 多级导航 + 侧边栏 + 顶部标签 |
| 列表 | 普通 Table | 高级筛选 Table + 卡片视图 |
| 状态 | 文字展示 | 状态 Badge + Tag + Progress |
| 操作 | 按钮堆叠 | Action Menu + 下拉操作 |
| 视觉 | 基础扁平 | 科技暗蓝 + 渐变 + 圆角卡片 |
| 交互 | 单一列表 | 仪表盘、侧边栏、画布、抽屉 |

---

# 新页面结构设计

## 全局设计原则

1. 全局主题
   - 主色：#1677FF / #1668DC
   - Hover：#4096FF
   - Active：#0958D9
   - 功能色：成功 #52C41A，警告 #FAAD14，错误 #FF4D4F，AI 专属 #722ED1 / #13C2C2
2. 背景与层级
   - 页面背景：#F5F7FA
   - 卡片背景：#FFFFFF
   - 版块边界：#F0F0F0 / #E5E6EB
3. 圆角与阴影
   - 基础圆角：8px
   - 卡片圆角：12px
   - 弹窗 / 侧栏：12px
4. 排版
   - 正文：14px / 1.57
   - 元数据：12px / 1.5
   - 栏目标题：16px / 600
   - KPI 数字：24px–30px / 700

## 全局组件规范

- Ant Design X 全局容器：`PageContainer`、`Card`、`ProCard`
- 表单与输入：`Form`、`Input`、`Input.Search`、`Select`、`Switch`、`Slider`
- 列表与表格：`Table`、`List`、`Tree`、`Tag`、`Badge`
- 数据可视化：`StatisticCard`、`LineChart`、`PieChart`、`AreaChart`
- 对话与 AI 场景：`Chat`、`Bubble`、`Sender`、`Prompts`
- 交互和布局：`Drawer`、`Modal`、`Steps`、`Timeline`、`FlowChart`

## 设计升级目标

1. 从业务驱动页面到场景驱动页面：
   - Dashboard 聚焦 KPI 与趋势
   - KnowledgeBase/Document 以列表+卡片呈现
   - Retrieval/Chat 以参数侧栏 + 主操作区呈现
   - Agent 页面构建可视化运转管理体验
2. 从静态展示到可操作面板：
   - 操作菜单统一为 `Action Menu`
   - 状态集中为 `Badge` / `StatusTag`
   - 重要动作置顶，辅助动作隐藏于更多菜单
3. 从单页逻辑到模块化复用：
   - 统一 `TopStepsBar` / `Sidebar` / `PageHeader`
   - 用 `Form` 抽象筛选与配置面板
   - 用 `Card` 复用行内摘要、日志、引用、API 文档

## 现有数据结构与接口总结

- `KnowledgeBase`:
  - `id`, `name`, `description`, `type`, `status`, `createdAt`, `updatedAt`
  - 当前接口：`GET /knowledge-bases`, `POST /knowledge-bases`, `PUT /knowledge-bases/:id`, `DELETE /knowledge-bases/:id`
- `Document`:
  - `id`, `kbId`, `name`, `fileType`, `fileSize`, `filePath`, `processStrategy`, `status`, `chunkCount`, `importMethod`, `errorMessage`, `updatedAt`
  - 当前接口：`GET /knowledge-bases/:kbId/documents`, `POST /knowledge-bases/:kbId/documents`, `DELETE /knowledge-bases/:kbId/documents/:docId`
- `Chunk`:
  - `id`, `docId`, `kbId`, `chunkIndex`, `content`, `title`, `tokenCount`, `sourceFile`, `createdAt`
  - 当前接口：`GET /documents/:docId/chunks`, `GET /knowledge-bases/:kbId/chunks`, `GET /chunks/:chunkId`, `POST /documents/:docId/chunks`, `PUT /chunks/:chunkId`, `DELETE /chunks/:chunkId`
- `Retrieval`:
  - `kbId`, `query`, `topK`, `minScore`, `useReranker`, `denseWeight`
  - 当前接口：`POST /retrieval/search`
- `Chat`:
  - `query`, `kbId`, `params`, event流 `token`, `sources`, `done`, `error`
  - 当前接口：`POST /chat/stream` (SSE)
- `ApiService`:
  - `id`, `serviceName`, `description`, `keyPrefix`, `kbId`, `callCount`, `updatedAt`
  - 当前接口：`GET /api-services`, `POST /api-services`, `DELETE /api-services/:serviceId`

## 建议新增模块接口

- Dashboard：`GET /dashboard/summary`, `GET /dashboard/usage-trends`, `GET /dashboard/recent-activities`
- Document 详情：`GET /knowledge-bases/:kbId/documents/:docId`, `GET /documents/:docId/logs`
- Agent 管理：`GET /agents`, `POST /agents`, `PUT /agents/:id`, `DELETE /agents/:id`
- Agent 流程：`GET /agent-flows`, `POST /agent-flows`, `PUT /agent-flows/:id`, `DELETE /agent-flows/:id`
- Agent 执行日志：`GET /agent-executions/:id`, `GET /agent-executions/:id/logs`
- 设置：`GET /settings`, `PUT /settings`, `GET /system-info`

## 升级顺序建议

1. 先完成全局主题与布局组件（PageContainer、Sidebar、Header、TopStepsBar）
2. 先完成 `知识库管理` 和 `文档管理` 两个基础数据入口
3. 再完成 `文档解析详情`、`切片管理`、`检索实验室` 和 `AI QA Chat`
4. 最后补齐 `Agent 管理`、`Agent 流程`、`Agent 日志`、`Open API` 和 `设置`

---

## 页面清单

- 01-dashboard-upgrade.md
- 02-knowledge-base-upgrade.md
- 03-document-upgrade.md
- 04-document-detail-upgrade.md
- 05-chunk-upgrade.md
- 06-retrieval-upgrade.md
- 07-chat-upgrade.md
- 08-agent-upgrade.md
- 09-agent-flow-upgrade.md
- 10-agent-log-upgrade.md
- 11-api-upgrade.md
- 12-setting-upgrade.md
