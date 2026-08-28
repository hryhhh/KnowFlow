# 前端 Frontend 设计文档

> React 19 + Vite 8 前端应用设计，包含页面结构、组件体系、路由、状态管理与交互流程。
> 最后更新：2026-08-28

## 一、技术选型

| 组件        | 选型                               | 说明                |
| ----------- | ---------------------------------- | ------------------- |
| 框架        | React 19                           | 函数组件 + Hooks    |
| 构建工具    | Vite 8                             | 快速 HMR / 构建     |
| 路由        | React Router v7                    | 声明式路由          |
| 状态管理    | Zustand (推荐) 或 Jotai            | 轻量级状态管理      |
| HTTP 客户端 | Axios                              | API 请求封装        |
| SSE 客户端  | fetch + ReadableStream             | 流式响应处理        |
| UI 样式方案 | Tailwind CSS (推荐) 或 CSS Modules | 原子化 CSS / 模块化 |
| 图表/可视化 | ECharts 或 Recharts (可选)         | 检索结果可视化      |
| 图标库      | Lucide React                       | 轻量图标            |

> 注：前端目前为纯 React + Vite，暂不引入重型 UI 库（如 Ant Design），保持轻量。后续可按需引入。

## 二、页面结构与路由

### 2.1 整体布局

```
┌──────────────────────────────────────────────────────┐
│  Header: KnowBase X                                  │
├──────────┬───────────────────────────────────────────┤
│ Sidebar  │  Main Content Area                        │
│ ─────    │                                           │
│ 📊 仪表盘│  [动态页面内容]                            │
│ 📚 知识库│                                           │
│ 📄 文档管│                                           │
│ 📋 切片管│                                           │
│ 🔍 知识检│                                           │
│ 💬 知识问│                                           │
│ 🧩 Agent │                                           │
│ 🔌 API测试│                                          │
└──────────┴───────────────────────────────────────────┘
```

### 2.2 路由定义

```typescript
const routes = [
  {
    path: '/',
    element: <MainLayout />,
    children: [
      // 仪表盘（Step 0）
      { index: true, element: <DashboardPage /> },

      // 知识库列表页 (Step 1)
      { path: 'knowledge-bases', element: <KnowledgeBaseList /> },

      // 文档管理页 (Step 2)
      {
        path: 'knowledge-bases/:kbId/documents',
        element: <DocumentList />,
      },

      // 切片管理页 (按知识库)
      {
        path: 'knowledge-bases/:kbId/chunks',
        element: <KbChunkList />,
      },

      // 切片管理页 (按文档)
      {
        path: 'knowledge-bases/:kbId/documents/:docId/chunks',
        element: <ChunkList />,
      },

      // 知识检索页 (Step 3)
      {
        path: 'knowledge-bases/:kbId/retrieval',
        element: <RetrievalPage />,
      },

      // 知识问答页 (Step 3)
      {
        path: 'knowledge-bases/:kbId/chat',
        element: <ChatPage />,
      },

      // API 测试页
      {
        path: 'api-test',
        element: <ApiTestPage />,
      },
    ],
  },
];
```

## 三、各页面详细设计

### 3.1 知识库列表页（Step 1）

**对应图：step1.png, step2.png**

**布局要素：**

- **顶部步骤条**：4 步进度指示器
  - 第 1 步「创建知识库」(高亮)
  - 第 2 步「上传文档」→ CSV/XLSX 转 CSV 后进入 Loader 与 Splitter
  - 第 3 步「检索问答」→ 调试 topK、阈值、切片命中与答案引用
  - 第 4 步「API 调用」→ 通过 SSE 接口集成到真实业务流程
- **操作栏**：「+ 创建知识库」下拉按钮 | 「共 N 个知识库」计数 | 右侧搜索框
- **知识库卡片列表**：
  - 卡片内容：
    - 数据库图标 + 知识库名称 (如 "miaoma")
    - 描述文字 (如 "学生成绩知识库")
    - 统计行：免费版 | 文档数量 | 切片数量
    - 更新时间
