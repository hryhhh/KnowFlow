# 09-agent-flow-upgrade.md

| 模块 | 旧版 | 新版 |
| - | - | - |
| 视图 | 无 | 可视化流程画布 |
| 交互 | 无 | 节点拖拽、编辑属性 |
| 逻辑 | 无 | 数据流与链路控制 |
| 可控性 | 无 | 可配置节点与策略 |

---

# 1. 新页面结构设计

## 页面布局

- 顶部：页面标题 + 新建 Agent 流程按钮
- 左侧：组件库 / 节点类型面板
- 中间：可视化画布
- 右侧：选中节点属性面板
- 底部：流程执行状态与保存按钮

## 核心组件

- `FlowChart` / `Canvas`
- `Card`
- `Drawer`
- `Form`
- `Tabs`
- `Button`

# 2. 前端页面组件

1. 节点库
   - `Card` 展示可用节点：用户输入、Master Agent、DB Query Agent、FAQ Agent、Web Search Agent
   - 拖拽节点进入画布
2. 流程画布
   - `FlowChart`：画布节点、连线、箭头方向
   - 节点状态高亮：激活、错误、禁用
3. 节点属性面板
   - `Form`：配置节点参数、Prompt、路由规则
   - `Tabs`：基础设置、高级选项、提示词
4. 保存与执行
   - `Button`：保存流程、发布流程、测试执行
   - `Alert`：提示流程校验结果

# 3. 后端 API 设计

## 建议接口

- `GET /agent-flows`
  - 返回流程列表
- `GET /agent-flows/:id`
  - 返回流程详情
- `POST /agent-flows`
  - 创建流程
- `PUT /agent-flows/:id`
  - 更新流程
- `DELETE /agent-flows/:id`
- `POST /agent-flows/:id/validate`
  - 校验流程合法性
- `POST /agent-flows/:id/execute`
  - 测试执行流程

# 4. 状态和数据结构

## AgentFlow

- `id: string`
- `name: string`
- `description?: string`
- `status: string`
- `createdAt: string`
- `updatedAt: string`
- `nodes: Array<AgentNode>`
- `edges: Array<AgentEdge>`

## AgentNode

- `id: string`
- `type: string`
- `label: string`
- `config: Record<string, unknown>`
- `position: { x: number; y: number }`
- `status?: string`

## AgentEdge

- `id: string`
- `source: string`
- `target: string`
- `label?: string`
- `condition?: string`

# 5. 新旧升级说明

- 从无流程管理到图形化编排界面
- 从无节点配置到可视化参数面板
- 增强可理解性，减少运维门槛
- 支持节点状态与流程校验
