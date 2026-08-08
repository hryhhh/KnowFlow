# 11-api-upgrade.md

| 模块 | 旧版 | 新版 |
| - | - | - |
| 平台 | 无 | Open API 平台 |
| 密钥 | 无 | API Key 管理 |
| 文档 | 无 | 接口文档 + 代码示例 |
| 调试 | 无 | 在线测试 + 复制按钮 |

---

# 1. 新页面结构设计

## 页面布局

- 左侧：导航标签：API 密钥、调用统计、文档指南
- 中部：主内容区
  - API 密钥管理区
  - 调用统计区
  - 文档示例区
- 右侧：快捷说明与使用指南

## 核心组件

- `Tabs`
- `Card`
- `Button`
- `Copyable`
- `Progress`
- `CodeBlock`

# 2. 前端页面组件

1. API Key 管理区
   - `Table` / `List`：展示 keyPrefix、状态、调用次数、更新时间
   - `Button`：创建、复制、撤销
   - `Tag`：显示启用/停用
2. 调用统计区
   - `StatisticCard`：展示调用总数、日活、错误率
   - `BarChart` / `AreaChart`
3. 文档指南区
   - `CodeBlock`：展示 `curl`、`JavaScript`、`Python` 示例
   - `Copyable`：一键复制请求体与示例代码
   - `Collapse`：详细参数说明
4. 在线测试区
   - `Textarea`
   - `Button`：`模拟调用`
   - `ResultCard`：显示请求结果

# 3. 后端 API 设计

## 当前接口

- `GET /api-services`
- `POST /api-services`
- `DELETE /api-services/:serviceId`

## 建议补充接口

- `GET /api-services/:serviceId`
  - 返回单个服务详情
- `GET /api-services/:serviceId/stats`
  - 返回调用次数、错误数、最近调用
- `POST /api-services/:serviceId/revoke`
  - 撤销密钥
- `POST /service-calls/:svcId/chat/stream`
  - 已存在的外部调用入口

# 4. 状态和数据结构

## ApiServiceItem

- `id: string`
- `serviceName: string`
- `description: string`
- `keyPrefix: string`
- `kbId: string`
- `callCount: number`
- `updatedAt: string`

## ApiServiceDetail

- `id: string`
- `serviceName: string`
- `description: string`
- `keyPrefix: string`
- `kbId: string`
- `callCount: number`
- `createdAt: string`
- `updatedAt: string`
- `status: string`
- `endpoint: string`

## API 文档示例

- `endpoint: string`
- `method: string`
- `headers: Record<string, string>`
- `bodySchema: Record<string, unknown>`
- `exampleRequest: string`
- `exampleResponse: string`

# 5. 新旧升级说明

- 从基础服务管理到合规 API 平台
- 从无文档到可复制、可调试的接口示例
- 从无调用统计到可视化指标面板
- 支持外部系统一键接入
