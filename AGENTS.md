## 项目概述
面向普通学生的 DeepSeek Harness 教师智能体市场（插件）：学生进入「智能体」看到教师卡片（AI 数学老师、AI 物理老师），可「开始学习」，或把老师加入「我的智能体」。按 DeepSeek Harness 0.2.0-rc.2 开发。
UI 为「数学派 Shuxuepai」风格工作台（浅米白书架侧栏 + 纸白内容主区 + 墨蓝品牌色），设计依据见 `DESIGN.md`。除教师市场外，新增「学习产物」预览区：订阅当前学习会话的事件窗口，把老师生成的 html / 视频 / 图片 / 文件抽取出来独立预览，不再折叠在工具卡片里。

## 技术栈
- Node.js（engines `^22.19.0 || >=24.0.0`）+ TypeScript（ESM，NodeNext），包管理器 pnpm
- `@deepseek-ai/cordis` 插件框架；React 18 渲染客户端 UI
- 产物编译到 `lib/`，作为 npm 包分发（`npm pack` / prepack）

## 目录结构
- `src/index.ts`：插件 Node 半端入口，**intentionally 无运行时行为**（`apply(_ctx)` 为空，仅占位）
- `src/client.tsx` + `src/client.css`：注入 DeepSeek Harness 宿主客户端的教师市场 UI 渲染层（数学派工作台：市场 / 我的智能体 / 学习产物）
- `src/presets/*.yml`：**每个 Agent Preset 一个文件**（`ai-math-teacher.yml`、`ai-physics-teacher.yml`），后续新增老师在此目录新建即可，无需手改大文件
- `scripts/build-presets.mjs`：把 `src/presets/*.yml` 合并回 `cordis.patch.yml`（Harness 打包单文件契约，直接交付，故 **cordis.patch.yml 是生成产物、勿手改**）
- `scripts/build-client.mjs`：把 client UI 打包进管理层
- `cordis.patch.yml`：客户端 UI 与 Agent Preset 的组合配置清单（打包输入，由 build-presets 生成）
- `DESIGN.md`：数学派视觉风格设计稿（配色 / 排版 / 动效 / 禁忌）

## 关键入口 / 核心模块
- 插件名 `dsh-teacher-marketplace`，`inject: []`；客户端注入点：`sidebar.footer.action`（智能体入口）+ `main`（工作台面板，3 个视图：market / mine / artifacts）
- 两个 Agent Preset：`ai-math-teacher`、`ai-physics-teacher`（只负责教师人格与教学策略，**不重复挂载** `dsh-wrong-question`、`dshmath-manim` 等宿主级插件，避免 Harness 0.2.x eager mount 导致 DB/路由/工具多份创建）
- 宿主级插件（`dsh-wrong-question`、`dshmath-manim`）由 web profile 宿主层统一加载
- 学习产物抽取：client 通过 `ctx.sessions.retain()` 订阅最活跃非 blank 会话的 `binding.eventSource`（`SessionEventWindow`），从 `entries[].event` 按 `SessionEvent.data` 结构**定点抽取**（见下方"常见问题和预防"）：识别 html / 视频 / 图片 / 文件；产物渲染 `ArtifactPreview`（html→srcdoc iframe、video/image/html/file→媒体或 iframe、附件走 `readAttachment` 转 blob URL、仅 path→路径卡片）。

## 运行与预览
- 开发：`pnpm install` -> `pnpm build`（先合并 presets，再 `tsc` + `build-client.mjs`）
- 类型检查：`pnpm typecheck`
- **非预览型项目**：client UI 依赖 DeepSeek Harness 宿主运行，无独立可预览前端；`.coze` 中 `preview_enable = "disabled"`，无 `[dev]`、无 `.preview`
- **不支持部署**：交付物是供宿主平台消费的 npm 插件库，node 半端无运行时行为，无 HTTP 服务/前端服务入口，Coze Deploy 无可支撑 profile，`.coze` 不写 `[deploy]`

## 用户偏好与长期约束
（暂无补充；后续迭代涉及的需求、禁忌在此沉淀）

## 常见问题和预防
- Agent Preset 定义会 eager mount：教师 Preset 只放身份与教学行为提示，宿主级插件必须由 web profile 宿主层统一加载，避免重复实例化
- 学习产物预览无法在本仓库本地验证（非预览型插件，产物数据在宿主运行时生成）：交付以 `pnpm build` + `pnpm typecheck` 通过为准，是否真能抽取/渲染出 html/视频需在宿主实机确认后反馈校准
- 学习产物抽取已改为**按会话事件结构定点抽取**，不做全字段递归扫描：产物只来自 `tool/result` / `assistant/message` 事件的 `data.message.content`（file/image 内容块）与 `tool/result.data.meta`（工具私有描述，宽容匹配 filename/path/url/html）。**注意 `SessionEvent` 结构是 `{ type, seq, time, data: {...} }`，产物在 `data.message` / `data.meta`，不在事件顶层**——曾误读顶层导致一直抽不到产物。
- **视频产物的真实形态（实测 session dump 确认）**：视频**不是** URL 也不是 file/image 内容块，而是通过两种方式引用宿主工作区绝对路径（如 `/home/sangfor/.../ComplexEquation.mp4`）：
  1. `assistant/message.message.content` 中 `{type:"text", text:"![复数方程讲解视频](</home/.../ComplexEquation.mp4>)"}`——**markdown 图片语法引用视频路径**，必须用 `markdownRefsFrom()` 解析 `!\[alt\]\(<path>\)` 才能拿到；
  2. `tool/call`（含 `assistant/message` 内的长度为 type：tool-call）的 `data.arguments` 是 JSON 字符串 `{"path": "/home/...mp4"}`，解析后命中 `path`。
  `tool/result.message.content` 只有 `"Registered xxx.mp4 (N bytes) for IM delivery..."` 文本，**不含路径**——不能从 result 拿视频。
- 宿主产物是**工作区绝对路径而非浏览器 URL，不能直接 `<video src>`/iframe 内联**：非 `http` 开头的一律只记 `path`，渲染为「在会话中打开」跳转卡片，用 `ctx.uiWorkspace?.openSession?.(sessionId)` 跳到宿主对应会话。
- 产物渲染优先走**附件服务**：`tool/result.message.content` 里 file/image 块的 `attachment`（`FileAttachmentRef`/`ImageAttachmentRef`）只有 `attachmentId`（内容寻址 id，**不是文件路径也不是 bearer URL**）+ `name`。通过 `SessionFace.readAttachment(attachmentId)` 读取字节，转成 blob URL 再渲染（video/image/html/file）。MIME 从附件 `mediaType`（image 有）或文件名扩展名推断。
- 宿主提供鉴权 `/api/file` 读端点，但真实参数名待实机确认。`path` 型产物仅定位（不直连渲染）。
- `sub_id`（`7aa83122`）创建后不可修改
- **远祖先遍历心智（防再次误扫）**：产物抽取仅允许走白名单路径 `data.message.content`（content blocks）与 `data.meta`；对字符串文本块的递归只查 `markdown 图片引用` + `内含 url/html/path/filename/name 的 JSON`。绝不递归整个 event 对象——曾把 `preset/mode/policy/inbox/replayState` 等会话元数据误当成产物列出。