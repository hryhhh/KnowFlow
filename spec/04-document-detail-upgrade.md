# 04-document-detail-upgrade.md

| 模块 | 旧版 | 新版 |
| - | - | - |
| 详情页 | 无 | 文档解析详情页 |
| 流程 | 无 | 上传 → 解析 → 切片 → Embedding → 完成 |
| 日志 | 无 | 解析日志 + 元数据展示 |
| 操作 | 无 | 重新解析、原文下载、查看切片 |

---

# 1. 新页面结构设计

## 页面布局

- 顶部：页面标题 + 文档基本信息
- 概览卡片：状态标签、页数、总字数、切片数、处理耗时
- 流程条：`Steps` 显示 `上传`、`解析`、`切片`、`Embedding`、`完成`
- 日志区：`Timeline` 或 `List` 展示解析步骤与时间戳
- 右侧或底部区域：原文预览、错误信息、操作按钮

## 核心组件

- `PageContainer`
- `Card`
- `Steps`
- `Timeline`
- `Descriptions`
- `Badge`
- `Drawer`

# 2. 前端页面组件

1. 文档概览卡片
   - `Descriptions`：显示文档名、文件类型、处理状态、页数、字数、切片数、耗时
   - `Badge`：状态标签显示处理状态
2. 解析流程条
   - `Steps`：节点显示每一步状态和完成勾选
   - `Tooltip`：说明每一步的解释
3. 解析日志块
   - `Timeline`：每条日志带时间戳
   - `CodeBlock` / `Typography.Text`：展示日志细节
4. 预览区域
   - `Card`：展示原文或预览片段
   - `Button`：下载原文、重新解析、查看所有切片
5. 错误与警告
   - `Alert`：展示 `failed` 时的错误信息

# 3. 后端 API 设计

## 建议接口

- `GET /knowledge-bases/:kbId/documents/:docId`
  - 返回文档详情与解析状态
- `GET /documents/:docId/logs`
  - 返回解析日志列表
- `POST /knowledge-bases/:kbId/documents/:docId/reprocess`
  - 重新触发文档解析
- `GET /documents/:docId/preview`
  - 返回原文预览或片段
- `GET /documents/:docId/download`
  - 返回原始文件下载链接

# 4. 状态和数据结构

## DocumentDetail

- `id: string`
- `kbId: string`
- `name: string`
- `fileType: string`
- `fileSize: number`
- `status: string`
- `processStrategy: string`
- `chunkCount: number`
- `importMethod: string`
- `errorMessage?: string`
- `createdAt: string`
- `updatedAt: string`
- `pageCount?: number`
- `wordCount?: number`
- `processingTimeSec?: number`

## DocumentLogItem

- `timestamp: string`
- `message: string`
- `step?: string`
- `level?: "info" | "warning" | "error"`

## 解析流程状态

- `uploaded`
- `parsing`
- `chunking`
- `embedding`
- `completed`
- `failed`

# 5. 新旧升级说明

- 从无详情页到完整文档解析大盘
- 从单一列表到可视化流程与日志追踪
- 从隐藏错误到即时错误与重试入口
- 从片段入口分散到统一文档级别控制面板
