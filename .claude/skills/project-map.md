---
name: project-map
description: 更新项目结构地图（CLAUDE.md），扫描目录、分析文件用途、检测技术栈，压缩到 ≤200 行
---

# Project Map 技能

## 指令

当用户要求「更新项目地图」「刷新 CLAUDE.md」「同步项目结构」「update project map」时，执行以下流程。

此技能依赖 MCP Server `project-map`（已在 settings.json 中注册）。

### 流程

```
1. 读取当前 CLAUDE.md（如果有）→ 了解当前状态
2. 调用 MCP tool: scan_structure → 获取目录树
3. 调用 MCP tool: analyze_key_files → 获取文件用途
4. 调用 MCP tool: detect_stack → 获取技术栈
5. 调用 MCP tool: extract_arch_patterns → 获取架构规则
6. 架构变更检测：对比当前结构与 CLAUDE.md 中的 Architecture Rules
   6a. 若结构无变化 → 跳过
   6b. 若有变化（文件移动/删除/新增目录）→ 输出警告并提示更新规则
7. 汇总 → 压缩 → 写入 CLAUDE.md（含 Architecture Rules）
8. 输出变更摘要
```

### 步骤 1：读取当前 CLAUDE.md

使用 Read 工具读取项目根目录下的 `CLAUDE.md`。如果不存在，跳过此步。

### 步骤 2-4：调用 MCP Tools

使用以下 MCP Tool 来获取数据：

**scan_structure**
- `rootPath`: `{projectRoot}`（从 Read 文件获取的工作目录）
- `maxDepth`: 4
- `excludePatterns`: `["node_modules", ".git", "dist", ".claude"]`

**analyze_key_files**
- `rootPath`: `{projectRoot}`
- `globs`: `["package.json", "tsconfig.json", "src/**/*.{ts,tsx}", "*.config.{js,ts}"]`

**detect_stack**
- `rootPath`: `{projectRoot}`

### 步骤 5：生成 CLAUDE.md

汇总三个 MCP Tool 的返回数据，生成精简版 CLAUDE.md。

**格式要求：**

```markdown
# Project Map

_上次更新: {date} | 架构版本: {version}_

## Tech Stack
- Framework: {framework}
- Language: {language}
- Build: {buildTool}
- Test: {testFramework}
- PM: {packageManager}

## Directory Structure
```
{精简目录树 — 只保留有意义的目录和文件}
```

## Key Files
- {path} — {purpose}

## Architecture Rules
- {rule}。理由：{reason}。
- {rule}。理由：{reason}。

## Conventions
{从文件分析中推断的命名/架构约定}
```

**压缩规则（必须遵守）：**

1. 总行数 ≤ 200 行（不含 frontmatter 行 `---` 或 `# Project Map` 标题）
2. 不包含：函数签名、import 语句、实现细节、注释
3. 只包含：其他 Claude 需要知道的「隐藏信息」
   — 目录结构、文件用途、架构约定、不明显的依赖关系
4. 删除：明显的内容（如 "src/ 放源码"）、过时信息
5. 目录树只展示深度 ≤ 3 的关键目录，省略空目录
6. Key Files 只保留最重要的 6 个文件
7. Conventions 最多 4 条
8. Architecture Rules 必须包含理由（「理由：」），每条规则需有依据
9. Architecture Rules 使用命令式语言（必须/不得/只能/不应），非描述性语言

### 步骤 6：写入 CLAUDE.md

使用 Write 工具将压缩后的内容写入项目根目录的 `CLAUDE.md`。

### 步骤 7：输出摘要

向用户展示变更摘要：

```markdown
✅ CLAUDE.md 已更新
- 技术栈: {framework} + {language}
- 目录: {dirCount} 个目录, {fileCount} 个文件
- 架构规则: {ruleCount} 条
- 变更: {新增/修改了 X 条信息}
- 行数: {N} 行 (≤200 ✅)
```

## 检查清单

- [ ] 读取了当前 CLAUDE.md（如存在）
- [ ] 调用了 scan_structure 获取目录树
- [ ] 调用了 analyze_key_files 获取文件用途
- [ ] 调用了 detect_stack 获取技术栈
- [ ] 调用了 extract_arch_patterns 获取架构规则
- [ ] 所有 MCP 返回有效数据（非空、无错误）
- [ ] 架构变更检测：结构 vs 现有 CLAUDE.md 规则（如无变化则跳过）
- [ ] 内容压缩到 ≤ 200 行
- [ ] Architecture Rules 包含理由，使用命令式语言
- [ ] 写入了 CLAUDE.md
- [ ] 输出了变更摘要

## 工具使用规范

| 工具 | 用途 | 约束 |
|------|------|------|
| `Read` | 读取当前 CLAUDE.md | 只读，不修改 |
| `Write` | 写入新 CLAUDE.md | 只写 CLAUDE.md，不改其他文件 |
| MCP `scan_structure` | 获取目录树 | 只读，纯数据采集 |
| MCP `analyze_key_files` | 获取文件用途 | 只读，纯数据采集 |
| MCP `detect_stack` | 获取技术栈 | 只读，纯数据采集 |
| MCP `extract_arch_patterns` | 获取架构规则 | 只读，纯数据采集 |

## 边界约束

- ☑ 不修改 CLAUDE.md 之外的任何文件
- ☑ 不执行 npm/build/test 命令
- ☑ 不访问外部 API 或网络
- ☑ 如果 MCP Server 返回错误，输出错误信息并中止
- ☑ 如果项目文件超过 2000 个，只扫描深度 2 的层次
- ☑ 行数超过 200 行必须继续压缩，直到 ≤ 200
- ☑ 架构变更检测仅输出警告，不自动修改 Architecture Rules；需用户确认后才更新
