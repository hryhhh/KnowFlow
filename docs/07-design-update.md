1. 登录页（Login Page）
   视觉与品牌区： 深蓝科技感背景图饰、大字号品牌名（AI Knowledge 企业智能知识中台）、品牌 Slogan（“让知识更智能，让决策更高效”）。

表单交互区： 账号输入框、密码输入框（含显示/隐藏切换）、“记住我”复选框与“忘记密码”链接、主操作按钮（高亮蓝色“登录”）。

第三方登录区： 分割线提示，结合企业常用 SSO 快捷登录图标（如微信、钉钉、Google 等）。

2. Dashboard 工作台（Dashboard）
   顶部指标卡片组（Kpi Metrics）：

知识库数、文档总数、切片总数、处理总容量（TB/GB 级）。

包含主数值、对比上月增长率（环比 +/-%）与图标指示。

数据可视化图表区（Charts）：

调用趋势图： 折线图/面积图（显示不同时间段的 API 与检索请求量变化）。

Agent 调用占比： 环比饼图/环形图（分类标明 DB Agent、RAG Agent、Search Agent 等比例）。

动态列表（Recent Activity）： 展示“最近问答/最近处理”记录，含问题摘要、调用的 Agent 类型、响应耗时及精确时间戳。

3. 知识库管理（Knowledge Base Management）
   操作栏（Header Actions）： 全局搜索框、主操作按钮（高亮“+ 创建知识库”）。

数据表格（Data Table）：

列定义： 知识库名称、关联文档数、切片总数、运行状态（正常/处理中/异常等高亮 Tag）、更新时间。

行操作项： 查看详情（眼睛图标）、编辑（铅笔图标）、删除（垃圾桶图标）。

底栏分页（Pagination）： 总条数显示、页码切换与单页显示条数选择器。

4. 文档管理（Document Management）
   搜索与筛选： 文档关键字搜索框、按文件类型（PDF/XLSX/Word 等）与状态筛选 Dropdown。

文件上传区： 主按钮“+ 上传文档”（支持点击及拖拽上传）。

文档列表：

文件名（带格式 Icon）、文件类型、当前解析状态（如：已完成/解析中/失败）、上传时间。

操作列（重新解析、下载、删除）。

5. 文档解析详情（Document Processing Detail）
   顶部概览卡片： 状态标签（如“处理完成”）、文件元数据（页数、总字数、拆分切片数、处理耗时秒数）。

可视化流程步骤条（Steps / Timeline）：

上传 ➔ 2. 解析 ➔ 3. 切片 ➔ 4. Embedding 向量化 ➔ 5. 完成。每个节点带有绿色勾选状态指示。

解析日志与文本预览（Log & Preview）： 按时间戳列出系统详细处理日志（如“10:21 开始解析”、“10:23 创建450个切片”等）。

6. 切片管理（Chunk Management）
   左侧文档与列表树： 展示所属文档名及结构大纲（如第 1 章 概述、第 2 章 Sentinel 等）。

切片表格区：

列定义： 切片 ID（如 001、002）、内容预览（截取的文本片段）、向量相似度/匹配度分值（如 0.92）、操作（编辑/合并/删除）。

调整与优化： 支持对单个 Chunk 手动微调文本，提升后续检索准确度。

7. 知识检索实验室（Retrieval Lab）
   测试输入区： Query 查询测试输入框，旁置高亮“执行检索”按钮。

参数配置侧栏/面板： TopK 数量设置、相似度阈值滑动条（如 0.75）、重排序（Rerank）开关。

检索结果列表（Search Results）：

显示召回的知识库文档名称、匹配度评分（如 0.91）。

命中片段文本高亮展示。

底端显示检索全链路耗时路线（Query ➔ Embedding ➔ Vector Search ➔ Rerank ➔ Result）。

8. AI 知识问答（AI QA Chat）
   配置侧栏： 关联知识库选择框（如“技术文档库”）、调用模型选择框（如“GPT-4o”/“Claude”/自研大模型）。

对话交互主区（Chat UI）：

用户提问气泡： 靠右显示。

AI 回答气泡： 靠左显示，支持 Markdown 渲染及代码高亮。

引用溯源（Citations）： 回答下方卡片式列出引用的文档名、章节数及关联度评分，点击可跳转原文。

输入框底栏： 文本输入域、发送按钮、清空会话图标。

9. Agent 管理（Agent Management）
   Agent 状态卡片/列表：

属性定义： Agent 名称（Router / Tool / RAG Agent 等）、Agent 类型、当前运行状态（运行中/空闲/停用）、累计调用次数（如 1,532 次）。

配置按钮： “+ 新建 Agent”及各 Agent 独立的规则配置入口。

10. Agent 流程编排（Agent Workflow）
    图形化画布（Canvas）：

节点（Nodes）： 用户输入节点 ➔ Master Agent（主控节点） ➔ 分发至 DB Query Agent / FAQ Agent / Web Search Agent 等分支节点。

连接线（Edges）： 带有箭头与数据流向指示的连线。

节点属性面板： 选定某个 Agent 节点时，右侧弹出的详细参数设置与指令配置（Prompt 配置）。

11. Agent 执行日志（Agent Execution Logs）
    会话 ID（Conversation ID）： 顶部显示全局追踪 ID（如 conv_202406010001）。

左侧执行链路图： 可视化展示本次请求穿过的 Agent 节点（Master ➔ DB Query ➔ SQL 生成 ➔ 组合答案）。

右侧时间轴日志（Console Log）：

精确到毫秒的时间戳（如 10:30:01）。

节点行为明细（如“Intent 识别：database_query”、“执行 SQL: select count(*)...”、“返回结果：8”）。

