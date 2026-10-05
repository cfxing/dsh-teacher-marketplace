## 项目概述
面向普通学生的 DeepSeek Harness 教师智能体市场（插件）：学生进入「智能体」看到教师卡片（AI 数学老师、AI 物理老师），可「开始学习」，或把老师加入「我的智能体」。按 DeepSeek Harness 0.2.0-rc.2 开发。

## 技术栈
- Node.js（engines `^22.19.0 || >=24.0.0`）+ TypeScript（ESM，NodeNext），包管理器 pnpm
- `@deepseek-ai/cordis` 插件框架；React 18 渲染客户端 UI
- 产物编译到 `lib/`，作为 npm 包分发（`npm pack` / prepack）

## 目录结构
- `src/index.ts`：插件 Node 半端入口，**intentionally 无运行时行为**（`apply(_ctx)` 为空，仅占位）
- `src/client.tsx` + `src/client.css`：注入 DeepSeek Harness 宿主客户端的教师市场 UI 渲染层
- `scripts/build-client.mjs`：把 client UI 打包进管理层
- `cordis.patch.yml`：客户端 UI 与 Agent Preset 的组合配置清单（打包输入）

## 关键入口 / 核心模块
- 插件名 `dsh-teacher-marketplace`，`inject: []`
- 两个 Agent Preset：`ai-math-teacher`、`ai-physics-teacher`（只负责教师人格与教学策略，**不重复挂载** `dsh-wrong-question`、`dshmath-manim` 等宿主级插件，避免 Harness 0.2.x eager mount 导致 DB/路由/工具多份创建）
- 宿主级插件（`dsh-wrong-question`、`dshmath-manim`）由 web profile 宿主层统一加载

## 运行与预览
- 开发：`pnpm install` -> `pnpm build`（`tsc` + `build-client.mjs`）
- 类型检查：`pnpm typecheck`
- **非预览型项目**：client UI 依赖 DeepSeek Harness 宿主运行，无独立可预览前端；`.coze` 中 `preview_enable = "disabled"`，无 `[dev]`、无 `.preview`
- **不支持部署**：交付物是供宿主平台消费的 npm 插件库，node 半端无运行时行为，无 HTTP 服务/前端服务入口，Coze Deploy 无可支撑 profile，`.coze` 不写 `[deploy]`

## 用户偏好与长期约束
（暂无补充；后续迭代涉及的需求、禁忌在此沉淀）

## 常见问题和预防
- Agent Preset 定义会 eager mount：教师 Preset 只放身份与教学行为提示，宿主级插件必须由 web profile 宿主层统一加载，避免重复实例化
- `sub_id`（`7aa83122`）创建后不可修改