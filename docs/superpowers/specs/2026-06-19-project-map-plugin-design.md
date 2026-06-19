# Project Map 插件设计文档

> 一个维护 CLAUDE.md 的 Claude 插件，自动扫描项目结构、更新地图信息，减少后续会话的 Token 消耗

## 1. 背景

### 1.1 问题

Claude 在新增功能时，因缺乏上下文需要大量读取文件来理解项目结构，导致 Token 浪费。CLAUDE.md 可以缓解这个问题，但需要手动维护，容易过时。

### 1.2 目标

开发一个 Claude 插件，在项目结构变更时自动更新 CLAUDE.md，保持其准确且精简（≤50 行），降低后续会话的 Token 消耗。

### 1.3 成功指标

- CLAUDE.md 始终 ≤ 50 行
- 结构变更后 1 次交互内完成更新
- 新增功能时 Claude 读文件量减少 ≥ 50%

## 2. 架构

### 2.1 总体设计

```
用户触发 (/update-map 或 Skill 匹配)
    │
    ▼
Skill (project-map.md)
    │
    ├── 调用 MCP Tool: scan_structure
    ├── 调用 MCP Tool: analyze_key_files
    ├── 调用 MCP Tool: detect_stack
    │
    ▼
Claude 汇总 → 压缩 → 写入 CLAUDE.md
```

### 2.2 组件职责

| 组件 | 位置 | 职责 |
|------|------|------|
| MCP Server | `mcp/project-map-server/` | 3 个 tools，纯只读数据采集 |
| Skill | `.claude/skills/project-map.md` | 编排逻辑、汇总压缩、写入 |
| Slash Command | `.claude/commands/update-map.md` | 手动触发入口 |
| 配置 | `.claude/settings.json` | 注册 MCP Server |
| 目标文件 | `CLAUDE.md` | 自动维护的项目地图 |

### 2.3 设计原则

- **读写分离**：MCP Server 只读文件系统，不写任何内容；写入由 Skill 中的 Claude 使用内置 Write 工具完成
- **增量优先**：变更小时只更新变化部分，减少扫描开销
- **压缩优先**：Claude 必须主动压缩输出，确保 ≤ 50 行
- **声明式指令**：Skill 中描述「做什么」，MCP 做「数据采集」

## 3. MCP Server 设计

### 3.1 技术选型

- **语言**：TypeScript 5.x
- **运行时**：Node.js 18+
- **SDK**：`@modelcontextprotocol/sdk`
- **通信**：stdio（最简集成，无需端口）
- **构建**：`tsc` → CommonJS

### 3.2 Tool 接口

#### 3.2.1 `scan_structure`

扫描项目目录结构，返回树状 JSON。

```typescript
// 输入
{
  rootPath: string;           // 项目根路径
  maxDepth?: number;          // 默认 4，最大深度
  excludePatterns?: string[]; // 默认 ["node_modules", ".git", "dist", ".claude"]
}

// 输出
{
  tree: Array<{
    name: string;
    type: "file" | "dir";
    path: string;           // 相对路径
    size?: number;          // 文件字节数
    children?: TreeNode[];  // 仅 dir 有
  }>;
  fileCount: number;
  dirCount: number;
  totalSize: number;
}
```

实现方式：递归遍历目录，跳过 excludePatterns，按 maxDepth 截断。

#### 3.2.2 `analyze_key_files`

分析关键文件的用途。

```typescript
// 输入
{
  rootPath: string;
  globs?: string[];  // 默认 ["package.json", "tsconfig.json", "src/**/*.{ts,tsx}", "*.config.{js,ts}"]
}

// 输出
{
  files: Array<{
    path: string;
    size: number;
    firstLine?: string;        // 文件首行（通常是注释/指令）
    exports?: string[];        // 导出的符号名（简化提取）
    inferredPurpose?: string;  // 根据路径和内容推断的用途
  }>;
}
```

实现方式：使用 glob 匹配文件列表 → 读取每文件前 10 行 → 提取 exports/imports 模式 → 推断用途（基于路径命名规则和内容特征）。

#### 3.2.3 `detect_stack`

检测项目技术栈。

```typescript
// 输入
{
  rootPath: string;
}

// 输出
{
  language?: string;
  framework?: string;
  buildTool?: string;
  testFramework?: string;
  packageManager?: string;
  projectType: "app" | "library" | "monorepo" | "other";
  keyDependencies: Array<{ name: string; version: string; category: "framework" | "util" | "dev" }>;
  scripts: Record<string, string>;
}
```