- **左侧侧边栏**：
  - Logo 区：Miaoma RAG / LangChain.js 实践台
  - 导航菜单：知识库 / 文档管理 / 切片管理 / 知识检索 / 知识问答
  - 底部统计区：当前选中知识库的文档数和切片数

**交互逻辑：**

1. 点击「创建知识库」 → 弹出对话框输入名称和描述
2. 点击卡片 → 进入该知识库的文档管理页（跳转到 Step 2）
3. 搜索框 → 过滤知识库名称

---

### 3.2 文档管理页（Step 2）

**对应图：step3.png, step4.png, step5.png**

**布局要素：**

- **顶部步骤条**：同上，第 2 步高亮
- **操作栏**：
  - 「↑ 上传文档」下拉按钮
  - 右侧搜索框（搜索文件名）
  - 视图切换按钮（卡片视图 / 表格视图）
- **文档表格/列表**：
  - 列字段：文档名称/ID、文档状态（带标签色）、处理策略、切片数、导入方式、更新时间、操作
  - 状态标签色：
    - `处理失败` → 橙红色
    - `处理成功` → 绿色
    - `待处理` → 灰色
    - `处理中` → 蓝色加载中
  - 操作列：「切片详情」链接

**交互逻辑：**

1. 点击「上传文档」 → 弹出文件选择对话框
2. 选择文件后 → 显示处理策略选择（可选）
3. 上传成功后 → 文档出现在列表中，状态显示「处理中」
4. 处理完成后 → 自动刷新，状态变为「成功/失败」，切片数更新
5. 点击「切片详情」 → 跳转到切片管理页

---

### 3.3 切片管理页

**对应图：step6.png**

**布局要素：**

- **顶部步骤条**：同上
- **操作栏**：
  - 「+ 新增切片」按钮（手动添加）
  - 共 N 个切片计数
  - 右侧搜索框（搜索切片 ID）
- **切片卡片网格**（默认网格视图）：
  - 每张卡片展示：
    - 序号 #N + 切片标题
    - 编辑图标按钮（✏️）和删除图标按钮（🗑️）
    - 内容预览（多行文本，关键字段高亮显示）
    - 底部元信息栏：来源文件名 | 字节数 | 更新时间

**数据示例（来自 step6.png）：**

```
#1  切片标题
日期sheet:2019/8/21
销售人:小小米
手机型号:小米8
数量:1
单价:2799
订单金额:
订单状态:发货中

11gbk.csv   字节 75   更新于 2026/07/02 21:44
```

**新增切片模态框：**

- 所属文档：下拉选择（必填）
- 切片标题：输入框（选填）
- 切片内容：文本域（必填，最大 8000 字符）
- 取消 / 添加按钮

**交互逻辑：**

1. 点击「+ 新增切片」→ 打开新增模态框
2. 点击编辑图标 → 打开编辑模态框，加载当前数据
3. 点击删除图标 → 确认后删除切片
4. 搜索 → 按 ID 过滤

---

### 3.4 知识检索页

**布局要素：**

- **左侧参数配置面板**（固定宽度 ~280px）：
  - 标题：「📊 检索参数」
  - **检索模式选择**：`vector` / `keyword` / `hybrid` 单选
  - **融合方法**（仅 hybrid）：`RRF` / `Linear` 单选
  - 参数控件：
    - 结果返回数量 (topK)：滑块，默认 10
    - 最低相似度 (minScore)：数字输入
    - RRF K 值：数字输入，默认 60
    - 候选倍数 (candidateMultiplier)：数字输入，默认 3
    - Dense Weight（仅 linear）：数字输入，默认 0.50
    - Min Dense Score（仅 hybrid）：数字输入
    - Debug 模式：Toggle 开关
- **右侧主区域**：
  - 顶部：搜索框 + 搜索按钮
  - 搜索结果列表（含相似度分数 + 来源文件）
  - **Debug 表格**（debug=true 时显示）：
    - 每行一个 chunk，展示 `rankDense` / `rankSparse` / `scoreDense` / `scoreSparse` / `scoreFused`
    - 批次统计：`denseCandidates` / `sparseCandidates` / `fusedTopK`

