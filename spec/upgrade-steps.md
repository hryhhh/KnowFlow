# 系统页面升级步骤

按照页面顺序，将现有系统页面升级为新的结构、视觉规范和 Ant Design X 组件。

## 0. 全局视觉规范与设计基础

1. 统一主题色：
   - 主色：#1677FF / #1668DC
   - Hover：#4096FF
   - Active：#0958D9
2. 功能色：
   - 成功：#52C41A
   - 警告：#FAAD14
   - 错误：#FF4D4F
   - 信息 / AI 特殊：#722ED1 / #13C2C2
3. 背景与中性色：
   - 顶部 Brand Bar 背景：#001529
   - 页面背景：#F5F7FA
   - 卡片背景：#FFFFFF
   - 主文本：#1D2129
   - 次文本：#4E5969
   - 边框：#F0F0F0 / #E5E6EB
4. 圆角与容器：
   - 基础圆角：8px
   - 小圆角：4px
   - 大圆角：12px
   - 卡片/面板：12px 圆角，轻微阴影
5. 按钮与交互：
   - 主按钮高度 32px / 40px
   - 圆角 6px 或 8px
   - 字重 500
   - 激活态可使用渐变边框或渐变背景
6. 字体与排版：
   - 正文字号 14px，行高 1.57
   - 模块标题 16px，字重 600
   - Dashboard 大数字 24px–30px，字重 700
   - 代码/日志使用等宽字体

## 1. 登录页（Login Page）

1. 页面结构：
   - 视觉与品牌区：深蓝科技感背景图、品牌名、品牌 Slogan
   - 表单交互区：账号、密码、显示/隐藏切换、“记住我”、忘记密码、登录按钮
   - 第三方登录区：分割线提示、SSO 图标按钮
2. 组件替换建议：
   - 使用 Ant Design X `Form`、`Input`、`Password`、`Checkbox`、`Button`
   - 第三方登录使用 `Button` / `IconButton` 或 `SocialLogin` 组合
   - 主视觉区域可使用 `Card` 或 `PageContainer`
3. 视觉升级：
   - 背景采用深蓝/渐变暗色
   - 交互区卡片背景白色或浅灰
   - 按钮主色为 #1677FF，Hover #4096FF

## 2. Dashboard 工作台（Dashboard）

1. 顶部 KPI 指标卡片组：
   - 知识库数、文档总数、切片总数、处理总容量
   - 添加对比增长率与状态图标
2. 数据可视化图表区：
   - 调用趋势图、Agent 调用占比图
3. 动态列表：
   - 最近问答/最近处理记录，含问题摘要、Agent 类型、响应耗时、时间戳
4. 组件替换建议：
   - 使用 Ant Design X `StatisticCard`、`Card`、`Charts`、`List`
   - 数字卡片采用 `Statistic` 或 X 定制 `ProCard`
   - 图表区可用 `LineChart` / `AreaChart` / `PieChart`
5. 视觉升级：
   - 卡片背景白色，边框浅灰，圆角 12px
   - KPI 数字加粗，图表使用主题蓝色/紫色渐变

## 3. 知识库管理（Knowledge Base Management）

1. 页面结构：
   - 操作栏：搜索框、主操作按钮“+ 创建知识库”
   - 数据表格：知识库名称、文档数、切片数、运行状态、更新时间
   - 行操作：查看、编辑、删除
   - 底栏分页：总条数、页码、每页条数
2. 组件替换建议：
   - 使用 Ant Design X `Table`、`Input.Search`、`Button`、`Tag`、`Pagination`
   - 状态标签使用 `Tag` 或 `StatusBadge`
   - 行操作按钮使用 `ActionButton` 或 `Button` + 图标
3. 视觉升级：
   - 操作栏卡片化，按钮主色高亮
   - 表格行 hover 显示微弱背景
   - 状态标签采用功能色设计

## 4. 文档管理（Document Management）

1. 页面结构：
   - 搜索与筛选：关键字搜索、文件类型、状态筛选
   - 上传区：拖拽上传 + “+ 上传文档”按钮
   - 文档列表：文件名、类型、解析状态、上传时间、操作
   - 操作列：重新解析、下载、删除
2. 组件替换建议：
   - 使用 Ant Design X `Upload.Dragger`、`Table`、`Select`、`Button`
   - 搜索框使用 `Input.Search`
   - 状态显示使用 `Tag` 或 `Badge`
3. 视觉升级：
   - 上传区域强调卡片边框和拖拽指示
   - 文档列表图标和状态色彩清晰
   - 失败/解析中状态使用警告/错误色

## 5. 文档解析详情（Document Processing Detail）

1. 页面结构：
   - 顶部概览卡片：状态标签、文件元数据、处理耗时
   - 流程步骤条：上传、解析、切片、Embedding、完成
   - 解析日志与文本预览：时间戳日志、处理记录
2. 组件替换建议：
   - 使用 Ant Design X `Steps`、`Card`、`Descriptions`、`Timeline`
   - 日志区可用 `List` 或 `Timeline`
