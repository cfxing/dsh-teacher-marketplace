# dsh-teacher-marketplace

面向普通学生的 DeepSeek Harness 教师智能体产品层。

## 当前运行基线

本仓库按 **DeepSeek Harness 0.2.0-rc.2** 开发。

## 产品定位

用户不需要理解 Agent、Skill、插件或 Manim。进入「智能体」后直接看到教师卡片：

- AI学习老师
- AI 数学老师
- AI 物理老师

每位老师都可以「开始学习」；用户还可以把老师加入「我的智能体」。

## Preset 设计

本插件提供三个新版 Agent Preset，并保留一个旧会话兼容 Preset：

- `ai-teacher`
- `ai-math-teacher`
- `ai-physics-teacher`
- `study-tutor`（旧会话兼容，不在市场中重复展示）

Preset **只负责教师身份与教学行为提示**。不要把 `dsh-wrong-question`、`dshmath-manim` 等宿主级插件重复挂到每个 Preset。

原因是 Harness 0.2.x 的 Agent Preset 定义会 eager mount。重复挂载宿主级插件可能导致数据库、Web 路由和工具被创建多份。

因此：

- `dsh-wrong-question`：由 web profile 宿主层统一加载
- `dshmath-manim`：由 web profile 宿主层统一加载
- 教师 Preset：只提供教师人格与教学策略
- marketplace：只负责学生看到的教师市场 UI

## 开始学习

点击「开始学习」后插件：

1. 打开新的 DeepSeek Harness Session；
2. 等待空白 Session 出现；
3. 调用 Agent Preset 的选择接口；
4. 用户直接开始聊天。

学生不需要自己理解 Agent、Skill 或 Preset。

## 开发

```bash
pnpm install
pnpm build
```
