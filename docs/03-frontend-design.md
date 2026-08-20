# 前端 Frontend 设计文档

> React 19 + Vite 8 前端应用设计，包含页面结构、组件体系、路由、状态管理与交互流程。

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
│  Header: Miaoma RAG | LangChain.js 实践台             │
├──────────┬───────────────────────────────────────────┤
│ Sidebar  │  Main Content Area                        │
│ ─────    │                                           │
│ 📚 知识库│  [动态页面内容]                            │
│ 📄 文档管│                                           │
│ 📋 切片管│                                           │
│ 🔍 知识检│                                           │
│ 💬 知识问│                                           │
│          │                                           │
│ ──统计──│                                           │
│ miaoma   │                                           │
│ 0 个文档 │                                           │
│ 0 个切片 │                                           │
└──────────┴───────────────────────────────────────────┘
```

### 2.2 路由定义

```typescript
const routes = [
  {
    path: '/',
    element: <MainLayout />,
    children: [
      // 知识库列表页 (Step 1)
      { index: true, element: <KnowledgeBaseList /> },
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

**对应图：step7.png**

**布局要素：**

- **左侧参数配置面板**（固定宽度 ~280px）：
  - 标题：「📊 检索参数」
  - 副标题：「调整检索参数，预览知识库命中效果」
  - 参数控件：
    - 结果返回数量 (topK)：滑块，默认 10
    - 最低相似度：数字输入，默认 0.00
    - 重排模型：Toggle 开关
    - Dense Weight：数字输入，默认 0.50
- **右侧主区域**：
  - 顶部：「🔍 检索历史」标签
  - 搜索框 + 搜索按钮
  - 搜索结果列表：

**搜索结果项格式：**

```
┌─────────────────────────────────────┐
│ 相似度 0.7900624  11gbk.csv         │
│                                     │
│ 日期sheet:2019/8/15                 │
│ 销售人:小王                          │
│ 手机型号: Redmi Note 8 Pro          │
│ 数量:5                              │
│ 单价:1399                           │
│ 订单金额:                           │
│ 订单状态:交易成功                    │
└─────────────────────────────────────┘
```

**交互逻辑：**

1. 输入查询词 → 点击搜索或回车
2. 调整参数 → 自动重新检索（防抖 300ms）
3. 结果按相似度分数降序排列
4. 点击历史记录 → 回填查询词并重新搜索

---

### 3.5 知识问答页

**对应图：step8.png, step9.png, step10.png**

**布局要素：**

整体分为 **左中右三栏**：

#### 左侧参数栏 (~280px)

```
┌──────────────────────────┐
│ 📋 模型回答参数            │
│ 调整检索参数，预览...       │
│                            │
│ 结果返回数量    [10]       │
│ 最低相似度      [0.00]     │
│ 重排模型     [Toggle]     │
│ Dense Weight  [0.50]      │
│                            │
├──────────────────────────┤
│ ⚙️ 服务调用                │
│ 发布当前问答参数...         │
│                            │
│ [创建服务调用] [API 调用]  │
│                            │
│ 暂无服务调用，创建后可生成   │
│ API Key 并对外提供接口      │
│                            │
│ 学生成绩问答 API  10 task  │
│ ek_xxxxxx                  │
└──────────────────────────┘
```

#### 中间对话区域

```
┌──────────────────────────────────────────┐
│ 💡 知识库助手                             │
│ Hi，我是知识库助手                         │
│                                          │
│ ───────── 用户消息 ─────────              │
│ 您未明确关于小王的具体需求（例如小王的销售  │
│ 业绩、对应订单情况等具体问题），无法为您提  │
│ 供针对性回答。已检索到的销售人"小王"相关    │
│ 的资料如下：                               │
│ 1. 2019年8月18日...                       │
│ 2. ...                                   │
│ 3. ...                                   │
│                                          │
│ ───────── AI 回复 ─────────              │
│ （流式输出，逐字显示）                     │
│                                          │
├──────────────────────────────────────────┤
│ 我可以阅读知识库的资料并使用自然语言回答    │
│ 你的问题                          [发送]  │
└──────────────────────────────────────────┘
```

#### 右侧引用来源面板

```
┌──────────────────────────────┐
│ 📎 引用来源                   │
│ 回答使用到的命中切片定显示在此 │
│                              │
│ 11gbk.csv   2019/8/18        │
│ score 0.636677               │
│ 日期sheet:2019/8/18          │
│ 销售人:小王                   │
│ ...                          │
│                              │
│ 11gbk.csv   2019/8/18        │
│ score 0.648863               │
│ ...                          │
│                              │
│ 11gbk.csv   2019/8/21        │
│ score 0.654024               │
│ ...                          │
└──────────────────────────────┘
```

#### 创建服务调用弹窗 (step9.png)

```
┌──────────────── 创建服务调用 ────────┐
│                                       │
│  将调试好的检索问答参数发布为知识服务    │
│                                       │
│  ┌───────────────────────────────┐   │
│  │  {}    服务调用  📘 使用手册   │   │
│  └───────────────────────────────┘   │
│  将检索、问答参数组合配置发布成知识服务  │
│  并通过 API Key 调用                │
│                                       │
│  服务调用名称 *                       │
│  ┌───────────────────────────────┐   │
│  │ 学生成绩问答 API               │   │
│  └───────────────────────────────┘   │
│                                       │
│  描述                    [7500/7500]  │
│  ┌───────────────────────────────┐   │
│  │ 给业务系统调用                 │   │
│  └───────────────────────────────┘   │
│                                       │
│  可用 API Key *                      │
│  请选择可用的 API Key，服务创建后...   │
│                                       │
│  名称    创建人    创建时间    操作     │
│  ─────────────────────────────────   │
│           暂无数据                     │
│                                       │
│  + 创建 API Key  已选择 0 个         │
│                                       │
│           [取消]  [确认创建]          │
└───────────────────────────────────────┘
```

#### API 调用面板 (step10.png)

```
┌──────────────── API 调用 ────────┐
│                                     │
│  使用服务 ID 与 API Key，将知识库    │
│  问答接入业务系统                    │
│                                     │
│  ○ 学生成绩问答 API                  │
│  ○ 给业务系统调用                    │
│                                     │
│  请求地址                            │
│  /api/service-calls/svc_f7818db-    │
│  e967-43f4-a3bd-bcbecdff0fd4/chat/  │
│  stream                             │
│                                     │
│  鉴权 Header                         │
│  Authorization: Bearer ek_gtjg10ggCM │
│  -OkSfLbg88v9ZeXkd6HD1              │
│                                     │
│  API Key                             │
│  📋 ek_gtjg10ggCM-OkSfLbg88v9ZeXk   │
│  dHD1                                │
│                                     │
│  请求示例                             │
│  curl -N -X POST "https://xxx/api/   │
│  service-calls/svc_.../chat/stream"  │
│  -H "Content-Type: application/json" │
│  -H "Authorization: Bearer ek_..."   │
│  -d "{\"message\":\"hey 成绩多少\"}" │
│                                     │
│  返回类型说明                          │
│  返回类型为 text/event-stream...      │
└───────────────────────────────────────┘
```

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
| `DocTable`           | 文档管理   | 文档列表表格             |
| `UploadDocButton`    | 文档管理   | 上传文档按钮 & 流程      |
| `DocStatusBadge`     | 文档管理   | 文档状态标签             |
| `ChunkGrid`          | 切片管理   | 切片卡片网格             |
| `ChunkCard`          | 切片管理   | 单个切片卡片             |
| `KbChunkList`        | 切片管理   | 按知识库查看切片列表页面 |
| `ChunkModal`         | 切片管理   | 新增/编辑切片模态框      |
| `SearchPanel`        | 知识检索   | 左侧参数配置面板         |
| `SearchResults`      | 知识检索   | 搜索结果列表             |
| `ChatPanel`          | 知识问答   | 中部对话区域             |
| `SourcePanel`        | 知识问答   | 右侧引用来源面板         |
| `CreateServiceModal` | 知识问答   | 创建服务调用弹窗         |
| `ApiUsagePanel`      | 知识问答   | API 调用说明面板         |

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
  uploadDocument: (file: File) => void;
}

// stores/chat-store.ts — 对话状态
interface ChatState {
  messages: ChatMessage[];
  sources: SourceRef[];
  isLoading: boolean;
  searchParams: SearchParams; // topK, minScore, reranker, denseWeight
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
