# 06-retrieval-upgrade.md

| 模块 | 旧版 | 新版 |
| - | - | - |
| 参数区 | 简单输入 | 参数侧栏 |
| 结果 | 文本列表 | 高亮结果卡片 |
| 调优 | 无 | TopK、阈值、重排序 |
| 数据链路 | 无 | 检索全链路可视化 |

---

# 1. 新页面结构设计

## 页面布局

- 顶部：页面标题 + 当前知识库
- 左侧参数区：TopK、相似度阈值、重排序、Dense Weight
- 右侧结果区：查询输入 + 结果列表
- 底部：检索耗时链路与指标

## 核心组件

- `Form`
- `Input.Search`
- `Slider`
- `Switch`
- `Card`
- `List`
- `Typography.Text mark`

# 2. 前端页面组件

1. 参数侧栏
   - `Form`：封装搜索参数
   - `Slider`：相似度阈值
   - `Switch`：重排行为开关
   - `InputNumber`：TopK、Dense Weight
2. 查询区域
   - `Input.Search`：支持回车检索
   - `Button`：`执行检索`
3. 检索结果
   - `Card` 或 `List.Item`：展示文档名、分数、命中片段
   - `Typography.Text mark`：高亮查询词命中区域
   - `Tag`：来源文件、分值标签
4. 结果链路
   - `Steps` / `Divider`：展示 Query → Embedding → Vector Search → Rerank → Result
   - `Statistic`：返回数、命中率、耗时

# 3. 后端 API 设计

## 当前接口

- `POST /retrieval/search`
  - 请求体：`{ kbId, query, topK, minScore, useReranker, denseWeight }`
  - 返回：`{ results, searchHistory }`

## 建议补充接口

- `GET /retrieval/params`
  - 返回可选模型、重排配置、默认参数
- `POST /retrieval/explain`
  - 返回检索链路解释信息
- `POST /retrieval/batch-search`
  - 支持批量检索与测试

# 4. 状态和数据结构

## SearchParams

- `topK: number`
- `minScore: number`
- `useReranker: boolean`
- `denseWeight: number`

## SearchResultItem

- `chunkId: string`
- `content: string`
- `sourceFile: string`
- `score: number`
- `highlightedContent?: string`
- `metadata?: Record<string, unknown>`

## 检索链路数据

- `RetrievalTrace`
  - `queryTime: number`
  - `embeddingTime: number`
  - `vectorSearchTime: number`
  - `rerankTime?: number`
  - `totalTime: number`

# 5. 新旧升级说明

- 从简单检索到企业级检索实验室
- 从单一输入到可调参数侧栏
- 从结果列表到命中高亮与链路透明
- 支持 AI 级检索调优与可视化指标