12. API 开放平台（Open API Platform）
    侧边导航： API 密钥管理、调用统计、文档指南。

密钥管理区（API Key）：

Key 生成与展示（打码处理）、复制按钮、调用额度限制/已用额度进度条。

接口调试与文档区（API Documentation）：

代码示例框（包含 POST 请求路径、Header 鉴权 Token、JSON Body 入参结构体及示例响应），附带一键复制与在线测试功能

一、 统一色调体系（Theme & Palette）
为了契合“企业级”、“专业”与“高科技 AI”的定位，建议采用科技暗蓝（Tech Dark Blue）主色结合柔和中性灰的基础基调。

1. 品牌与主色（Primary Color）
   主色（Primary）： #1677FF（Ant Design 默认 Tech Blue）或稍微偏向深邃科技感的 #1668DC。

Hover 态： #4096FF

Active 态： #0958D9

应用场景： 主按钮、AI 思考/生成中的高亮态、选中的 Tab、流程节点高亮边框、主要图表折线。

2. 功能色（Functional Colors）
   成功（Success）： #52C41A（用于“解析完成”、“运行正常”等状态标签）。

警告（Warning）： #FAAD14（用于“排队中”、“解析超长”等提示）。

错误/危险（Error）： #FF4D4F（用于“解析失败”、“删除操作”、“API 调用超限”）。

信息/AI 专属（Info / AI Special）： #722ED1（优雅紫）或 #13C2C2（青蓝）。

Ant Design X 特性： 在 AI 问答、Agent 思考、自动生成等场景下，可引入渐变紫色/深青色（例如 #1677FF ➔ #722ED1）作为 AI 特性（AI Sparkle / Glow）的专属视觉符号。

3. 背景与中性色（Neutral & Backgrounds）
   顶部 Brand Bar 背景： #001529（经典暗蓝/深色模式，凸显沉稳与科技感知）。

主页面背景（Page BG）： #F5F7FA（极轻柔的冷灰，比pure white更耐看且减少视觉疲劳）。

卡片/面板背景（Card BG）： #FFFFFF（纯白卡片，通过阴影与背景层级区分）。

主文本色： #1D2129（高对比度，确保文档/日志易读）。

次要文本色： #4E5969（用于元数据、时间戳、配置说明）。

边框/分割线： #F0F0F0 或 #E5E6EB。

二、 核心 UI 组件与细节规范
Ant Design 5.0+ 使用 ConfigProvider 和 Design Token 驱动组件样式，Ant Design X 完全兼容这套机制。

1. 容器与圆角（Border Radius）
   Ant Design X 强调“现代与精致感”，微圆角设计更符合现代 AI 软件质感。

基础圆角 Token (borderRadius)： 8px

小尺寸圆角 (borderRadiusSM)： 4px（适用于 Tag 标签、Tooltip、小尺寸 Input）。

大尺寸圆角 (borderRadiusLG)： 12px（适用于 Modal 弹窗、Card 容器、AI 对话气泡）。

圆角与圆弧应用：

通用卡片/面板： 12px 圆角，配以极轻浅微阴影（0 2px 8px rgba(0, 0, 0, 0.04)）。

AI 问答气泡（Bubble Component）：

用户气泡：右上角为 2px 直角/小圆角，其余三角为 16px 大圆角（呈现从右侧发出的对话感）。

AI 气泡：左上角为 2px 直角/小圆角，其余三角为 16px 大圆角。

2. 按钮与交互（Buttons & Actions）
   主按钮（Primary Button）：

高度：标准 32px / 大尺寸 40px。

圆角：6px 或 8px。

字体权重：500（中黑体）。

交互：带有微弱渐变或 Hover 时的轻微上浮阴影（0 4px 12px rgba(22, 119, 255, 0.2)）。

AI 功能专用按钮（Ant Design X 扩展）：

使用渐变边框或带有微光的图标（如 Prompts / Sender 组件内置样式）。

例如发送按钮在有输入内容时激活为渐变蓝紫底色（linear-gradient(135deg, #1677FF 0%, #722ED1 100%)）。

3. 字体与排版（Typography）
   字体族（Font Family）： -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif

代码/日志字体（Monospace）： SFMono-Regular, Consolas, 'Liberation Mono', Menlo, Courier, monospace（专门应用于 ⑪ Agent 执行日志 和 ⑫ API 代码示例）。

字号与行高：

正文：14px（行高 1.57）

小字/元数据：12px（行高 1.5）

模块卡片标题：16px（字重 600）

Dashboard 大数字（Stat）：24px - 30px（字重 700，如“12,532”）

三、 结合 Ant Design X 的专属 AI 场景细节
Ant Design X 提供了一系列专为 AI/RAG/Agent 打造的高阶组件，在该系统中的细节体现如下：

AI 对话与思维链（Bubble & ThoughtChain 组件）：

在 ⑧ AI 知识问答 和 ⑪ Agent 执行日志 中，使用 ThoughtChain 展示 Agent 的推理过程。

细节： 思维链折叠面板采用 #FAFAFA 淡灰背景，左侧带有 2px 渐变蓝色竖线（Border-Left），展开过程动画顺滑，呈现“打字机”式的逐步渲染效果。

输入框与提示词（Sender & Prompts Component）：

在问答和测试页中使用 Sender 组件，自带快捷发包、清空、终止生成（Stop）的状态切换。

输入框下方附带预设提示词卡片（Prompts），采用扁平透明底色，Hover 时边框高亮为 Primary Color。

引用与溯源卡片（Citations / References）：

在 RAG 检索结果后附带的脚标，采用小巧的卡片形式（Tag 风格），包含文件 Icon、文档名缩略、及绿色/蓝色的相似度 Percent 标记（如 92%）。
