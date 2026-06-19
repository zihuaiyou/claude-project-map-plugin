---
name: project-map
description: 更新项目结构地图（CLAUDE.md），支持 git 增量扫描，压缩到 ≤200 行
---

# Project Map 技能

## 指令

当用户要求「更新项目地图」「刷新 CLAUDE.md」「同步项目结构」「update project map」时，执行以下流程。

此技能依赖 MCP Server `project-map`（已在 settings.json 中注册）。

## 执行模式

| 模式 | 触发条件 | 行为 |
|------|----------|------|
| 全量 | 默认（无 `--quick` / 无 `_git_ref`） | 完整扫描全部文件 |
| 增量 | CLAUDE.md 有 `_git_ref` | git diff 找出变更文件，只分析差异 |
| 快速 | `--quick` 且无 `_git_ref` | 目录树对比，结构无变则跳过 |
| 强制全量 | `--full` | 忽略 `_git_ref`，强制全量扫描 |

---

## 全量流程（默认 / `--full`）

```
1. 读取当前 CLAUDE.md（如果有）→ 了解当前状态
2. 获取当前 git HEAD: git rev-parse HEAD → headHash
3. 调用 MCP tool: scan_structure → 获取目录树
4. 调用 MCP tool: analyze_key_files → 获取文件用途
5. 调用 MCP tool: detect_stack → 获取技术栈
6. 调用 MCP tool: extract_arch_patterns → 获取架构规则
7. 汇总 → 压缩 → 写入 CLAUDE.md（含 _git_ref: headHash）
8. 输出变更摘要
```

## 增量流程（CLAUDE.md 存在 `_git_ref`）

```
1. 读取当前 CLAUDE.md → 提取 _git_ref 值（记为 gitRef）
2. 获取当前 git HEAD: git rev-parse HEAD → headHash
3. 如果 gitRef === headHash → 输出「自上次更新无新提交，跳过」
   （可选执行 --quick 的目录树对比兜底）
4. 执行 git diff {gitRef}..HEAD --name-only --diff-filter=ACMR
   → 新增/修改/重命名的文件列表（changedFiles）
5. 执行 git diff {gitRef}..HEAD --name-only --diff-filter=D
   → 已删除文件列表（deletedFiles）
6. 如果 changedFiles 和 deletedFiles 均为空：
   → 输出「无文件变更」→ 执行 scan_structure 检查目录树变化
   → 目录树无变化 → 更新 _git_ref 即可
   → 目录树有变化 → 只更新目录树部分
7. 有文件变更：
   7a. 调用 MCP tool: scan_structure → 获取最新目录树
   7b. 调用 MCP tool: analyze_key_files（filePaths = changedFiles）
   7c. 如果 package.json 在 changedFiles 中 → 调用 detect_stack
   7d. 如果目录结构有显著变化 → 调用 extract_arch_patterns
   7e. 合并旧 CLAUDE.md 内容 + 新文件信息：
       - changedFiles 中的文件 → 更新用途描述
       - deletedFiles 中的文件 → 从记录移除
       - 未变更的文件 → 保留原记录
   7f. 更新 _git_ref 为 headHash
8. 输出变更摘要
```

## 快速流程（`--quick`，无 `_git_ref`）

```
1. 读取当前 CLAUDE.md
2. 调用 MCP tool: scan_structure → 获取目录树
3. 与 CLAUDE.md 中的目录树对比
4. 如果结构无变化 → 输出「项目结构无变化，无需更新」
5. 如果有变化 → 只更新变化的部分，保留已知信息
```

---

## 步骤详解

### 步骤 1：读取当前 CLAUDE.md

使用 Read 工具读取项目根目录下的 `CLAUDE.md`。如果不存在，跳过此步。

如果存在，提取 frontmatter 中的 `_git_ref` 值（格式：`前端: {date} | 架构版本: {version} | _git_ref: {hash}`）。

### 步骤 2：获取当前 git HEAD

```bash
git rev-parse HEAD
```

保存输出为 `headHash`。

### 步骤 3：git diff 获取变更文件

```bash
# 新增/修改/重命名
git diff {gitRef}..HEAD --name-only --diff-filter=ACMR

# 已删除
git diff {gitRef}..HEAD --name-only --diff-filter=D
```

注意：如果 `git diff` 因为 ref 不存在而报错（如 rebase 后历史重写），回退到快速流程。

### 步骤 4-6：调用 MCP Tools

**scan_structure**
- `rootPath`: `{projectRoot}`
- `maxDepth`: 4
- `excludePatterns`: `["node_modules", ".git", "dist", ".claude"]`

**analyze_key_files（增量模式）**
- `rootPath`: `{projectRoot}`
- `filePaths`: `{changedFiles}`（增量模式传入具体文件路径）
- 当 `filePaths` 存在时，MCP 只分析这些文件，跳过 glob 匹配

**analyze_key_files（全量模式）**
- `rootPath`: `{projectRoot}`
- `globs`: `["package.json", "tsconfig.json", "src/**/*.{ts,tsx}", "*.config.{js,ts}"]`

**detect_stack**
- `rootPath`: `{projectRoot}`
- 增量模式下：仅当 package.json 在 changedFiles 中时调用

**extract_arch_patterns**
- `rootPath`: `{projectRoot}`
- 增量模式下：仅当目录结构有显著变化时调用

### 步骤 7：生成 CLAUDE.md

汇总数据，生成精简版 CLAUDE.md。

**增量合并规则：**
- 旧 CLAUDE.md 中未变更的文件用途 → 保留
- changedFiles 对应文件 → 使用新分析结果替换
- deletedFiles 对应文件 → 移除
- 目录树 → 使用最新 scan_structure 结果
- 技术栈 → 仅当重新检测时更新
- Architecture Rules → 仅当重新提取时更新
- 时间戳和 _git_ref → 更新

**格式要求：**

```markdown
# Project Map

_上次更新: {date} | 架构版本: {version} | _git_ref: {hash}_

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

### 步骤 8：写入 CLAUDE.md

使用 Write 工具将压缩后的内容写入项目根目录的 `CLAUDE.md`。

### 步骤 9：输出摘要

向用户展示变更摘要：

```markdown
✅ CLAUDE.md 已更新
- 模式: {全量|增量|快速}
- 技术栈: {framework} + {language}
- 目录: {dirCount} 个目录, {fileCount} 个文件
- 架构规则: {ruleCount} 条
- 变更: {新增/修改了 X 条信息}
- 行数: {N} 行 (≤200 ✅)
```

如果是增量模式，额外显示：
```markdown
- git diff: {changedCount} 文件变更, {deletedCount} 文件删除
- 扫描: 跳过 {skippedCount} 个未变更文件
```

如果是跳过模式：
```markdown
⏭️ CLAUDE.md 无需更新 — 自 _git_ref {shortHash} 起无变化
```

---

## 边界约束

- ☑ 不修改 CLAUDE.md 之外的任何文件
- ☑ 不执行 npm/build/test 命令
- ☑ 不访问外部 API 或网络
- ☑ 如果 MCP Server 返回错误，输出错误信息并中止
- ☑ 如果项目文件超过 2000 个，只扫描深度 2 的层次
- ☑ 行数超过 200 行必须继续压缩，直到 ≤ 200
- ☑ 如果 `git diff` 因 ref 不存在而失败（rebase 后），回退到快速流程
- ☑ 如果项目不是 git 仓库，回退到全量或快速流程
- ☑ 增量模式下不调用 extract_arch_patterns，除非目录结构有显著变化
