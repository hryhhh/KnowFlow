# 05-chunk-upgrade.md

| 模块 | 旧版 | 新版 |
| - | - | - |
| 视图 | 卡片网格 | 表格 + 文本预览 |
| 操作 | 分散按钮 | 编辑/合并/删除菜单 |
| 筛选 | 替换为空 | 搜索 + 文档树过滤 |
| 状态 | 文本 | 相似度分值 + 源文件标签 |

---

# 1. 新页面结构设计

## 页面布局

- 顶部：页面标题 + 当前知识库/文档路径
- 左侧：文档目录树 + 过滤器
- 右侧：切片列表 + 详情区
- 底部：分页与汇总指标

## 核心组件

- `Tree` / `TreeSelect`
- `Table`
- `Card`
- `Drawer` / `Modal`
- `Badge`
- `Progress`

# 2. 前端页面组件

1. 文档目录树
   - `Tree`：展示知识库文档或章节结构
   - 点击节点切换当前文档/章节
2. 切片表格
   - `Table` 列：切片 ID、标题、内容预览、相似度、来源、更新时间、操作
   - `Typography.Text ellipsis`：内容预览截断
   - `Progress` / `Tag`：显示相似度分值
3. 操作入口
   - `Action Menu`：编辑、合并、删除、复制内容
   - `Drawer`：编辑文本、调整标题、批量操作
4. 详情与优化
   - `Card`：当前切片详情与来源信息
   - `Button`：手动微调、标签管理、错误修正

# 3. 后端 API 设计

## 当前接口

- `GET /documents/:docId/chunks`
- `GET /knowledge-bases/:kbId/chunks`
- `POST /documents/:docId/chunks`
- `PUT /chunks/:chunkId`
- `DELETE /chunks/:chunkId`

## 建议补充接口

- `GET /chunks/:chunkId/detail`
  - 返回切片完整内容、来源文档、向量信息
- `POST /chunks/:chunkId/merge`
  - 合并多个切片
- `POST /chunks/:chunkId/optimize`
  - 手动优化/微调片段
- `GET /chunks/:chunkId/similarity`
  - 返回该切片与其他切片相似度指标

# 4. 状态和数据结构

## ChunkCard

- `id: string`
- `index: number`
- `title: string`
- `contentPreview: string`
- `sourceFile: string`
- `tokenCount: number`
- `updatedAt: string`
- `kbId?: string`
- `docId?: string`
- `similarityScore?: number`

## ChunkDetail

- `id: string`
- `docId: string`
- `kbId: string`
- `chunkIndex: number`
- `title?: string`
- `content: string`
- `sourceFile: string`
- `tokenCount: number`
- `createdAt: string`
- `updatedAt: string`
- `vectorNorm?: number`
- `similarChunks?: Array<{ id: string; score: number; title?: string }>

# 5. 新旧升级说明

- 从静态卡片视图到文档树 + 表格视图
- 增加手动编辑与合并流程
- 高亮来源与相似度分值，便于检索调试
- 统一操作入口为更专业的 Action Menu
