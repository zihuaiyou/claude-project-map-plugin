# Claude 插件开发学习指南

> 面向经验丰富的前端工程师，从零到一掌握 Claude 插件开发

---

## 目录

1. [什么是 Claude 插件](#1-什么是-claude-插件)
2. [能做什么](#2-能做什么)
3. [生态概览](#3-生态概览)
4. [核心概念与原理](#4-核心概念与原理)
5. [学习路线](#5-学习路线)
6. [推荐资源](#6-推荐资源)
7. [常见问题](#7-常见问题)

---

## 1. 什么是 Claude 插件

### 1.1 定义

Claude 插件是一种扩展机制，允许开发者给 Claude（Anthropic 的 AI 助手）添加自定义能力。插件本质上是**一组指令 + 工具**，让 Claude 能执行原本做不到的事情——比如操作文件、运行命令、调用 API、查询数据库。

### 1.2 不是什么

不要和以下概念混淆：

| 概念 | 区别 |
|------|------|
| **Chrome 扩展** | Claude 插件不是浏览器扩展，不操作 DOM/页面 |
| **VS Code 扩展** | Claude 插件不是编辑器插件，虽然可以在 VS Code 中运行 |
| **ChatGPT Plugin** | Claude 的插件体系完全不同，基于 tools/MCP，不是 OpenAI 的 plugin 协议 |
| **npm 包** | 插件是配置/脚本组合，不一定需要发布到 npm |

### 1.3 插件的存在形式

Claude 插件目前主要通过两种方式存在：

1. **Slash Commands（斜杠命令）** — 用户输入 `/xxx` 触发，执行预定义的 prompt 或脚本
2. **Skills（技能）** — 更复杂的扩展，包含完整指令、工具调用、多步骤工作流
3. **MCP Servers（Model Context Protocol）** — 独立的服务进程，通过标准协议给 Claude 提供工具和资源

---

## 2. 能做什么

### 2.1 典型能力

- **代码操作**：搜索、读取、编辑、重构代码
- **命令行执行**：运行构建、测试、部署命令
- **API 调用**：访问第三方服务（GitHub、Jira、Slack 等）
- **文件管理**：创建、修改、组织项目文件
- **信息检索**：查文档、搜代码、分析日志
- **自动化工作流**：多步骤任务编排（如 CI/CD 流水线）
- **自定义交互**：轮询、定时任务、状态监控

### 2.2 现实场景举例

| 场景 | 插件做的事情 |
|------|-------------|
| 代码审查 | 读取 diff → 逐文件审查 → 生成审查报告 → 发布 PR 评论 |
| 自动修复 | 运行 lint → 分析错误 → 逐条修复 → 验证 |
| 部署管理 | 构建 → 运行测试 → 推送 → 通知状态 |
| 文档生成 | 扫描代码 → 提取 API 签名 → 生成 markdown |
| 重构迁移 | 识别模式 → 批量替换 → 验证一致性 |

### 2.3 能力边界

- **无 GUI**：插件没有 UI，通过文本交互
- **依赖宿主环境**：能力受限于运行环境（CLI/IDE/Web）的权限
- **需用户授权**：敏感操作需要用户确认
- **有上下文限制**：受 Claude 上下文窗口大小影响（200K tokens）

---

## 3. 生态概览

### 3.1 运行环境

```
Claude Plugin Ecosystem
├── Claude Code (CLI)         ← 最完整的插件能力
│   ├── Slash Commands
│   ├── Skills
│   ├── MCP Servers
│   └── Hooks (git hooks)
│
├── Claude Desktop App
│   └── MCP Servers (主要扩展方式)
│
├── VS Code / JetBrains 扩展
│   ├── 内嵌 Claude Code
│   └── 共享 Skills/Commands
│
└── claude.ai (Web)
    └── MCP Servers (有限支持)
```

### 3.2 三种插件形式对比

| 特性 | Slash Command | Skill | MCP Server |
|------|:---:|:---:|:---:|
| 复杂度 | 低 | 中 | 高 |
| 代码量 | 几行 prompt | 数千行 markdown | 独立项目 |
| 有状态 | ❌ | ✅ (通过文件) | ✅ |
| 多步骤 | ❌ | ✅ | ✅ |
| 外部进程 | ❌ | ❌ (CLI 调用) | ✅ (独立服务) |
| 可复用性 | 项目内 | 项目内/全局 | 跨项目 |
| 调试难度 | 简单 | 中等 | 复杂 |
| 适用场景 | 快捷操作 | 复杂工作流 | 工具/数据服务 |

### 3.3 关键术语

| 术语 | 含义 |
|------|------|
| **Tool** | Claude 可以调用的函数（如 Read、Write、Bash） |
| **Skill** | 一组指令 + 工作流定义，是插件的核心载体 |
| **Slash Command** | 用户触发的快捷命令 (`/command`) |
| **MCP** | Model Context Protocol，标准化的工具通信协议 |
| **Hook** | 事件触发机制（git hooks、消息钩子） |
| **Workflow** | 多 agent 编排脚本，用于大规模任务 |
| **Subagent** | 由主 Claude 派生的子会话，处理独立子任务 |

---

## 4. 核心概念与原理

### 4.1 插件如何工作

```
用户输入 → Claude 理解意图 → 匹配插件 → 执行插件指令
                ↓
        调用 Tool (Read/Write/Bash/...)
                ↓
        返回结果给 Claude 分析
                ↓
        继续或完成（可循环）
```

**关键点**：插件不是主动运行的，而是嵌入在 Claude 的推理-行动循环中。Claude 根据用户请求和插件指令决定何时调用工具。

### 4.2 Skill 的结构

一个 Skill 是一个 markdown 文件，包含：

```markdown
---
name: my-skill
description: 技能描述（用于匹配用户意图）
---

## 指令

这里写技能的核心行为逻辑...

## 检查清单

- [ ] 步骤 1
- [ ] 步骤 2

## 工具使用规范

描述何时使用什么工具，有什么限制...
```

**执行流程**：

1. 用户输入匹配到 skill 的 `description` 关键词
2. Skill 被注入到系统提示中
3. Skill 中的指令被 Claude 遵守执行
4. Skill 可以调用各种 Tools
5. 完成后 Skill 从提示中移除

### 4.3 Slash Command 的结构

比 Skill 更简单，通常是一个 markdown 文件：

```markdown
---
name: my-command
description: 命令描述
---

执行以下操作：
1. 读取当前目录下的所有文件
2. 生成目录结构报告
3. 输出结果
```

### 4.4 MCP 架构（进阶）

```
Claude ←→ MCP Client ←→ MCP Server
                            ├── Tools (callable by Claude)
                            ├── Resources (data Claude can read)
                            └── Prompts (templates)
```

MCP Server 是一个独立进程，通过 stdio 或 HTTP 与 Claude 通信。它声明自己提供哪些工具，Claude 可以动态调用。

### 4.5 插件的四大要素

```
┌──────────────────────────────────────┐
│             Claude 插件               │
├──────────────────────────────────────┤
│  1. 触发条件（何时激活）               │
│     - 关键词匹配 / 用户输入 / 事件     │
│                                       │
│  2. 指令集（做什么）                   │
│     - 行为规则 / 步骤 / 边界约束       │
│                                       │
│  3. 工具集（用什么做）                 │
│     - 内置工具 + 自定义 MCP 工具        │
│                                       │
│  4. 输出格式（如何呈现）               │
│     - markdown / code block / 结构化   │
└──────────────────────────────────────┘
```

### 4.6 关键设计原则

1. **声明式指令**：告诉 Claude「做什么」，而不是「怎么做每一步」
2. **检查清单**：确保关键步骤不被遗漏
3. **边界定义**：明确什么能做、什么不能做，防止 Claude 过度发挥
4. **渐进式执行**：复杂任务拆解为多个子步骤，每一步验证后再继续
5. **防御性设计**：考虑错误路径、权限不足、上下文溢出

---

## 5. 学习路线

### 阶段 0：前置知识（你已具备 ✅）

作为前端工程师，你已掌握：

- ✅ JavaScript/TypeScript — 插件的核心语言
- ✅ JSON/YAML — 配置格式
- ✅ Git — 版本控制
- ✅ 命令行基础 — Node.js/npm 等
- ✅ API 设计思维 — REST/GraphQL
- ✅ Markdown — 文档格式

### 阶段 1：掌握 Claude Code 基础（1-2 天）

| 目标 | 内容 |
|------|------|
| 安装配置 | 安装 Claude Code，了解基本命令 |
| 核心交互 | `/help`, `/clear`, `/tasks` 等内置命令 |
| 工具系统 | 观察 Claude 调用 Read/Write/Edit/Bash/Grep |
| 上下文理解 | 理解 system prompt、user prompt、tool result 的流转 |

**实战练习**：
```bash
# 安装 Claude Code
npm install -g @anthropic-ai/claude-code

# 在项目中初始化
cd your-project
claude

# 体验核心交互
/tasks     # 查看后台任务
/help      # 查看所有命令
```

### 阶段 2：编写第一个 Skill（2-3 天）

学习路径：

1. **理解 Skill 文件结构**：metadata、指令、检查清单
2. **创建项目级 Skill**：在 `.claude/skills/` 下创建
3. **编写简单 Skill**：
   - 文件读取报告器
   - 代码统计工具
   - 项目结构分析器
4. **理解触发机制**：description 如何匹配用户意图
5. **调试与优化**：通过对话日志检查 Skill 执行情况

**示例 - 一个简单的代码统计 Skill**：

```markdown
---
name: code-stats
description: 统计当前项目的代码行数，按文件类型分组
---

## 统计项目代码

1. 运行 `cloc` 或 `find` 统计各类型文件的行数
2. 按文件类型分组展示
3. 标记大文件（>500行）

## 约束

- 排除 node_modules, .git, dist 目录
- 只统计 .ts, .tsx, .js, .jsx, .css, .md 文件
```

### 阶段 3：Slash Commands（1-2 天）

1. **理解 Command 与 Skill 的区别**
2. **创建 `.claude/commands/` 下的命令**
3. **参数传递**：`/command arg1 arg2`
4. **与 Skill 组合使用**

### 阶段 4：高级 Skill 开发（3-5 天）

| 主题 | 内容 |
|------|------|
| Agent 调用 | 使用 `Agent` tool 派生子任务 |
| 工作流编排 | `pipeline()` / `parallel()` 多 agent 模式 |
| Workflow 脚本 | JavaScript 编排脚本，控制多 agent 协作 |
| 文件记忆 | 利用 `.claude/` 目录持久化状态 |
| Cron 定时任务 | 轮询、定时检查、周期任务 |
| 背景任务 | 长时运行任务管理 |

**核心模式 - 多 Agent 协作**：

```
用户请求
    │
    ▼
主 Claude 解析意图
    │
    ├── Agent 1：搜索代码（只读）
    ├── Agent 2：分析模式（只读）
    ├── Agent 3：审查风险（只读）
    │
    ▼
汇总 → 制定方案 → 执行修改 → 验证
```

### 阶段 5：MCP Server 开发（5-7 天）

这是真正发挥全栈能力的阶段：

1. **理解 MCP 协议**：
   - [MCP 规范](https://modelcontextprotocol.io)
   - Tools / Resources / Prompts 三种原语
   - JSON-RPC 通信

2. **实现第一个 MCP Server**：
   ```typescript
   import { Server } from "@modelcontextprotocol/sdk";

   const server = new Server({
     name: "my-server",
     version: "1.0.0",
   });

   server.setRequestHandler("tools/list", async () => ({
     tools: [
       {
         name: "my_tool",
         description: "工具描述",
         inputSchema: {
           type: "object",
           properties: { ... },
         },
       },
     ],
   }));
   ```

3. **集成到 Claude**：配置 `claude.json` 或 `settings.json`

4. **进阶 MCP**：
   - 有状态服务
   - 连接外部 API
   - 资源订阅/通知
   - 错误处理与重试

### 阶段 6：实战项目（持续）

构建真实可用的插件，推荐顺序：

| 项目 | 难度 | 技术点 |
|------|:----:|--------|
| 代码审查助手 | ⭐⭐ | Skill + Agent |
| 自动文档生成器 | ⭐⭐ | Skill + MCP |
| 项目脚手架工具 | ⭐⭐⭐ | Slash Command + Skill |
| CI/CD 状态监控 | ⭐⭐⭐ | MCP + Cron |
| 多 Agent 重构工具 | ⭐⭐⭐⭐ | Workflow |
| 自定义代码分析器 | ⭐⭐⭐⭐ | MCP Server |
| 全自动 PR 管理器 | ⭐⭐⭐⭐⭐ | Workflow + MCP + GitHub API |

---

## 6. 推荐资源

### 官方文档

- [Claude Code 官方文档](https://docs.anthropic.com/en/docs/claude-code/overview)
- [MCP 协议文档](https://modelcontextprotocol.io)
- [Anthropic API 文档](https://docs.anthropic.com/en/docs)

### 关键参考资料

- `CLAUDE.md` 和 `GEMINI.md` — 项目级指令文件格式
- `.claude/settings.json` — 插件配置
- `.claude/skills/` 目录下的所有 `.md` 文件 — 学习范例的最佳来源

### 学习项目

- 翻阅 Claude Code 自动生成的项目 `.claude/` 目录
- 阅读开源 MCP Server：[GitHub 上的 MCP Servers](https://github.com/modelcontextprotocol/servers)
- 本仓库下的 skills 目录就是现成学习材料

---

## 7. 常见问题

### Q：Skill 和 MCP Server 怎么选？

**选 Skill 当**：任务逻辑简单、只在本项目使用、不需要持久化服务
**选 MCP 当**：需要独立服务、要跨项目复用、提供通用工具/数据源

### Q：插件开发需要后端能力吗？

MCP Server 需要（Node.js/TypeScript 即可）。Skill 和 Command 不需要——纯 prompt 工程。

### Q：插件可以发布分享吗？

目前主要通过配置文件分享（分享 `.claude/` 目录），无官方市场。MCP Server 可以发布到 npm/GitHub。

### Q：前端工程师做插件开发的优势？

1. TypeScript 是 MCP 的一等公民
2. 理解异步、事件驱动、JSON 等核心概念
3. 前端工具链经验（构建、调试、测试）直接可用
4. 项目管理经验有助于设计好的插件交互

### Q：调试插件的最佳方式？

1. **查看对话日志**：观察 Claude 如何理解你的指令
2. **迭代 prompt**：微调 instruction 描述
3. **分步测试**：先测工具调用，再测完整流程
4. **使用 `/tasks`**：监控后台任务状态

---

> **下一步建议**：从阅读 `.claude/skills/` 下的现有 skill 文件开始，理解它们的结构和模式，然后尝试创建你自己的第一个 skill。
