# Project Map — CLAUDE.md 自动维护插件

> Claude 每次对话自动读 CLAUDE.md 了解项目结构。此插件自动维护它：增量更新、按规模分级、始终 ≤200 行。

---

## 核心设计

### 1. 三层系统

```
/update-map [--full|--quick|--package <name>]
  → Skill 编排（.claude/skills/project-map.md）
    → MCP Server 只读采集（mcp/project-map-server/src/）
      → CLAUDE.md 输出（根目录或 packages/<name>/，≤200 行）
```

| 层 | 写文件？ | 职责 |
|----|---------|------|
| **MCP Server** | ❌ 纯只读 | 7 模块：scan / analyze / detect / arch / resources + types + index |
| **Skill** | ✅ 写 CLAUDE.md | 编排流程、合并数据、压缩至 ≤200 行 |
| **Command** | - | 手动触发，支持 --full / --quick / --package |

### 2. 执行模式

```
/update-map                     智能（有 _git_ref 增量，否则全量）
/update-map --full              强制全量
/update-map --quick             目录树对比，无变化跳过
/update-map --package <name>    限定单包范围（monorepo）
```

#### 增量 → 省 token

```
CLAUDE.md 存 _git_ref = a1b2c3d
  → git diff a1b2c3d..HEAD --name-only
  → 只分析 N 个变更文件（跳过其余）
  → 更新 CLAUDE.md + 写回新 HEAD
```

典型节省：100 文件改 5 个 → 跳读 95 个 → **~97%**。

回退安全：rebase 后 ref 失效 → 降级目录树对比。非 git 仓库 → 降级全量。

### 3. 分级输出（按文件数自适应）

| 级别 | 文件数 | Key Files | 目录树 | 适用 |
|------|--------|-----------|--------|------|
| **小型** | <200 | 6 个最关键文件 | 深度 ≤ 3 | 当前项目（~40 文件） |
| **中型** | 200-1000 | 按目录分组摘要 | 深度 ≤ 2 | 中大型应用 |
| **大型** | >1000 | 不设此节 | 深度 ≤ 1 | monorepo |

大项目自动跳过 `extract_arch_patterns`，从目录结构直接推断规则。

### 4. 架构变更检测

比对新目录树 vs CLAUDE.md 规则 → 发现目录移动/新增 → 告警不自动改。

### 5. Monorepo 支持

`--package <name>` 手动指定子包，扫描/写入都限到该目录。

**⚠️ 关键限制：** Claude 启动时只自动读根目录 `CLAUDE.md`，不会发现子包 `CLAUDE.md`。  
要使子包架构规则生效，必须在根 `CLAUDE.md` 的 **Packages 节**显式列出各包和其关键规则（路由导航）。

```
# Project Map（根目录）
...
## Packages
- packages/foo/ — 工具库
- packages/bar/ — API 服务

## Rules
- 回答或修改涉及任何 packages/ 下的代码时，必须先读取对应包的 CLAUDE.md。已读则不重读。
```

否则子包 `CLAUDE.md` 即使存在，Claude 也不会主动去读，如同不存在。

`--package` 的职责只是生成/更新子包文件，**根目录路由导航需手动或通过 Skill 同步维护**。非 monorepo 无此限制。

---

## MCP Server 模块

`mcp/project-map-server/src/` 拆为 6 文件，各管一事：

| 模块 | 职责 | 关键导出 |
|------|------|---------|
| `index.ts` | 入口：创建 server、注册 handlers、启动 | - |
| `types.ts` | 7 个接口定义 | TreeNode, FileInfo, StackInfo 等 |
| `scan.ts` | 递归扫描目录树 | `SCAN_STRUCTURE_TOOL`, `handleScan` |
| `analyze-files.ts` | 读文件 → 提取 exports → 推断用途 | `ANALYZE_KEY_FILES_TOOL`, `handleAnalyzeKeyFiles` |
| `detect-stack.ts` | 从 package.json 检测技术栈 | `DETECT_STACK_TOOL`, `handleDetectStack` |
| `arch-patterns.ts` | 分析命名惯例 + 导入图 → 生成规则 | `EXTRACT_ARCH_PATTERNS_TOOL`, `handleExtractArchPatterns` |

所有 tool 通过 `rootPath` 参数支持根目录和包级两种模式，同一模块两处用。

---

## 压缩约束

- CLAUDE.md 总行数 ≤ 200 行
- 不包含：函数签名、import、实现细节
- 只包含：Claude 需要的隐藏信息（结构、用途、约定、不明显依赖）
- Architecture Rules：命令式 + 每条附理由
- frontmatter 含 `_git_ref: {commit_hash}`

---

## 项目文件

```
my_claude_plugin/
├── CLAUDE.md                               ← 输出目标（自动维护，42 行）
├── .claude/
│   ├── settings.json                       ← MCP Server 注册
│   ├── skills/project-map.md               ← Skill 编排逻辑
│   └── commands/update-map.md              ← 手动触发命令
├── mcp/project-map-server/
│   ├── src/
│   │   ├── index.ts                        ← 入口
│   │   ├── types.ts                        ← 类型定义
│   │   ├── scan.ts                         ← 目录扫描
│   │   ├── analyze-files.ts                ← 文件分析
│   │   ├── detect-stack.ts                 ← 技术栈检测
│   │   └── arch-patterns.ts                ← 架构模式
│   └── package.json + tsconfig.json
├── docs/
│   └── LEARN_CLAUDE_PLUGIN.md
└── readme.md
```
