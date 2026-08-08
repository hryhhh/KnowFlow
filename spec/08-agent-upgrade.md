# 08-agent-upgrade.md

| 模块 | 旧版 | 新版 |
| - | - | - |
| 管理 | 无 | Agent 管理面板 |
| 状态 | 无 | 运行状态卡片 |
| 交互 | 无 | 新建/编辑/规则配置 |
| 统计 | 无 | 累计调用、状态监控 |

---

# 1. 新页面结构设计

## 页面布局

- 顶部：页面标题 + 新建 Agent 按钮
- 主区域：Agent 卡片列表 / 表格
- 侧边：搜索与过滤
- 弹层：Agent 配置与规则设置

## 核心组件

- `Table` / `Card`
- `Badge`
- `Button`
- `Drawer`
- `Modal`
- `Tabs`

# 2. 前端页面组件

1. Agent 列表
   - `Table`：列显示 Agent 名称、类型、状态、调用次数、更新时间、操作
   - `Card`：小卡片展示关键指标和按钮
   - `Action Menu`：编辑、停用/启用、删除、查看日志
2. 过滤与搜索
   - `Input.Search`
   - `Select`：按 Agent 类型过滤
   - `Badge`：显示运行状态
3. Agent 新建/编辑
   - `Drawer` / `Modal`：表单配置 Agent 名称、类型、规则、所属知识库
4. Agent 详情
   - `Tabs`：`概览`、`规则`、`日志`、`调用统计`
   - `Descriptions`：展示基础信息

# 3. 后端 API 设计

## 建议接口

- `GET /agents`
  - 返回 Agent 列表
- `GET /agents/:id`
  - 返回 Agent 详情
- `POST /agents`
  - 创建 Agent
- `PUT /agents/:id`
  - 更新 Agent
- `DELETE /agents/:id`
- `POST /agents/:id/enable`
  - 启用 Agent
- `POST /agents/:id/disable`
  - 停用 Agent

# 4. 状态和数据结构

## AgentItem

- `id: string`
- `name: string`
- `type: string`
- `status: string`
- `callCount: number`
- `description?: string`
- `lastRunAt?: string`
- `createdAt: string`
- `updatedAt: string`

## AgentDetail

- `id: string`
- `name: string`
- `type: string`
- `status: string`
- `callCount: number`
- `createdAt: string`
- `updatedAt: string`
- `config: Record<string, unknown>`
- `rules: Array<{ key: string; value: string; description?: string }>
- `relatedKbId?: string`

# 5. 新旧升级说明

- 从无 Agent 管理到可视化管理面板
- 从无状态展示到状态卡片与数据指标
- 从无配置入口到规则化创建/编辑流程
- 支持启用/停用与调用监控
