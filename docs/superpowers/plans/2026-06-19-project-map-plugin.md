# Project Map Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Claude plugin that auto-maintains CLAUDE.md with project structure map, reducing token waste across sessions.

**Architecture:** MCP Server (Node.js/TypeScript) provides 3 read-only tools (`scan_structure`, `analyze_key_files`, `detect_stack`). Skill (`project-map.md`) calls these tools, compresses output to ≤50 lines, writes CLAUDE.md. Slash Command (`/update-map`) triggers manually.

**Tech Stack:** TypeScript 5.x, Node.js 18+, @modelcontextprotocol/sdk, fast-glob (for file matching).

## Global Constraints

- CLAUDE.md output must be ≤50 lines (excluding frontmatter)
- MCP Server is read-only — never writes to filesystem
- All paths relative to project root
- Exclude node_modules, .git, dist, .claude from scanning
- Dependencies: @modelcontextprotocol/sdk, fast-glob, typescript, @types/node
- Build target: Node.js ESM (ES2020, module: "node16")
- MCP SDK v1.29+ uses Zod schemas: use `ListToolsRequestSchema` / `CallToolRequestSchema` with `setRequestHandler`, NOT string method names
- Top-level await requires `module: "node16"` / `moduleResolution: "node16"` in tsconfig
- All tool definitions must use `as const` on `inputSchema.type` for strict TS compatibility

---

### Task 1: MCP Server — Project Scaffolding

**Files:**
- Create: `mcp/project-map-server/package.json`
- Create: `mcp/project-map-server/tsconfig.json`
- Create: `mcp/project-map-server/src/index.ts` (skeleton with server init + 3 tool stubs)

