# 03-document-upgrade.md

| 模块 | 旧版 | 新版 |
| - | - | - |
| 列表 | 纯表格 | 搜索 + 文件上传 + 任务状态 |
| 上传 | 隐藏文件输入 | 拖拽上传 + 显著按钮 |
| 状态 | 状态文本 | 状态 Badge + 进度提示 |
| 操作 | 纯链接 | 统一 Action Menu |

---

# 1. 新页面结构设计

## 页面布局

- 页面顶部：页面标题 + 当前知识库名称
- 操作区：上传文档按钮 + 拖拽上传区域 + 文档搜索与筛选
- 文档表格区：文件名、类型、状态、切片数、上传时间、操作
- 侧边详情区：选中文档的元数据与处理指标

## 核心组件

- `Upload.Dragger`
- `Table`
- `Badge`
- `Tag`
- `Drawer` / `Modal`
- `Form`

# 2. 前端页面组件

1. 上传区
   - `Upload.Dragger`：支持文件拖拽和点击上传
   - `Button`：`+ 上传文档`
   - `Alert`/`Text`：支持文件类型说明
2. 搜索与筛选
   - `Input.Search`：按文件名搜索
   - `Select`：文件类型、状态筛选
   - `Button`：刷新、导出
3. 文档表格
   - `Table` 列：名称、文件类型、解析状态、切片数、导入方式、更新时间、操作
   - `StatusBadge`：`pending`, `processing`, `success`, `failed`
   - `Action Menu`：重新解析、下载、删除、查看详情
4. 详情抽屉
   - `Drawer`：打开时显示解析详情、日志入口、引用状态

# 3. 后端 API 设计

## 当前接口

- `GET /knowledge-bases/:kbId/documents`
  - 查询参数：`search?: string`
  - 返回：`DocListItem[]`
- `POST /knowledge-bases/:kbId/documents`
  - 表单字段：`file`、`processStrategy?`
  - 返回：上传并处理后的 `DocListItem`
- `DELETE /knowledge-bases/:kbId/documents/:docId`

## 建议补充接口

- `GET /knowledge-bases/:kbId/documents/:docId`
  - 返回文档详情、处理元数据、状态说明
- `POST /knowledge-bases/:kbId/documents/:docId/reprocess`
  - 触发重新解析 / 重新切片
- `GET /knowledge-bases/:kbId/documents/:docId/download`
  - 直接下载原始文件

# 4. 状态和数据结构

## Document 列表项

- `DocListItem`
  - `id: string`
  - `kbId: string`
  - `name: string`
  - `status: "pending" | "processing" | "success" | "failed"`
  - `strategy: string`
  - `chunkCount: number`
  - `importMethod: string`
  - `updatedAt: string`
  - `actions: string[]`

## Document 详情

- `DocumentDetail`
  - `id: string`
  - `kbId: string`
  - `name: string`
  - `fileType: string`
  - `fileSize: number`
  - `processStrategy: string`
  - `status: string`
  - `chunkCount: number`
  - `importMethod: string`
  - `errorMessage?: string`
  - `createdAt: string`
  - `updatedAt: string`

## 状态映射

- `pending`：待处理
- `processing`：解析中
- `success`：处理成功
- `failed`：处理失败

# 5. 新旧升级说明

- 从简单列表到可上传、可筛选、可重试的文档管理
- 从隐式上传到可见拖拽区与进度反馈
- 从文本状态到统一 Badge + 状态标签
- 新增操作菜单，减少页面杂乱操作按钮
