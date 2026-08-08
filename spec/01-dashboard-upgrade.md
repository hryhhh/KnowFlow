# 01-dashboard-upgrade.md

| 模块 | 旧版 | 新版 |
| - | - | - |
| 导航 | 无 Dashboard | 增加 Dashboard 工作台 |
| 概览 | 无 | KPI 卡片 + 趋势图 + 活动流 |
| 交互 | 无 | 数据卡片 + 图表 + 详情链路 |
| 状态 | 无 | 图表动态与指标说明 |

---

# 1. 新页面结构设计

## 页面布局

- 顶部：页面标题 + 时间范围选择 + 快捷操作按钮
- 顶部 KPI 指标区域：知识库数、文档总数、切片总数、处理总容量
- 中部图表区：调用趋势图、Agent 调用占比图
- 右侧/底部动态区：最近活动记录、待处理任务、系统告警

## 组件与结构

- `PageContainer`
- `ProCard` / `StatisticCard`
- `Grid` 布局
- `LineChart` / `AreaChart`
- `PieChart`
- `List` / `Table`
- `Tag` / `Badge`

# 2. 前端页面组件

1. Dashboard 容器
   - `PageContainer`：包裹整个页面，统一页头和侧边栏关系
   - `Card`：分区信息卡片
2. KPI 卡片区
   - `StatisticCard`：主数值、环比变化、状态图标
   - `Statistic`：显示当前指标与对比增长
3. 趋势图区
   - `Chart`：`LineChart` 及 `AreaChart`
   - `Tabs`：切换「API 调用趋势」「检索调用趋势」
4. Agent 占比区
   - `PieChart`：展示 DB Agent / RAG Agent / Search Agent 占比
5. 最近活动区
   - `List`：展示活动摘要、Agent 类型、耗时、时间
   - `Badge`：状态提示

# 3. 后端 API 设计

## 推荐接口

- `GET /dashboard/summary`
  - 作用：返回 KPI 指标汇总
  - 返回数据：
    - `knowledgeBaseCount`: number
    - `documentCount`: number
    - `chunkCount`: number
    - `storageUsage`: string
    - `activeKbCount`: number
    - `processingDocCount`: number
- `GET /dashboard/usage-trends`
  - 作用：返回近 7 / 30 / 90 天调用趋势数据
  - 返回数据：
    - `series`: Array<{ date: string; apiCalls: number; retrievalCalls: number; chatCalls: number }>
- `GET /dashboard/recent-activities`
  - 作用：返回最近系统活动列表
  - 返回数据：
    - `items`: Array<{ id: string; title: string; type: string; agent: string; duration: number; createdAt: string; status: string }>

# 4. 状态和数据结构

## KPI 数据结构

- `DashboardSummary`
  - `knowledgeBaseCount: number`
  - `documentCount: number`
  - `chunkCount: number`
  - `storageUsage: string`
  - `processingCount: number`
  - `errorCount: number`

## 趋势数据结构

- `TrendPoint`
  - `date: string`
  - `apiCalls: number`
  - `retrievalCalls: number`
  - `chatCalls: number`

## 最近活动数据结构

- `ActivityItem`
  - `id: string`
  - `title: string`
  - `type: string`
  - `agent: string`
  - `duration: number`
  - `status: string`
  - `createdAt: string`

# 5. 新旧升级说明

- 从无 Dashboard 到可视化工作台
- 从单一数据入口到汇总指标 + 时间趋势
- 从静态列表到可点击活动明细
- 从无状态提示到统一 Badge/Trend 视觉体系
