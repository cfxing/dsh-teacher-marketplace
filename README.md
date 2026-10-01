# dsh-teacher-marketplace

面向普通学生的 DeepSeek Harness 教师智能体产品层。

## 产品定位

用户不需要理解 Agent、Skill、插件或 Manim。进入「智能体」后直接看到教师卡片：

- AI 数学老师
- AI 物理老师

每位老师都可以「开始学习」；用户还可以把老师加入「我的智能体」。

## 页面结构

- 智能体广场
- 我的智能体
- 教师详情
- 添加 / 移除
- 开始学习

「我的智能体」与「智能体广场」属于同一个插件，不创建第二个 Agent 插件。

## Preset

本插件自带两个 Agent Preset 定义：

- `ai-math-teacher`
- `ai-physics-teacher`

它们使用当前项目中的：

- `dsh-wrong-question`：错题记忆、学习漏洞、举一反三数据
- `dshmath-manim`：学习动画

当前版本要求宿主环境已经安装这两个基础插件；若缺少其中一个，Preset 会显示为不可用，而 marketplace 页面仍可打开。

## 开始学习

点击「开始学习」后插件：

1. 打开新的 DeepSeek Harness Session；
2. 等待空白 Session 出现；
3. 调用 Agent Preset 的官方选择接口，把该 Session 切换到对应教师；
4. 用户直接开始聊天。

已有空白 Session 时会直接复用它，不要求用户自己去 Agent Preset 设置页切换。

## 开发

```bash
pnpm install
pnpm build
```
