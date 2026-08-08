# 07-chat-upgrade.md

| 模块 | 旧版 | 新版 |
| - | - | - |
| 布局 | 单列对话 | 三列：参数、对话、引用/API |
| 输入 | 基本输入框 | Sender + Prompt + 流状态 |
| 引用 | 基础列表 | 卡片式溯源引用 |
| 模型 | 固定 | 选择模型 + 知识库绑定 |

---

# 1. 新页面结构设计

## 页面布局

- 左侧：知识库选择、模型选择、检索参数
- 中间：对话主区，消息气泡、Markdown 渲染
- 右侧：引用来源 / API 调用面板
- 底部：输入框 + 发送按钮 + 提示词快捷入口

## 核心组件

- `Chat` / `Bubble`
- `Sender`
- `Prompts`
- `Select`
- `Input`
- `Button`
- `Card`
- `Tabs`

# 2. 前端页面组件

1. 配置侧栏
   - `Select`：知识库选择、模型选择
   - `Form`：TopK、minScore、useReranker、denseWeight
   - `Button`：创建服务调用、API 调用
2. 对话区
   - `Bubble`：用户消息与 AI 消息左右对齐
   - `Markdown` 渲染：支持代码块、高亮显示
   - `Spinner` / `Typing`：云端流式返回状态
3. 引用/API 面板
   - `Card`：引用来源说明
   - `Tag`：命中分数、来源文档
   - `ApiUsagePanel`：API Key 详情、调用示例
4. 输入底栏
   - `Sender`：支持发送、清空、停止流式生成
   - `Prompts`：快捷话术卡片

# 3. 后端 API 设计

## 当前接口

- `POST /chat/stream` (SSE)
  - 请求体：`{ kbId, query, params? }`
  - SSE 消息类型：`sources`、`token`、`done`、`error`

## 建议补充接口

- `POST /chat/history`
  - 返回历史对话列表与消息摘要
- `POST /chat/feedback`
  - 提交回答质量反馈
- `GET /chat/models`
  - 返回可用模型列表
- `GET /chat/kb-options`
  - 返回可用知识库列表与权限信息

# 4. 状态和数据结构

## ChatMessage

- `role: "user" | "assistant"`
- `content: string`
- `createdAt?: string`
- `status?: "pending" | "streaming" | "done" | "error"`

## SourceRef

- `content: string`
- `sourceFile: string`
- `score: number`
- `chunkId?: string`
- `docId?: string`

## ChatParams

- `topK: number`
- `minScore: number`
- `useReranker: boolean`
- `denseWeight: number`

## SSE 事件格式

- `{ type: "sources", value: SourceRef[] }`
- `{ type: "token", value: string }`
- `{ type: "done", value: null }`
- `{ type: "error", value: string }`

# 5. 新旧升级说明

- 从简单问答到智能 AI QA 交互实验室
- 从单列对话到参数+对话+引用三列布局
- 从静态消息到流式生成与引文支持
- 从请求封装到 API 调用面板融合外部接入
