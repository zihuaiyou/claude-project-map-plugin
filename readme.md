# Project Map 插件设计文档

> 一个维护 CLAUDE.md 的 Claude 插件，自动扫描项目结构、增量更新地图信息，减少后续会话的 Token 消耗

## 1. 背景

### 1.1 问题

1. **Token 浪费**：Claude 新增功能时缺乏上下文，需大量读文件理解项目结构。CLAUDE.md 可缓解，但手动维护易过时。
2. **架构越界**：Claude 不清楚项目架构约定（目录边界、命名规范、导入限制），新增功能可能违反既有架构设计。开发者需事后人工审查纠正。
3. **全量扫描浪费**：旧方案每次更新都完整重扫全部文件，即使只改 1 个文件也跑满 4 个 MCP Tool，隐性 token 消耗大。

### 1.2 目标

开发一个 Claude 插件，使其：

1. **自动维护地图**：项目结构变更时自动更新 CLAUDE.md，保持准确且精简（≤200 行）。
2. **强化架构约束**：从代码库自动提取架构规则（目录约定、命名规范、导入边界），写入 CLAUDE.md 供 Claude 遵循。
3. **增量优先**：利用 git 历史精准定位变更文件，只分析差异，跳过未变部分，节省 80-97% token。
4. **检测架构偏移**：每次更新时对比当前结构与已有规则，发现偏移即告警。
5. **降低 Token 消耗**：后续对话无需重复探索项目结构。

### 1.3 成功指标

- CLAUDE.md 始终 ≤ 200 行
- 结构变更后 1 次交互内完成更新
- 新增功能时 Claude 读文件量减少 ≥ 200%
- 增量模式跳过未变更文件的 token 节省 ≥ 80%
- Architecture Rules 覆盖项目核心目录（覆盖率 ≥ 80%）
- Rules 使用命令式语言且包含理由，可被 Claude 作为约束执行
- `_git_ref` 写回准确率 100%，rebase 后自动降级到目录树对比

## 2. 架构

### 2.1 总体设计

