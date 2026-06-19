# Project Map 插件设计文档

> 一个维护 CLAUDE.md 的 Claude 插件，自动扫描项目结构、更新地图信息，减少后续会话的 Token 消耗

## 1. 背景

### 1.1 问题

1. **Token 浪费**：Claude 新增功能时，缺乏上下文，需大量读文件理解项目结构。CLAUDE.md 可缓解，但手动维护易过时。
2. **架构越界**：Claude 不清楚项目架构约定（目录边界、命名规范、导入限制），新增功能可能违反既有架构设计。开发者需事后人工审查纠正。

### 1.2 目标

开发一个 Claude 插件，使其：

1. **自动维护地图**：项目结构变更时自动更新 CLAUDE.md，保持准确且精简（≤200 行）。
2. **强化架构约束**：从代码库自动提取架构规则（目录约定、命名规范、导入边界），写入 CLAUDE.md 供 Claude 遵循。
3. **检测架构偏移**：每次更新时对比当前结构与已有规则，发现偏移即告警。
4. **降低 Token 消耗**：后续对话无需重复探索项目结构。

### 1.3 成功指标

- CLAUDE.md 始终 ≤ 200 行
- 结构变更后 1 次交互内完成更新
- 新增功能时 Claude 读文件量减少 ≥ 200%
- Architecture Rules 覆盖项目核心目录（覆盖率 ≥ 80%）
- Rules 使用命令式语言且包含理由，可被 Claude 作为约束执行

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
    ├── 调用 MCP Tool: extract_arch_patterns
    │
    ▼
Claude 汇总 → 格式塔压缩 → 写入 CLAUDE.md
        │
        ▼
   架构变更检测（结构 vs 现有规则）
```

### 2.2 组件职责

| 组件 | 位置 | 职责 |
|------|------|------|
| MCP Server | `mcp/project-map-server/` | 4 个 tools（含 extract_arch_patterns），纯只读数据采集 |
| Skill | `.claude/skills/project-map.md` | 编排逻辑、汇总压缩、写入 |
| Slash Command | `.claude/commands/update-map.md` | 手动触发入口 |
| 配置 | `.claude/settings.json` | 注册 MCP Server |
| 目标文件 | `CLAUDE.md` | 自动维护的项目地图 |

### 2.3 设计原则

- **读写分离**：MCP Server 只读文件系统，不写任何内容；写入由 Skill 中的 Claude 使用内置 Write 工具完成
- **增量优先**：变更小时只更新变化部分，减少扫描开销
- **压缩优先**：Claude 必须主动压缩输出，确保 ≤ 200 行
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

#### 3.2.4 `extract_arch_patterns`

扫描源文件，分析目录结构、命名慣例、导入边界，生成架构规则。

```typescript
// 输入
{
  rootPath: string; // 项目根路径
}

// 输出
{
  dirPatterns: Array<{
    dir: string;              // 目录名（如 "src/components"）
    fileCount: number;        // 文件数
    naming: "PascalCase" | "camelCase" | "kebab-case" | "mixed" | "other";
    extensions: string[];     // 文件副档名列表
    importsFrom: string[];    // 导入来源目录
    importedBy: string[];     // 被哪些目录导入
    suggestedPurpose?: string; // 推斷用途（UI元件/工具/型別...）
  }>;
  rules: string[];  // 生成的架构规则（含理由）
}
```

实现方式：

1. 使用 fast-glob 匹配 `**/*.{ts,tsx,js,jsx}`（排除 node_modules/.git/dist/.claude）
2. 对每个文件：检测命名慣例（PascalCase / camelCase / kebab-case）+ 提取相对导入
3. 按目录分组，统计主导命名慣例
4. 构建导入关系图（谁导入谁）
5. 侦测异常导入（如 types 目录导入 components 目录）
6. 为每个目录生成命令式规则（含理由）

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
5. 调用 MCP extract_arch_patterns 获取架构规则
6. 架构变更检测：
   - 对比 scan_structure 结果与 CLAUDE.md 中的 Architecture Rules
   - 若结构无变化 → 跳过
   - 若检测到变化（文件移动/删除/新增目录）→ 输出警告
7. Claude 对比新旧数据
   - 变化 < 20% → 增量更新（只更新变化部分）
   - 变化 ≥ 20% → 全量重写
8. 压缩至 ≤ 200 行（含 Architecture Rules）
9. 写入 CLAUDE.md
10. 输出变更摘要（含架构规则条数）
```

### 4.3 压缩规则（关键约束）

```
总行数 ≤ 200 行（不含 frontmatter）
不包含：函数签名、import 语句、实现细节
只包含：其他 Claude 需要知道的「隐藏信息」
  → 目录结构、文件用途、架构约定、不明显的依赖
删除：明显的内容（"src/ 放源码"）、过时信息
Architecture Rules 命令式语言（必须/不得/只能/不应）
Architecture Rules 每条附理由（「理由：」）
```

### 4.4 输出格式

```markdown
# Project Map

_上次更新: 2026-06-19 | 架构版本: v1_

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

## Architecture Rules
- 页面路由 → `src/app/`，目录结构即路由结构。理由：Next.js App Router 约定式路由。
- UI 元件 → `src/components/`，PascalCase 命名。理由：React 元件标准惯例。
- 工具函数 → `src/lib/`，camelCase 命名，不包含 UI 逻辑。理由：与业务逻辑分离。

## Conventions
- Components: PascalCase, one per file
- CSS: Tailwind utility classes
```

### 4.5 检查清单

- [ ] 调用了 4 个 MCP Tool 获取数据
- [ ] 对比了新旧 CLAUDE.md
- [ ] 执行了压缩（≤ 200 行）
- [ ] 写入了 CLAUDE.md
- [ ] 输出了变更摘要

### 4.6 边界约束

- ☑ 不读取二进制文件（图片、视频、zip）
- ☑ 不修改非 CLAUDE.md 的文件
- ☑ 不执行任何 npm/build/test 命令
- ☑ 不访问外部网络
- ☑ 如果 MCP Server 返回错误，中止流程并报错
- ☑ 架构变更检测仅输出警告，不自动修改 Architecture Rules；需用户确认后才更新

### 4.7 架构变更检测

每次 `update-map` 执行时，自动检测当前实际结构 vs CLAUDE.md 记录的 Architecture Rules。

**检测流程：**

1. MCP `scan_structure` 返回当前目录树
2. Claude 对比现有 CLAUDE.md 中的 Architecture Rules
3. 若发现差异（目录新增/删除/重命名，文件类型变化），输出警告

**输出格式：**

```
⚠️ 检测到架构变更：
  • API 路由已从 src/app/api/ 移至 src/api/
  • 新目录 src/hooks/ 未在规则中覆盖
  更新 Architecture Rules？需用户确认。
```

**设计原则：**

- 不自动修改规则 → 防止误判
- 仅告警 + 提示用户确认 → 用户掌控架构决策
- 新增目录会建议增加规则，但需人工审阅

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
- **规则自动演进**：当用户确认架构变更后，自动更新 Architecture Rules 版本号
- **CI 集成**：在 CI pipeline 中运行 `extract_arch_patterns`，若检测到未授权的结构变更则阻断构建
