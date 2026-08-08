# 02-knowledge-base-upgrade.md

| 模块 | 旧版 | 新版 |
| - | - | - |
| 列表 | 卡片列表 | 卡片 + Table |
| 筛选 | 简单搜索 | 搜索 + 高级筛选 |
| 操作 | 基本按钮 | Action Menu + 快捷操作 |
| 状态 | 文本 | Status Badge + 状态列 |

---

# 1. 新页面结构设计

## 页面布局

- 顶部页头：页面标题 + 全局搜索
- 操作栏：创建知识库按钮 + 批量操作入口 + 统计信息
- 主内容区：知识库列表，支持卡片视图与表格视图切换
- 侧边栏/浮层：知识库详情、编辑、删除确认

## 核心结构

- `PageContainer`
- `Form` + `Input.Search`
- `Table` / `List`
- `Tag` / `Badge`
- `Drawer` / `Modal`

# 2. 前端页面组件

1. 顶部操作区
   - `Input.Search`：按名称搜索知识库
   - `Button`：`+ 创建知识库`
   - `Select`：按类型过滤（免费、私有、公开）
2. 知识库呈现
   - `Table`：列显示名称、描述、文档数、切片数、状态、更新时间、操作
   - `List`：卡片展示时显示关键指标和操作按钮
3. 操作按钮
   - `Action Menu`：编辑、删除、进入文档、进入检索、进入问答
   - `StatusBadge`：运行正常、处理中、异常
4. 弹窗与侧栏
   - `Modal`：创建/编辑知识库表单
   - `Drawer`：查看知识库详情与权限信息

# 3. 后端 API 设计

## 当前接口

- `GET /knowledge-bases`
  - 查询参数：`search?: string`
  - 返回：`KbListItem[]`
- `POST /knowledge-bases`
  - 请求体：`{ name: string; description?: string; type?: string }`
  - 返回：创建后的 `KnowledgeBase`
- `PUT /knowledge-bases/:id`
  - 请求体：`{ name?: string; description?: string; type?: string }`
- `DELETE /knowledge-bases/:id`

## 建议补充接口

- `GET /knowledge-bases/:id`
  - 返回详细知识库数据（含文档数、切片数、状态、创建/更新时间）
- `GET /knowledge-bases/:id/summary`
  - 返回当前知识库概览指标

# 4. 状态和数据结构

## 关键数据结构

- `KbListItem`
  - `id: string`
  - `name: string`
  - `description: string`
  - `type: string`
  - `status: string`
  - `documentCount: number`
  - `chunkCount: number`
  - `createdAt: string`
  - `updatedAt: string`

- `KnowledgeBaseDetail`
  - `id: string`
  - `name: string`
  - `description: string`
  - `type: string`
  - `status: string`
  - `documentCount: number`
  - `chunkCount: number`
  - `processingDocCount: number`
  - `updatedAt: string`

## 状态映射

- `active` → 正常运行
- `processing` → 数据处理
- `error` / `failed` → 异常

# 5. 新旧升级说明

- 从简单卡片列表到企业级知识库管理面板
- 从单一创建入口到搜索 + 筛选 + 多级操作
- 从无详情页到知识库概览 + 统计指标
- 统一状态为 Badge 与颜色语义，提升可读性