```
用户触发 (/update-map 或 Skill 匹配)
    │
    ▼
Skill (project-map.md)
    │
    ├── [有 _git_ref] → git diff ref..HEAD → 增量扫描
    │     只分析变更文件，跳过 extract_arch_patterns
    │
    ├── [无 _git_ref] → 全量扫描
    │     scan_structure + analyze_key_files (全量)
    │     + detect_stack + extract_arch_patterns
    │
    ├── [--quick 且无 _git_ref] → 目录树对比
    │     结构无变则跳过
    │
    ▼
Claude 汇总 → 格式塔压缩 → 写入 CLAUDE.md（含 _git_ref）
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

分析关键文件的用途。支持两种模式：全量（glob 匹配）和增量（指定文件路径）。

```typescript
// 输入
{
  rootPath: string;
  globs?: string[];     // 全量模式：默认 ["package.json", "tsconfig.json", "src/**/*.{ts,tsx}", "*.config.{js,ts}"]
  filePaths?: string[]; // 增量模式：指定相对路径列表，覆盖 globs。跳过不存在的文件。
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

实现方式：`filePaths` 优先 → 直接读取指定文件；否则按 glob 匹配 → 读取每文件前 10 行 → 提取 exports/imports 模式 → 推断用途（基于路径命名规则和内容特征）。最多处理 200 个文件。

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

#### 增量模式（CLAUDE.md 有 `_git_ref`）

```
1. 读取当前 CLAUDE.md → 提取 _git_ref
2. git rev-parse HEAD → headHash
3. git diff {_git_ref}..HEAD --name-only --diff-filter=ACMR → changedFiles
   git diff {_git_ref}..HEAD --name-only --diff-filter=D → deletedFiles
4. 无文件变更 → 仅 scan_structure 检查目录树 → 仍无变则跳過
5. 有文件变更：
   a. scan_structure → 取最新目录树
   b. analyze_key_files(filePaths=changedFiles) → 只分析变动文件
   c. 如 package.json 在 changedFiles 中 → 调 detect_stack
   d. 如目录结构显著变化 → 调 extract_arch_patterns
6. Claude 合并新旧数据：
   - changedFiles → 更新对应条目
   - deletedFiles → 移除条目
   - 未变文件 → 保留原记录
7. 压缩至 ≤ 200 行
8. 写入 CLAUDE.md（_git_ref 更新为 HEAD）
9. 输出变更摘要
```

#### 全量模式（默认 / `--full`）

```
1. 读取当前 CLAUDE.md（如果有）
2. headHash = git rev-parse HEAD
3. 调用 MCP scan_structure → 目录树
4. 调用 MCP analyze_key_files → 全量文件分析
5. 调用 MCP detect_stack → 技术栈
6. 调用 MCP extract_arch_patterns → 架构规则
7. 架构变更检测（结构 vs 现有规则）
8. 压缩至 ≤ 200 行
9. 写入 CLAUDE.md（含 _git_ref: headHash）
10. 输出变更摘要
```

#### 快速模式（`--quick`，无 `_git_ref`）

```
1. 读取当前 CLAUDE.md
2. scan_structure → 目录树
3. 对比目录树 → 无变化则跳过
4. 有变化 → 只更新变化部分
```

#### 回退策略

| 场景 | 行为 |
|------|------|
| `_git_ref` 指向的 commit 不存在（rebase 后） | 降级到快速模式（目录树对比） |
| 项目不是 git 仓库 | 降级到全量或快速模式 |
| `git diff` 执行失败 | 降级到快速模式 |

### 4.3 压缩规则（关键约束）

```
总行数 ≤ 200 行（不含 frontmatter）
不包含：函数签名、import 语句、实现细节
只包含：其他 Claude 需要知道的「隐藏信息」
  → 目录结构、文件用途、架构约定、不明显的依赖
删除：明显的内容（"src/ 放源码"）、过时信息
Architecture Rules 命令式语言（必须/不得/只能/不应）
Architecture Rules 每条附理由（「理由：」）
CLAUDE.md frontmatter 包含 _git_ref: {commit_hash} 供增量扫描使用
```

### 4.4 输出格式

```markdown
# Project Map

_上次更新: 2026-06-19 | 架构版本: v1 | _git_ref: a1b2c3d_

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

**全量模式：**
- [ ] 调用了 4 个 MCP Tool 获取数据
- [ ] 对比了新旧 CLAUDE.md
- [ ] 执行了压缩（≤ 200 行）
- [ ] 写入了 CLAUDE.md（含 _git_ref）
- [ ] 输出了变更摘要

**增量模式（附加）：**
- [ ] 读取并提取了 CLAUDE.md 中的 _git_ref
- [ ] 执行了 git diff 获取变更文件列表
- [ ] 只对变更文件调用了 analyze_key_files(filePaths=...)
- [ ] 仅当 package.json 变更时调用 detect_stack
- [ ] 仅当目录结构显著变化时调用 extract_arch_patterns
- [ ] 正确合并：更新变更条目 + 移除已删条目 + 保留未变条目
- [ ] 更新了 _git_ref 为当前 HEAD
- [ ] 输出了增量变更摘要（含跳过的文件数）

### 4.6 边界约束

- ☑ 不读取二进制文件（图片、视频、zip）
- ☑ 不修改非 CLAUDE.md 的文件
- ☑ 不执行任何 npm/build/test 命令
- ☑ 不访问外部网络
- ☑ 如果 MCP Server 返回错误，中止流程并报错
- ☑ 架构变更检测仅输出警告，不自动修改 Architecture Rules；需用户确认后才更新
- ☑ 增量模式下如果 `git diff` 因 ref 不存在报错（rebase 后），静默降级到目录树对比
- ☑ 如果项目不是 git 仓库，跳过增量模式降级到全量或快速模式

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

用法: /update-map          # 智能模式：有 _git_ref 则增量，否则全量
      /update-map --full   # 强制全量扫描（忽略 _git_ref）
      /update-map --quick  # 快速增量（目录树对比，无变化则跳过）
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