**交互逻辑：**

1. 输入查询词 → 点击搜索或回车
2. 调整参数 → 自动重新检索（防抖 300ms）
3. 结果按融合分数降序排列
4. 点击历史记录 → 回填查询词并重新搜索
5. 开启 Debug → 下方展示详细的双路检索明细表格

---

### 3.5 知识问答页

**布局要素：**

整体布局为 **左侧会话栏 + 中间对话区 + 右侧参数/来源面板**：

#### 左侧会话历史栏 (~240px)

```
┌──────────────────────────┐
│ 💬 会话历史               │
│                          │
│ 📝 今天的问题            │
│    最新一条...    [🗑️]   │ ← 点击一次高亮，再点确认删除
│    5分钟前               │
│                          │
│ 📝 昨天的查询            │
│    另一条问题...  [🗑️]   │
│    2小时前               │
│                          │
│ [+ 新建会话]             │
└──────────────────────────┘
```

#### 中间对话区域

```
┌──────────────────────────────────────────┐
│ 💡 知识库助手                             │
│ Hi，我是知识库助手                         │
│                                          │
│ ───────── 用户消息 ─────────              │
│ （用户问题内容）                           │
│                                          │
│ ───────── AI 回复 ─────────              │
│ （流式输出，逐字显示）                     │
│                                          │
├──────────────────────────────────────────┤
│ 输入框                            [发送]  │
└──────────────────────────────────────────┘
```

#### 右侧面板（Tabs 切换）

```
┌──────────────────────────────┐
│ 📋 参数  |  📎 来源           │
│                                      │
│ 结果返回数量    [10]           │
│ 最低相似度      [0.00]         │
│ 检索模式     [▼ hybrid]       │
│ 融合方法     [▼ rrf]          │
│ Dense Weight  [0.50]          │
│                              │
│ ⚙️ 服务调用                    │
│ [创建服务调用] [API 测试]     │
│                              │
│ 学生成绩问答 API  ek_xxx     │
└──────────────────────────────┘
```

**API 测试面板**（点击「API 测试」后展示）：

- 选择已创建的服务
- 粘贴完整 API Key（`serviceId:apiKey` 格式）
- 发送测试消息，实时查看 SSE 日志流
- 支持选择 `chat/stream` 或 `agents/routeStream` 端点

## 四、组件拆分

### 4.1 布局组件

| 组件          | 职责                               |
| ------------- | ---------------------------------- |
| `MainLayout`  | 主布局：Header + Sidebar + Content |
| `Sidebar`     | 左侧导航菜单 + 底部统计            |
| `TopStepsBar` | 4 步骤进度指示器                   |
| `AppHeader`   | 顶部导航栏                         |

### 4.2 业务组件

| 组件                 | 所在页面   | 职责                     |
| -------------------- | ---------- | ------------------------ |
| `KBList`             | 知识库列表 | 知识库卡片列表           |
| `KBCard`             | 知识库列表 | 单个知识库卡片           |
| `CreateKBModal`      | 知识库列表 | 创建知识库弹窗           |
| `EditKBModal`        | 知识库列表 | 编辑知识库弹窗           |
| `DocTable`           | 文档管理   | 文档列表表格（含进度条） |
| `UploadDocButton`    | 文档管理   | 上传文档按钮 & 流程      |
| `DocStatusBadge`     | 文档管理   | 文档状态标签             |
| `ChunkGrid`          | 切片管理   | 切片卡片网格             |
| `ChunkCard`          | 切片管理   | 单个切片卡片             |
| `KbChunkList`        | 切片管理   | 按知识库查看切片列表页面 |
| `ChunkModal`         | 切片管理   | 新增/编辑切片模态框      |
| `SearchPanel`        | 知识检索   | 左侧参数配置面板         |
| `SearchResults`      | 知识检索   | 搜索结果列表             |
| `DebugTable`         | 知识检索   | Debug 模式明细表格       |
| `ChatPanel`          | 知识问答   | 中部对话区域             |
| `SourcePanel`        | 知识问答   | 右侧引用来源面板         |
| `SessionSidebar`     | 知识问答   | 会话历史侧边栏           |
| `CreateServiceModal` | 知识问答   | 创建服务调用弹窗         |
| `ApiUsagePanel`      | 知识问答   | API 调用说明面板         |
| `ApiTestPage`        | API 测试   | 外部 API 测试 + SSE 日志 |
| `DashboardPage`      | 仪表盘     | KPI 卡片 + 趋势图 + 活动 |

