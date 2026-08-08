# 10-agent-log-upgrade.md

| 模块 | 旧版 | 新版 |
| - | - | - |
| 日志 | 无 | 可视化执行日志 |
| 路径 | 无 | 左侧链路图 + 右侧时间轴 |
| 细节 | 无 | 节点行为与执行明细 |
| 追踪 | 无 | 会话 ID + 请求链路 |

---

# 1. 新页面结构设计

## 页面布局

- 页面顶部：页面标题 + 会话 ID
- 左侧：Agent 执行链路图 / 过程图
- 右侧：时间轴日志 + 节点执行明细
- 底部：操作按钮：导出日志、重新执行

## 核心组件

- `Timeline`
- `Steps`
- `Card`
- `Typography`
- `Alert`
- `Button`

# 2. 前端页面组件

1. 会话头部
   - 显示 `Conversation ID`
   - `Badge`：当前状态
   - `Button`：复制 ID、导出日志
2. 链路图
   - `FlowChart` / `Steps`：展示 Master → DB Query → SQL → RAG → 合成返回
   - 当前节点高亮
3. 时间轴日志
   - `Timeline.Item`：每条日志带时间戳与等级
   - `Typography.Text code`：展示 SQL / 响应摘要
4. 节点明细
   - `Card`：当前选中节点的行为说明、输入/输出值
   - `Tag`：节点类型、耗时、结果状态

# 3. 后端 API 设计

## 建议接口

- `GET /agent-executions/:id`
  - 返回执行会话概览
- `GET /agent-executions/:id/logs`
  - 返回时间轴日志
- `GET /agent-executions/:id/trace`
  - 返回执行链路节点状态
- `POST /agent-executions/:id/retry`
  - 重新执行该会话

# 4. 状态和数据结构

## ExecutionOverview

- `id: string`
- `conversationId: string`
- `agentFlowId: string`
- `status: string`
- `startedAt: string`
- `endedAt?: string`
- `durationMs?: number`

## ExecutionLogItem

- `timestamp: string`
- `level: "info" | "warn" | "error"`
- `message: string`
- `nodeId?: string`
- `data?: Record<string, unknown>`

## ExecutionTraceNode

- `id: string`
- `label: string`
- `type: string`
- `status: string`
- `durationMs?: number`
- `input?: string`
- `output?: string`

# 5. 新旧升级说明

- 从无执行日志到完整追踪页面
- 从无链路可视化到节点级执行图
- 从无错误上下文到每条日志等级呈现
- 提供调试、复现和审计入口
