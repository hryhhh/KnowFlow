# 12-setting-upgrade.md

| 模块 | 旧版 | 新版 |
| - | - | - |
| 设置页 | 无 | 系统设置页 |
| 结构 | 无 | 侧边导航 + 分块配置 |
| 项目 | 无 | 全局主题、权限、日志、系统信息 |
| 操作 | 无 | 保存、恢复默认、切换环境 |

---

# 1. 新页面结构设计

## 页面布局

- 左侧：设置导航菜单
- 中部：设置内容面板
- 右侧：说明与帮助信息
- 底部：操作按钮（保存、恢复默认）

## 核心组件

- `Tabs`
- `Form`
- `Card`
- `Switch`
- `Input`
- `Button`
- `Description`

# 2. 前端页面组件

1. 基础设置
   - 主题色、界面模式、默认语言
   - `Switch`：暗黑模式、动画开关
2. API 与安全
   - `Input.Password`：刷新 API 秘钥
   - `Switch`：启用/禁用外部调用
3. 日志与监控
   - `Card`：显示日志级别、保留天数
   - `Button`：下载日志、清理缓存
4. 系统信息
   - `Descriptions`：版本号、部署时间、数据库状态
   - `Alert`：系统健康提示

# 3. 后端 API 设计

## 建议接口

- `GET /settings`
  - 返回当前系统配置
- `PUT /settings`
  - 更新系统设置
- `GET /system-info`
  - 返回运行版本、服务状态、依赖状态
- `POST /settings/reset`
  - 恢复默认配置

# 4. 状态和数据结构

## SystemSettings

- `theme: string`
- `darkMode: boolean`
- `language: string`
- `apiEnabled: boolean`
- `loggingLevel: string`
- `logRetentionDays: number`
- `cacheEnabled: boolean`

## SystemInfo

- `appVersion: string`
- `uptime: string`
- `databaseStatus: string`
- `memoryUsage: string`
- `environment: string`

# 5. 新旧升级说明

- 从无系统设置到集中化配置页面
- 从无系统信息到实时运行状态展示
- 从无安全入口到 API 与日志控制
- 支持恢复默认与环境切换