3. 视觉升级：
   - 流程节点使用绿色勾选状态
   - 日志区背景浅灰，便于阅读
   - 元数据卡片采用 `Descriptions` 列表布局

## 6. 切片管理（Chunk Management）

1. 页面结构：
   - 左侧文档与结构树：所属文档名、章节大纲
   - 右侧切片表格：切片 ID、内容预览、相似度分值、操作
   - 支持切片手动微调、编辑、合并、删除
2. 组件替换建议：
   - 使用 Ant Design X `Tree` / `TreeSelect` 展示文档结构
   - 切片列表使用 `Table`、`TextArea`、`ActionButton`
   - 编辑弹窗或抽屉使用 `Drawer` / `Modal`
3. 视觉升级：
   - 左侧树状结构卡片化，右侧表格简洁分区
   - 内容预览文本截断并高亮匹配片段
   - 相似度使用 `Progress` 或 `Tag`

## 7. 知识检索实验室（Retrieval Lab）

1. 页面结构：
   - 查询输入区：Query 输入框、执行检索按钮
   - 参数配置侧栏：TopK、相似度阈值、重排序开关
   - 检索结果列表：文档名、匹配度、命中片段高亮
   - 检索耗时链路展示：Query → Embedding → Vector Search → Rerank → Result
2. 组件替换建议：
   - 使用 Ant Design X `Search`、`Slider`、`Switch`、`List` 或 `Card`
   - 参数面板使用 `Form` + `Card` 布局
   - 结果列表使用 `List` 或 `Table`，高亮文本可使用 `Typography.Text mark`
3. 视觉升级：
   - 结果卡片使用浅色卡片样式
   - 参数控制区与结果区区分明显
   - 耗时链路用步骤文本或 `Divider` 逐段展示

## 8. AI 知识问答（AI QA Chat）

1. 页面结构：
   - 配置侧栏：知识库选择、模型选择
   - 对话主区：用户/AI 对话气泡、Markdown 渲染、代码高亮
   - 引用溯源：回答下方引用卡片
   - 输入框底栏：文本输入、发送、清空
2. 组件替换建议：
   - 使用 Ant Design X `Chat` / `Bubble` / `Sender` / `Prompts`
   - 知识库与模型选择使用 `Select`
   - 溯源卡片使用 `Card`、`Tag` 或 `Citations`
3. 视觉升级：
   - 对话气泡采用左右区分、圆角差异
   - 发送按钮激活态使用渐变蓝紫
   - 引用卡片小巧、信息清晰

## 9. Agent 管理（Agent Management）

1. 页面结构：
   - Agent 列表卡片：名称、类型、状态、调用次数
   - 配置入口：新建 Agent、规则配置
2. 组件替换建议：
   - 使用 Ant Design X `List`、`Card`、`Button`
   - 状态卡片可用 `Tag` / `StatusBadge`
   - 新建入口使用 `Modal` / `Drawer`
3. 视觉升级：
   - 卡片列表统一间距与层级
   - 运行状态使用功能色高亮
   - 操作按钮与配置入口按主色区分

## 10. Agent 流程编排（Agent Workflow）

1. 页面结构：
   - 图形化画布：节点与连线展示 Agent 流程
   - 节点属性面板：选中节点时显示参数与指令配置
2. 组件替换建议：
   - 使用 Ant Design X `Canvas` / `Flow` 组件（或第三方画布组件，与 X 风格配合）
   - 属性面板使用 `Drawer` / `Card` + `Form`
3. 视觉升级：
   - 节点连接线带箭头、数据流向明确
   - 选中节点高亮边框和渐变色
   - 右侧面板背景与主画布区分

## 11. Agent 执行日志（Agent Execution Logs）

1. 页面结构：
   - 顶部会话 ID
   - 左侧执行链路图
   - 右侧时间轴日志、节点行为明细
2. 组件替换建议：
   - 使用 Ant Design X `Timeline` / `Steps` / `Card`
   - 日志文本使用等宽字体 `Typography.Text code`
   - 链路图可用 `FlowChart` 或 `Process` 组件
3. 视觉升级：
   - 时间轴精确到毫秒，日志条目清晰分隔
   - 左侧链路图节点聚焦当前流程
   - 右侧日志背景浅灰，展示结构化信息

## 12. API 开放平台（Open API Platform）

1. 页面结构：
   - 侧边导航：API 密钥管理、调用统计、文档指南
   - 密钥管理：生成、展示、复制、额度进度
   - 接口文档：代码示例、一键复制、在线测试
2. 组件替换建议：
   - 使用 Ant Design X `Tabs`、`Card`、`Button`、`Copyable`、`Progress`
   - API 文档区使用 `CodeBlock` / `Typography.Text`
3. 视觉升级：
   - 密钥管理卡片简洁明了
   - 文档示例代码使用深色/低对比代码块
   - 进度条与额度信息颜色一致

---

## 后续执行建议

1. 先梳理页面路由和菜单结构，确保新增页面顺序与设计一致。
2. 逐页迭代升级：先完成基础容器与布局，再替换组件。
3. 按需扩展 Ant Design X 主题 Token，保证全局样式一致。
4. 所有页面完成后，统一做一次视觉与交互验收。