### 4.3 公共组件

| 组件              | 职责         |
| ----------------- | ------------ |
| `EmptyState`      | 空状态占位   |
| `LoadingSkeleton` | 加载骨架屏   |
| `StatusBadge`     | 通用状态标签 |
| `ConfirmDialog`   | 确认对话框   |
| `Pagination`      | 分页器       |

## 五、状态管理设计

使用 Zustand store 分模块：

```typescript
// stores/kb-store.ts — 知识库状态
interface KBState {
  knowledgeBases: KBItem[];
  currentKB: KBItem | null;
  isLoading: boolean;
  fetchKBs: () => void;
  selectKB: (kb: KBItem) => void;
}

// stores/doc-store.ts — 文档状态
interface DocState {
  documents: DocItem[];
  isUploading: boolean;
  uploadProgress: number;
  fetchDocuments: (kbId: string) => void;
  uploadDocument: (file: File, strategy?: string) => void;
}

// stores/chat-store.ts — 对话与会话状态
interface ChatState {
  // 会话管理
  sessions: SessionListItem[];
  currentSessionId: string | null;
  isLoadingSessions: boolean;
  fetchSessions: (kbId: string) => void;
  createSession: (kbId: string, firstMessage: string) => Promise<string>;
  deleteSession: (sessionId: string) => void;
  switchSession: (sessionId: string) => void;

  // 消息与检索
  messages: ChatMessage[];
  sources: SourceRef[];
  isLoading: boolean;
  searchParams: SearchParams; // topK, minScore, retrievalMode, fusionMethod, debug...
  sendMessage: (query: string) => void;
  updateSearchParams: (params: Partial<SearchParams>) => void;
}
```

## 六、SSE 流式处理

前端通过原生 `fetch` + `ReadableStream` 处理 SSE：

```typescript
async function streamChat(query: string) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, kbId, params }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const event = JSON.parse(line.slice(6));
        switch (event.type) {
          case 'sources':
            setSources(event.value);
            break;
          case 'token':
            appendToken(event.value);
            break;
          case 'done':
            finish();
            break;
          case 'trace':
            // Agent 编排模式下接收 trace ID
            setTraceId(event.value.traceId);
            break;
          case 'agent_start':
          case 'agent_done':
          case 'meta':
            // Agent 可观测事件
            handleAgentEvent(event);
            break;
        }
      }
    }
  }
}
```

## 七、开发代理配置

Vite 开发服务器代理到 NestJS 后端：

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

### 3.6 仪表盘页（DashboardPage）

**路由：** `/`（首页，默认进入仪表盘）

**布局要素：**

- **KPI 卡片行**：知识库总数、文档总数、切片总数、处理中/失败文档数、存储估算
- **调用趋势面积图**：近 7 天 API / 检索 / 聊天调用量趋势
- **调用类型分布饼图**：api / retrieval / chat 调用占比
- **最近活动流**：最近的 KB 创建和文档上传记录（时间相对标签："刚刚"、"5 分钟前"）

### 3.7 API 测试页（ApiTestPage）

**路由：** `/api-test`

**用途：** 对外部 API 服务进行 SSE 流式测试

**布局要素：**

- 服务选择下拉（从已创建的 api-service 列表选择）
- API Key 输入框（格式：`serviceId:apiKey`）
- 消息输入框 + 发送按钮
- SSE 日志查看器（实时显示每个事件的 type + value）
- 支持选择端点：`chat/stream`（传统 RAG）或 `agents/routeStream`（多 Agent 编排）
