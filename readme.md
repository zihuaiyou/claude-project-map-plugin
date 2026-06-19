# Project Map — CLAUDE.md 自动维护插件

> Claude 每次对话自动读 CLAUDE.md 了解项目结构，省去重新探索的 token。但手动维护易过时。  
> 这个插件自动扫描项目、检测变更、增量更新 CLAUDE.md，始终 ≤ 200 行。

---

## 核心设计

### 1. 三层系统

```
用户指令 (/update-map)
  → Skill 编排逻辑          (.claude/skills/project-map.md)
    → MCP Server 只读采集   (mcp/project-map-server/src/index.ts)
      → CLAUDE.md 输出      (项目根目录，≤200 行)
```

| 层 | 职责 | 写文件？ |
|----|------|---------|
| **MCP Server** (TypeScript) | 4 个 tool：扫目录、分析文件、检测技术栈、提取架构规则 | ❌ 只读 |
| **Skill** (Markdown 指令) | 编排流程、合并数据、压缩内容 | ✅ 写 CLAUDE.md |
| **Command** (`/update-map`) | 手动触发入口 | - |

### 2. 三种执行模式

```
/update-map        智能模式（有 _git_ref 则增量，否则全量）
/update-map --full 强制全量
/update-map --quick 快速（目录树对比，无变化跳过）
```

#### 增量模式（省 token 的关键）

```
CLAUDE.md 存 _git_ref = a1b2c3d
  → git diff a1b2c3d..HEAD --name-only
  → 拿到变更文件列表
  → 只分析这 N 个文件（跳过其余）
  → 更新 CLAUDE.md + 写回新 HEAD hash
```

**省多少：** 100 文件项目改 5 个 → 跳读 95 个 → ~97% token 节省。

**回退安全：** rebase 后 ref 不存在 → 静默降级到目录树对比。不是 git 仓库 → 降级到全量。

### 3. 分级输出（按项目规模自适应）

`scan_structure` 返回 `fileCount` → 自动选模板：

| 级别 | 文件数 | Key Files | 目录树 | 适用场景 |
|------|--------|-----------|--------|---------|
| **小型** | <200 | 列举 6 个最重要文件 | 深度 ≤ 3 | 当前项目（~80 文件） |
| **中型** | 200-1000 | 按目录分组摘要 | 深度 ≤ 2 | 中大型应用 |
| **大型** | >1000 | 不设此节 | 深度 ≤ 1，仅顶层 | monorepo |

大项目自动跳过 `extract_arch_patterns`（架构规则从目录结构推断，不扫描导入图）。

### 4. 架构变更检测

每次更新时自动比对新目录树 vs CLAUDE.md 记录的规则：

```
⚠️ 检测到架构变更：
  • API 路由从 src/app/api/ 移至 src/api/
  • 新目录 src/hooks/ 未在规则中覆盖
```

**原则：** 仅告警，不自动改规则。用户确认后才更新。

---

## MCP Server 工具

| 工具 | 输入 | 输出 | 调用时机 |
|------|------|------|---------|
| `scan_structure` | rootPath, maxDepth, excludePatterns | 目录树 + fileCount | 每次必调 |
| `analyze_key_files` | rootPath + globs **或** filePaths | 每文件 path/size/exports/用途 | 全量用 globs，增量用 filePaths |
| `detect_stack` | rootPath | 语言/框架/构建工具/PM | 全量调 / 增量仅 package.json 变更时 |
| `extract_arch_patterns` | rootPath | 目录命名惯例 + 导入关系 + 规则 | 仅全量或目录结构显著变化 |

---

## 压缩约束（必须遵守）

- CLAUDE.md 总行数 ≤ 200 行
- 不包含：函数签名、import 语句、实现细节
- 只包含：Claude 需要知道的隐藏信息（结构、用途、约定、不明显的依赖）
- Architecture Rules：命令式语言 + 每条附理由
- frontmatter 包含 `_git_ref: {commit_hash}`

---

## 项目文件

```
my_claude_plugin/
├── CLAUDE.md                              ← 输出目标（自动维护）
├── .claude/
│   ├── settings.json                      ← MCP Server 注册
│   ├── skills/project-map.md              ← Skill 编排逻辑
│   └── commands/update-map.md             ← 手动触发命令
├── mcp/project-map-server/
│   ├── src/index.ts                       ← MCP Server（4 tools）
│   ├── package.json
│   └── tsconfig.json
└── docs/
    ├── LEARN_CLAUDE_PLUGIN.md
    └── superpowers/specs/                 ← 设计文档
```

---

## 未来可能的方向

- **Git hook**：post-commit 自动触发增量更新
- **Workflow 编排**：多 Agent 并行扫描
- **缓存**：`.claude/memory/project-map/latest.json` 缓存上次扫描结果
- **CI 集成**：pipeline 中运行 extract_arch_patterns，检测未授权结构变更