**Interfaces:**
- Consumes: nothing
- Produces: runnable MCP server stub that starts and responds to `tools/list`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "project-map-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "fast-glob": "^3.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create MCP server skeleton**

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
  { name: "project-map-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Tool definitions
const SCAN_STRUCTURE_TOOL = {
  name: "scan_structure",
  description: "Scan project directory structure, return tree JSON",
  inputSchema: {
    type: "object",
    properties: {
      rootPath: { type: "string", description: "Project root absolute path" },
      maxDepth: { type: "number", description: "Max directory depth, default 4" },
      excludePatterns: { type: "array", items: { type: "string" }, description: "Patterns to exclude" },
    },
    required: ["rootPath"],
  },
};

const ANALYZE_KEY_FILES_TOOL = {
  name: "analyze_key_files",
  description: "Read key config files and source headers to infer file purposes",
  inputSchema: {
    type: "object",
    properties: {
      rootPath: { type: "string", description: "Project root absolute path" },
      globs: { type: "array", items: { type: "string" }, description: "Glob patterns to match" },
    },
    required: ["rootPath"],
  },
};

const DETECT_STACK_TOOL = {
  name: "detect_stack",
  description: "Detect tech stack from package.json, tsconfig, and config files",
  inputSchema: {
    type: "object",
    properties: {
      rootPath: { type: "string", description: "Project root absolute path" },
    },
    required: ["rootPath"],
  },
};

server.setRequestHandler("tools/list", async () => ({
  tools: [SCAN_STRUCTURE_TOOL, ANALYZE_KEY_FILES_TOOL, DETECT_STACK_TOOL],
}));

server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "scan_structure":
      // TODO: implement
      return { content: [{ type: "text", text: "{}" }] };
    case "analyze_key_files":
      // TODO: implement
      return { content: [{ type: "text", text: "{}" }] };
    case "detect_stack":
      // TODO: implement
      return { content: [{ type: "text", text: "{}" }] };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 4: Install dependencies**

```bash
cd d:/web/my_claude_plugin/mcp/project-map-server
pnpm install
```

- [ ] **Step 5: Build and verify server starts**

```bash
cd d:/web/my_claude_plugin/mcp/project-map-server
pnpm build
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```
Expected: JSON response with tool list (may not appear cleanly in stdio — that's OK, confirms server doesn't crash on startup)

- [ ] **Step 6: Commit**

```bash
git add mcp/project-map-server/
git commit -m "feat: scaffold MCP server project structure"
```

---

### Task 2: Implement `scan_structure` Tool

**Files:**
- Modify: `mcp/project-map-server/src/index.ts`

**Interfaces:**
- Consumes: rootPath, maxDepth?, excludePatterns?
- Produces: `{ tree: TreeNode[], fileCount: number, dirCount: number, totalSize: number }`

- [ ] **Step 1: Add scan helper functions to index.ts**

Add before `server.setRequestHandler`:

```typescript
import fs from "node:fs";
import path from "node:path";

interface TreeNode {
  name: string;
  type: "file" | "dir";
  path: string;
  size?: number;
  children?: TreeNode[];
}

function shouldExclude(name: string, excludePatterns: string[]): boolean {
  return excludePatterns.some((p) => name === p || name.startsWith(p + "/"));
}

function scanDir(
  dirPath: string,
  rootPath: string,
  currentDepth: number,
  maxDepth: number,
  excludePatterns: string[]
): TreeNode[] {
  if (currentDepth > maxDepth) return [];

  const results: TreeNode[] = [];
  let entries: string[];

  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (shouldExclude(entry, excludePatterns)) continue;

    const fullPath = path.join(dirPath, entry);
    const relativePath = path.relative(rootPath, fullPath);
    let stat: fs.Stats;

    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      const children = scanDir(fullPath, rootPath, currentDepth + 1, maxDepth, excludePatterns);
      results.push({ name: entry, type: "dir", path: relativePath, children });
    } else {
      results.push({ name: entry, type: "file", path: relativePath, size: stat.size });
    }
  }

  // Dirs first, then alphabetical
  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}
```

- [ ] **Step 2: Implement handleScan function**

Add before `server.setRequestHandler`:

```typescript
async function handleScan(args: Record<string, unknown>) {
  const rootPath = args.rootPath as string;
  const maxDepth = (args.maxDepth as number) ?? 4;
  const excludePatterns = (args.excludePatterns as string[]) ?? [
    "node_modules", ".git", "dist", ".claude",
  ];

  if (!fs.existsSync(rootPath)) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "path_not_found", message: `Path not found: ${rootPath}` }) }] };
  }

  const tree = scanDir(rootPath, rootPath, 0, maxDepth, excludePatterns);

  let fileCount = 0;
  let dirCount = 0;
  let totalSize = 0;

  function count(node: TreeNode) {
    if (node.type === "file") {
      fileCount++;
      totalSize += node.size ?? 0;
    } else {
      dirCount++;
      node.children?.forEach(count);
    }
  }
  count({ name: "root", type: "dir", path: "", children: tree });

  return {
    content: [{ type: "text", text: JSON.stringify({ tree, fileCount, dirCount, totalSize }) }],
  };
}
```

- [ ] **Step 3: Wire handleScan into tools/call handler**

Replace the `case "scan_structure"` stub:

```typescript
case "scan_structure":
  return await handleScan(args);
```

- [ ] **Step 4: Build**

```bash
cd d:/web/my_claude_plugin/mcp/project-map-server && pnpm build
```
Expected: clean compile, no errors.

- [ ] **Step 5: Commit**

```bash
git add mcp/project-map-server/src/index.ts
git commit -m "feat: implement scan_structure tool"
```

---

### Task 3: Implement `analyze_key_files` Tool

**Files:**
- Modify: `mcp/project-map-server/src/index.ts`

**Interfaces:**
- Consumes: rootPath, globs?
- Produces: `{ files: [{ path, size, firstLine?, exports?, inferredPurpose? }] }`

- [ ] **Step 1: Add analyze_key_files implementation**

Add to index.ts (before `server.setRequestHandler`):

```typescript
import fg from "fast-glob";

interface FileInfo {
  path: string;
  size: number;
  firstLine?: string;
  exports?: string[];
  inferredPurpose?: string;
}

// Simple export extraction — matches `export function`, `export class`, `export default`, `export const`
function extractExports(content: string): string[] {
  const exports: string[] = [];
  const patterns = [
    /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g,
    /export\s*\{([^}]+)\}/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (pattern.source.includes("\\{([^}]+)\\}")) {
        exports.push(...match[1].split(",").map((s) => s.trim()).filter(Boolean));
      } else {
        exports.push(match[1]);
      }
    }
  }
  return [...new Set(exports)];
}

function inferPurpose(filePath: string, firstLine: string, exports: string[]): string {
  const name = path.basename(filePath);
  const dir = path.dirname(filePath);
  const lower = name.toLowerCase();

  // Config files
  if (name === "package.json") return "Project metadata & dependencies";
  if (name === "tsconfig.json") return "TypeScript configuration";
  if (name === ".eslintrc.js" || name === ".eslintrc.cjs") return "Linting rules";
  if (name === "next.config.js" || name === "next.config.ts") return "Next.js configuration";
  if (name === "tailwind.config.ts" || name === "tailwind.config.js") return "Tailwind CSS configuration";
  if (name === "vitest.config.ts" || name === "jest.config.ts") return "Test configuration";
  if (name === "docker-compose.yml" || name === "docker-compose.yaml") return "Docker service orchestration";
  if (name === "Dockerfile") return "Container image definition";

  // Source files — infer from path patterns
  if (dir.includes("pages") || dir.includes("app/router")) return "Page component / route handler";
  if (dir.includes("components") || dir.includes("Component")) return "UI component";
  if (dir.includes("lib") || dir.includes("utils") || dir.includes("helpers")) return "Utility / helper functions";
  if (dir.includes("hooks")) return "React hooks";
  if (dir.includes("stores") || dir.includes("store")) return "State management";
  if (dir.includes("types") || dir.includes("interfaces")) return "Type definitions";
  if (dir.includes("api") && !dir.includes("component")) return "API client / server handler";
  if (dir.includes("middleware")) return "Middleware";
  if (dir.includes("styles") || dir.includes("css")) return "Styles / theme";

  // Fallback: infer from exports or first line
  if (exports.length > 0) return `Exports: ${exports.slice(0, 3).join(", ")}${exports.length > 3 ? "..." : ""}`;
  if (firstLine) return firstLine.replace(/^[/#*!\s]+/, "").trim().slice(0, 60);

  return "Unknown";
}

async function handleAnalyzeKeyFiles(args: Record<string, unknown>) {
  const rootPath = args.rootPath as string;
  const globs = (args.globs as string[]) ?? [
    "package.json",
    "tsconfig.json",
    "src/**/*.{ts,tsx}",
    "*.config.{js,ts}",
  ];

  if (!fs.existsSync(rootPath)) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "path_not_found", message: `Path not found: ${rootPath}` }) }] };
  }

  const fullGlobs = globs.map((g) => path.posix.join(rootPath.replace(/\\/g, "/"), g));
  const matchedPaths = await fg(fullGlobs, { ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.claude/**"] });

  const files: FileInfo[] = [];

  for (const p of matchedPaths.slice(0, 200)) {
    let content: string;
    try {
      content = fs.readFileSync(p, "utf-8");
    } catch {
      continue;
    }

    const stat = fs.statSync(p);
    const firstLine = content.split("\n")[0]?.trim().slice(0, 100);
    const exports = extractExports(content);
    const inferredPurpose = inferPurpose(p, firstLine ?? "", exports);

    files.push({
      path: path.relative(rootPath, p).replace(/\\/g, "/"),
      size: stat.size,
      firstLine: firstLine || undefined,
      exports: exports.length > 0 ? exports.slice(0, 10) : undefined,
      inferredPurpose,
    });
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ files }) }],
  };
}
```

- [ ] **Step 2: Wire handleAnalyzeKeyFiles into tools/call handler**

Replace the `case "analyze_key_files"` stub:

```typescript
case "analyze_key_files":
  return await handleAnalyzeKeyFiles(args);
```

- [ ] **Step 3: Build**

```bash
cd d:/web/my_claude_plugin/mcp/project-map-server && pnpm build
```
Expected: clean compile, no errors.

- [ ] **Step 4: Commit**

```bash
git add mcp/project-map-server/src/index.ts
git commit -m "feat: implement analyze_key_files tool"
```

---

### Task 4: Implement `detect_stack` Tool

**Files:**
- Modify: `mcp/project-map-server/src/index.ts`

**Interfaces:**
- Consumes: rootPath
- Produces: `{ language?, framework?, buildTool?, testFramework?, packageManager?, projectType, keyDependencies[], scripts }`

- [ ] **Step 1: Add detect_stack implementation**

Add to index.ts (before `server.setRequestHandler`):

```typescript
interface StackInfo {
  language?: string;
  framework?: string;
  buildTool?: string;
  testFramework?: string;
  packageManager?: string;
  projectType: string;
  keyDependencies: Array<{ name: string; version: string; category: string }>;
  scripts: Record<string, string>;
}

const CATEGORY_MAP: Record<string, string[]> = {
  framework: ["react", "next", "vue", "nuxt", "svelte", "angular", "express", "nest", "fastify"],
  build: ["webpack", "vite", "turbopack", "esbuild", "rollup", "parcel", "tsup"],
  test: ["vitest", "jest", "playwright", "cypress", "testing-library", "mocha", "ava"],
  styling: ["tailwindcss", "styled-components", "emotion", "sass", "less", "postcss", "unocss"],
  db: ["prisma", "drizzle", "typeorm", "mongoose", "sequelize", "knex", "redis"],
};

function detectProjectType(pkg: Record<string, unknown>): string {
  if (pkg.workspaces) return "monorepo";
  if (pkg.private && pkg.scripts?.build) return "app";
  if ((pkg.main ?? pkg.module ?? pkg.exports) && pkg.name) return "library";
  return "other";
}

function categorizeDep(name: string): string {
  const lower = name.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return "util";
}

function detectFramework(pkgDeps: Record<string, string>): string | undefined {
  const frameworks = ["next", "nuxt", "svelte", "angular", "express", "nest", "nuxt3", "gatsby", "remix"];
  for (const fw of frameworks) {
    if (pkgDeps[fw] || pkgDeps[`@${fw}`]) return fw;
  }
  return undefined;
}

function handleDetectStack(args: Record<string, unknown>) {
  const rootPath = args.rootPath as string;
  const pkgPath = path.join(rootPath, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "no_package_json", message: "No package.json found in root" }) }] };
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const keyDeps = Object.entries(allDeps)
    .map(([name, version]) => ({ name, version: String(version), category: categorizeDep(name) }))
    .slice(0, 30);

  const framework = detectFramework(allDeps);
  const buildTool = keyDeps.find((d) => d.category === "build")?.name;
  const testFramework = keyDeps.find((d) => d.category === "test")?.name;

  // Detect package manager from lock file
  const pm = fs.existsSync(path.join(rootPath, "pnpm-lock.yaml"))
    ? "pnpm"
    : fs.existsSync(path.join(rootPath, "yarn.lock"))
    ? "yarn"
    : fs.existsSync(path.join(rootPath, "package-lock.json"))
    ? "npm"
    : undefined;

  // Detect language
  const hasTsConfig = fs.existsSync(path.join(rootPath, "tsconfig.json"));
  const language = hasTsConfig ? "TypeScript" : "JavaScript";

  const result: StackInfo = {
    language,
    framework,
    buildTool,
    testFramework,
    packageManager: pm,
    projectType: detectProjectType(pkg),
    keyDependencies: keyDeps,
    scripts: pkg.scripts ?? {},
  };

  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}
```

- [ ] **Step 2: Wire handleDetectStack into tools/call handler**

Replace the `case "detect_stack"` stub:

```typescript
case "detect_stack":
  return handleDetectStack(args);
```

- [ ] **Step 3: Build**

```bash
cd d:/web/my_claude_plugin/mcp/project-map-server && pnpm build
```
Expected: clean compile, no errors.

- [ ] **Step 4: Test all 3 tools via stdin**

```bash
cd d:/web/my_claude_plugin/mcp/project-map-server
# Test tools/list
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
# Expected: response with 3 tool definitions

# Test scan_structure (pipe through a small script)
node -e "
const { spawn } = require('child_process');
const s = spawn('node', ['dist/index.js']);
const req = {jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'scan_structure',arguments:{rootPath:'d:/web/my_claude_plugin',maxDepth:2}}};
s.stdin.write(JSON.stringify(req) + '\n');
s.stdout.on('data', d => console.log(d.toString()));
setTimeout(() => s.kill(), 1000);
"
```
Verify: returns JSON with tree, fileCount, dirCount.

- [ ] **Step 5: Commit**

```bash
git add mcp/project-map-server/src/index.ts
git commit -m "feat: implement detect_stack tool"
```

---

### Task 5: Create Skill File

**Files:**
- Create: `.claude/skills/project-map.md`

**Interfaces:**
- Consumes: MCP tools from project-map-server
- Produces: CLAUDE.md (via Write tool)

- [ ] **Step 1: Create project-map.md**

```markdown
---
name: project-map
description: 更新项目结构地图（CLAUDE.md），扫描目录、分析文件用途、检测技术栈，压缩到 ≤50 行
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
5. 汇总 → 压缩 → 写入 CLAUDE.md
6. 输出变更摘要
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

## Conventions
{从文件分析中推断的命名/架构约定}
```

**压缩规则（必须遵守）：**

1. 总行数 ≤ 50 行（不含 frontmatter 行 `---` 或 `# Project Map` 标题）
2. 不包含：函数签名、import 语句、实现细节、注释
3. 只包含：其他 Claude 需要知道的「隐藏信息」
   — 目录结构、文件用途、架构约定、不明显的依赖关系
4. 删除：明显的内容（如 "src/ 放源码"）、过时信息
5. 目录树只展示深度 ≤ 3 的关键目录，省略空目录
6. Key Files 只保留最重要的 6 个文件
7. Conventions 最多 4 条

### 步骤 6：写入 CLAUDE.md

使用 Write 工具将压缩后的内容写入项目根目录的 `CLAUDE.md`。

### 步骤 7：输出摘要

向用户展示变更摘要：

```markdown
✅ CLAUDE.md 已更新
- 技术栈: {framework} + {language}
- 目录: {dirCount} 个目录, {fileCount} 个文件
- 变更: {新增/修改了 X 条信息}
- 行数: {N} 行 (≤50 ✅)
```

## 检查清单

- [ ] 读取了当前 CLAUDE.md（如存在）
- [ ] 调用了 scan_structure 获取目录树
- [ ] 调用了 analyze_key_files 获取文件用途
- [ ] 调用了 detect_stack 获取技术栈
- [ ] 所有 MCP 返回有效数据（非空、无错误）
- [ ] 内容压缩到 ≤ 50 行
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

## 边界约束

- ☑ 不修改 CLAUDE.md 之外的任何文件
- ☑ 不执行 npm/build/test 命令
- ☑ 不访问外部 API 或网络
- ☑ 如果 MCP Server 返回错误，输出错误信息并中止
- ☑ 如果项目文件超过 2000 个，只扫描深度 2 的层次
- ☑ 行数超过 50 行必须继续压缩，直到 ≤ 50
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/project-map.md
git commit -m "feat: create project-map skill"
```

---

### Task 6: Create Slash Command

**Files:**
- Create: `.claude/commands/update-map.md`

- [ ] **Step 1: Create update-map.md**

```markdown
---
name: update-map
description: 更新/刷新项目结构地图 (CLAUDE.md)，手动触发 project-map skill
---

# /update-map 命令

## 用法

| 命令 | 效果 |
|------|------|
| `/update-map` | 全量更新：重新扫描全部项目结构并刷新 CLAUDE.md |
| `/update-map --quick` | 快速增量：读取当前 CLAUDE.md，只检查变更的文件并更新 |

## 执行流程

### 全量模式（默认）

1. 调用 `project-map` Skill 的完整流程
2. 扫描全部目录结构、分析文件用途、检测技术栈
3. 生成 ≤ 50 行的 CLAUDE.md
4. 报告变更摘要

### 快速模式（`--quick`）

1. 读取当前 CLAUDE.md
2. 使用 MCP `scan_structure` 获取当前目录树
3. 与 CLAUDE.md 中的结构对比
4. 如果结构无变化 → 提示「项目结构无变化，无需更新」
5. 如果有变化 → 只更新变化的部分，保留已知信息
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/update-map.md
git commit -m "feat: create update-map slash command"
```

---

### Task 7: Configure MCP Server & Settings

**Files:**
- Create: `.claude/settings.json` (if not exists, otherwise modify)

- [ ] **Step 1: Create/update .claude/settings.json**

```json
{
  "mcpServers": {
    "project-map": {
      "command": "node",
      "args": ["mcp/project-map-server/dist/index.js"],
      "env": {}
    }
  }
}
```

- [ ] **Step 2: Update .gitignore**

Ensure `.gitignore` includes:

```
node_modules
dist
```

(Already has `/node_modules`, may need to add `dist` for MCP server build output)

- [ ] **Step 3: Add CLAUDE.md to .gitignore to prevent accidental publish**

Check if CLAUDE.md should be gitignored (optional — many projects commit it).

- [ ] **Step 4: Commit**

```bash
git add .claude/settings.json .gitignore
git commit -m "feat: configure MCP server registration in settings"
```

---

### Task 8: Integration Test

**Files:** None (verification only)

- [ ] **Step 1: Build MCP server**

```bash
cd d:/web/my_claude_plugin/mcp/project-map-server && pnpm build
```
Expected: clean compile, no errors.

- [ ] **Step 2: Test MCP tools directly**

```bash
cd d:/web/my_claude_plugin/mcp/project-map-server
node -e "
import { spawn } from 'child_process';
const s = spawn('node', ['dist/index.js']);
s.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}) + '\n');
s.stdout.on('data', d => {
  const resp = JSON.parse(d.toString());
  console.log('Tools:', resp.result.tools.map(t => t.name));
  s.kill();
});
"
```

- [ ] **Step 3: Manual skill test**

Open Claude Code in project root and type:
```
/update-map
```
Verify: CLAUDE.md is created with proper content, ≤50 lines.

- [ ] **Step 4: Verify CLAUDE.md is useful**

Open CLAUDE.md and confirm it contains:
- Tech stack section
- Directory structure
- Key files with purposes
- Conventions

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete project-map plugin integration"
```