实现方式：读取 package.json → 按已知关键词分类依赖（react/next/vue → framework; vitest/jest → test 等）→ 读取 tsconfig/eslint 配置文件辅助判断。

### 3.3 错误处理

- 路径不存在 → 返回 `{ error: "path_not_found", message: "..." }`
- 无权限读取 → 跳过该文件，在结果中标记 `skipped: true`
- 超大项目（>10000 文件）→ 只返回深度 2 的概要结构

## 4. Skill 设计

### 4.1 触发方式

- **手动**：用户输入 `/update-map` 或说出「更新项目地图」
- **自动**：后续通过 post-commit hook 扩展（方案 C 阶段）

### 4.2 执行流程

```
1. 读取当前 CLAUDE.md（如果有）
2. 调用 MCP scan_structure 获取目录树
3. 调用 MCP analyze_key_files 获取关键文件分析
4. 调用 MCP detect_stack 获取技术栈
5. Claude 对比新旧数据
   - 变化 < 20% → 增量更新（只更新变化部分）
   - 变化 ≥ 20% → 全量重写
6. 压缩至 ≤ 50 行
7. 写入 CLAUDE.md
8. 输出变更摘要给用户
```

### 4.3 压缩规则（关键约束）

```
总行数 ≤ 50 行（不含 frontmatter）
不包含：函数签名、import 语句、实现细节
只包含：其他 Claude 需要知道的「隐藏信息」
  → 目录结构、文件用途、架构约定、不明显的依赖
删除：明显的内容（"src/ 放源码"）、过时信息
```

### 4.4 输出格式

```markdown
# Project Map

## Tech Stack
- Framework: Next.js 14 (App Router)
- Language: TypeScript 5.3
- Build: Turbopack
- Test: Vitest

## Directory Structure
```
src/
├── app/          # App Router pages
├── components/   # Shared UI components
├── lib/          # Utilities
└── types/        # Type definitions
```

## Key Files
- `src/app/layout.tsx` — Root layout, providers
- `src/lib/api.ts` — API client

## Conventions
- Components: PascalCase, one per file
- CSS: Tailwind utility classes
```

### 4.5 检查清单

- [ ] 调用了 3 个 MCP Tool 获取数据
- [ ] 对比了新旧 CLAUDE.md
- [ ] 执行了压缩（≤ 50 行）
- [ ] 写入了 CLAUDE.md
- [ ] 输出了变更摘要

### 4.6 边界约束

- ☑ 不读取二进制文件（图片、视频、zip）
- ☑ 不修改非 CLAUDE.md 的文件
- ☑ 不执行任何 npm/build/test 命令
- ☑ 不访问外部网络
- ☑ 如果 MCP Server 返回错误，中止流程并报错

## 5. Slash Command 设计

```markdown
---
name: update-map
description: 更新/刷新项目结构地图 (CLAUDE.md)
---

执行 project-map Skill 更新 CLAUDE.md。

用法: /update-map          # 全量更新
      /update-map --quick  # 快速增量（只检上次写入后有变更的文件）
```

## 6. 项目文件结构

```
my_claude_plugin/
├── CLAUDE.md                              ← 目标文件（自动维护）
├── .claude/
│   ├── settings.json                      ← MCP Server 注册
│   ├── skills/
│   │   └── project-map.md                 ← Skill 编排
│   └── commands/
│       └── update-map.md                  ← 手动触发
├── mcp/
│   └── project-map-server/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts                   ← MCP Server 实现
├── docs/
│   ├── LEARN_CLAUDE_PLUGIN.md             ← 学习指南
│   └── superpowers/specs/                 ← 本设计文档
└── package.json
```

## 7. 未来扩展（方案 C 阶段）

- **Git hook**：post-commit 自动触发增量更新
- **Workflow 编排**：多 Agent 并行扫描，提升大型项目性能
- **缓存机制**：`.claude/memory/project-map/latest.json` 缓存上次扫描结果
- **CLAUDE.md 版本历史**：保留最近 3 个版本，可回滚
- **自定义压缩策略**：用户可通过配置指定 CLAUDE.md 包含/排除的节

## 8. 学习价值总结

| 知识点 | 在项目中如何体现 |
|--------|----------------|
| **MCP Server** | 独立 Node.js 进程，3 个 tool，stdio 通信 |
| **Tool Definition** | inputSchema + handler，JSON-RPC 协议 |
| **Skill 编排** | Skill 调用 MCP tools，做决策和写入 |
| **Slash Command** | `/update-map` 手动触发入口 |
| **压缩策略** | Claude 在 prompt 约束下自动精简输出 |
| **读写分离架构** | MCP 只读，Skill 用 Write tool 写入 |
