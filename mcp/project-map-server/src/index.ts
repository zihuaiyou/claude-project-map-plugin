/**
 * MCP Project Map Server
 *
 * 一个 MCP（Model Context Protocol）服务端，提供项目结构扫描、关键文件分析和技术栈检测功能。
 * 通过 stdio 传输层与 MCP 客户端（如 Claude Desktop）通信。
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";

// ==================== 服务端初始化 ====================

const server = new Server(
  { name: "project-map-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ==================== 工具定义（MCP Tool Schema） ====================

/**
 * 工具：扫描项目目录结构
 * 返回 JSON 树，包含文件/目录层级、大小等信息
 */
const SCAN_STRUCTURE_TOOL = {
  name: "scan_structure",
  description: "Scan project directory structure, return tree JSON",
  inputSchema: {
    type: "object" as const,
    properties: {
      rootPath: { type: "string", description: "Project root absolute path" },
      maxDepth: { type: "number", description: "Max directory depth, default 4" },
      excludePatterns: { type: "array", items: { type: "string" }, description: "Patterns to exclude" },
    },
    required: ["rootPath"],
  },
};

/**
 * 工具：分析关键文件
 * 读取配置文件（package.json、tsconfig 等）和源码头，推断文件用途
 * 支持两种模式：
 *   1. globs 模式：按 glob 匹配文件（全量扫描，默认）
 *   2. filePaths 模式：仅分析指定路径（增量扫描，优先于 globs）
 */
const ANALYZE_KEY_FILES_TOOL = {
  name: "analyze_key_files",
  description: "Read key config files and source headers to infer file purposes. Supports glob-based (full) or filePaths (incremental) mode.",
  inputSchema: {
    type: "object" as const,
    properties: {
      rootPath: { type: "string", description: "Project root absolute path" },
      globs: { type: "array", items: { type: "string" }, description: "Glob patterns to match (full scan mode)" },
      filePaths: { type: "array", items: { type: "string" }, description: "Specific relative file paths to analyze (incremental mode, overrides globs)" },
    },
    required: ["rootPath"],
  },
};

/**
 * 工具：检测技术栈
 * 从 package.json、tsconfig 等配置文件中推断语言、框架、构建工具等
 */
const DETECT_STACK_TOOL = {
  name: "detect_stack",
  description: "Detect tech stack from package.json, tsconfig, and config files",
  inputSchema: {
    type: "object" as const,
    properties: {
      rootPath: { type: "string", description: "Project root absolute path" },
    },
    required: ["rootPath"],
  },
};

/**
 * 工具：提取架构模式
 * 分析目录结构、命名慣例、導入邊界，生成架構規則
 */
const EXTRACT_ARCH_PATTERNS_TOOL = {
  name: "extract_arch_patterns",
  description: "Analyze codebase directory structure, naming conventions, and import boundaries to generate architecture rules",
  inputSchema: {
    type: "object" as const,
    properties: {
      rootPath: { type: "string", description: "Project root absolute path" },
    },
    required: ["rootPath"],
  },
};

// ==================== 类型定义 ====================

/** 目录树节点 */
interface TreeNode {
  name: string;
  type: "file" | "dir";
  path: string;
  size?: number;
  children?: TreeNode[];
}

/** 文件信息（用于 analyze_key_files 返回） */
interface FileInfo {
  path: string;
  size: number;
  firstLine?: string;
  exports?: string[];
  inferredPurpose?: string;
}

/** 技术栈信息 */
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

// ==================== 架构分析类型 ====================

/** 目录级架构模式 */
interface DirArchPattern {
  dir: string;
  fileCount: number;
  naming: "PascalCase" | "camelCase" | "kebab-case" | "mixed" | "other";
  extensions: string[];
  importsFrom: string[];
  importedBy: string[];
  sampleFiles: string[];
  suggestedPurpose?: string;
}

/** 架构分析结果 */
interface ArchPatterns {
  dirPatterns: DirArchPattern[];
  rules: string[];
}

/** 源文件快速扫描结果（用于导入分析） */
interface SourceFileSummary {
  path: string;
  dir: string;
  name: string;
  naming: "PascalCase" | "camelCase" | "kebab-case" | "mixed" | "other";
  extension: string;
  imports: string[];
}

// ==================== 目录扫描逻辑 ====================

/**
 * 判断文件/目录名是否应被排除
 * @param name - 文件/目录名
 * @param excludePatterns - 排除模式列表
 * @returns true 表示应跳过
 */
function shouldExclude(name: string, excludePatterns: string[]): boolean {
  return excludePatterns.some((p) => name === p || name.startsWith(p + "/"));
}

/**
 * 递归扫描目录，构建树结构
 * 排序规则：目录优先，同级按字母序排列
 */
function scanDir(
  dirPath: string,
  rootPath: string,
  currentDepth: number,
  maxDepth: number,
  excludePatterns: string[]
): TreeNode[] {
  // 超过最大深度，停止递归
  if (currentDepth > maxDepth) return [];

  const results: TreeNode[] = [];
  let entries: string[];

  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return []; // 无权限或目录不存在，静默跳过
  }

  for (const entry of entries) {
    if (shouldExclude(entry, excludePatterns)) continue;

    const fullPath = path.join(dirPath, entry);
    const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, "/");
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

  // 目录排前面，同类型按字母序
  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

/**
 * 处理 scan_structure 工具调用
 * - 校验路径是否存在
 * - 扫描目录树
 * - 统计文件数、目录数、总大小
 */
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

  // 遍历树，汇总统计信息
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

// ==================== 文件分析逻辑 ====================

/**
 * 从源码中提取 export 的符号名
 * 支持：export function/class/const/let/var/interface/type/enum、export default、export { ... }
 */
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
        // export { ... } 形式，提取花括号内的多个名字
        exports.push(...match[1].split(",").map((s) => s.trim()).filter(Boolean));
      } else {
        exports.push(match[1]);
      }
    }
  }
  return [...new Set(exports)];
}

/**
 * 推断文件用途（基于路径模式和文件名启发式规则）
 */
function inferPurpose(filePath: string, firstLine: string, exports: string[]): string {
  const name = path.basename(filePath);
  const dir = path.dirname(filePath).replace(/\\/g, "/");

  // —— 已知配置文件，直接返回固定描述 ——
  if (name === "package.json") return "Project metadata & dependencies";
  if (name === "tsconfig.json") return "TypeScript configuration";
  if (name === ".eslintrc.js" || name === ".eslintrc.cjs") return "Linting rules";
  if (name === "next.config.js" || name === "next.config.ts") return "Next.js configuration";
  if (name === "tailwind.config.ts" || name === "tailwind.config.js") return "Tailwind CSS configuration";
  if (name === "vitest.config.ts" || name === "jest.config.ts") return "Test configuration";
  if (name === "docker-compose.yml" || name === "docker-compose.yaml") return "Docker service orchestration";
  if (name === "Dockerfile") return "Container image definition";

  // —— 源码文件，根据目录名推断 ——
  if (dir.includes("pages") || dir.includes("app/router")) return "Page component / route handler";
  if (dir.includes("components") || dir.includes("Component")) return "UI component";
  if (dir.includes("lib") || dir.includes("utils") || dir.includes("helpers")) return "Utility / helper functions";
  if (dir.includes("hooks")) return "React hooks";
  if (dir.includes("stores") || dir.includes("store")) return "State management";
  if (dir.includes("types") || dir.includes("interfaces")) return "Type definitions";
  if (dir.includes("api") && !dir.includes("component")) return "API client / server handler";
  if (dir.includes("middleware")) return "Middleware";
  if (dir.includes("styles") || dir.includes("css")) return "Styles / theme";

  // —— 兜底：用 exports 或文件首行内容 ——
  if (exports.length > 0) return `Exports: ${exports.slice(0, 3).join(", ")}${exports.length > 3 ? "..." : ""}`;
  if (firstLine) return firstLine.replace(/^[/#*!\s]+/, "").trim().slice(0, 60);

  return "Unknown";
}

/**
 * 处理 analyze_key_files 工具调用
 * - 按 glob 匹配文件
 * - 读取内容并提取 exports
 * - 推断用途
 * - 限制最多处理 200 个文件
 */
async function handleAnalyzeKeyFiles(args: Record<string, unknown>) {
  const rootPath = args.rootPath as string;

  if (!fs.existsSync(rootPath)) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "path_not_found", message: `Path not found: ${rootPath}` }) }] };
  }

  // 决定扫描哪些路径：filePaths 优先（增量模式），否则 globs（全量模式）
  let pathsToAnalyze: string[];
  const filePaths = args.filePaths as string[] | undefined;

  if (filePaths && filePaths.length > 0) {
    // 增量模式：只扫指定文件
    pathsToAnalyze = filePaths
      .map((fp) => path.join(rootPath, fp))
      .filter((p) => fs.existsSync(p)); // 跳过已删除的文件
  } else {
    // 全量模式：按 glob 匹配
    const globs = (args.globs as string[]) ?? [
      "package.json",
      "tsconfig.json",
      "src/**/*.{ts,tsx}",
      "*.config.{js,ts}",
    ];
    const fullGlobs = globs.map((g) => path.posix.join(rootPath.replace(/\\/g, "/"), g));
    pathsToAnalyze = await fg(fullGlobs, { ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.claude/**"] });
  }

  const files: FileInfo[] = [];

  for (const p of pathsToAnalyze.slice(0, 200)) {
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

// ==================== 技术栈检测逻辑 ====================

/**
 * 依赖分类映射表
 * 将已知包名映射到框架/构建/测试/样式/数据库类别
 */
const CATEGORY_MAP: Record<string, string[]> = {
  framework: ["react", "next", "vue", "nuxt", "svelte", "angular", "express", "nest", "fastify"],
  build: ["webpack", "vite", "turbopack", "esbuild", "rollup", "parcel", "tsup"],
  test: ["vitest", "jest", "playwright", "cypress", "testing-library", "mocha", "ava"],
  styling: ["tailwindcss", "styled-components", "emotion", "sass", "less", "postcss", "unocss"],
  db: ["prisma", "drizzle", "typeorm", "mongoose", "sequelize", "knex", "redis"],
};

/**
 * 根据 package.json 的内容判断项目类型
 * - workspaces 字段 => monorepo
 * - private + build 脚本 => app
 * - 有 main/module/exports => library
 * - 其他
 */
function detectProjectType(pkg: Record<string, unknown>): string {
  if (pkg.workspaces) return "monorepo";
  if (pkg.private && (pkg.scripts as Record<string, unknown>)?.build) return "app";
  if ((pkg.main ?? pkg.module ?? pkg.exports) && pkg.name) return "library";
  return "other";
}

/** 将依赖名归类 */
function categorizeDep(name: string): string {
  const lower = name.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return "util";
}

/** 从依赖列表中检测框架 */
function detectFramework(pkgDeps: Record<string, string>): string | undefined {
  const frameworkPatterns: Record<string, string[]> = {
    "next": ["next"],
    "nuxt": ["nuxt", "nuxt3"],
    "svelte": ["svelte", "sveltekit"],
    "angular": ["@angular/core"],
    "express": ["express"],
    "nest": ["@nestjs/core", "@nestjs/common"],
    "gatsby": ["gatsby"],
    "remix": ["@remix-run/react", "@remix-run/node"],
  };

  for (const [fw, pkgs] of Object.entries(frameworkPatterns)) {
    if (pkgs.some((pkg) => pkgDeps[pkg])) return fw;
  }
  return undefined;
}

/**
 * 处理 detect_stack 工具调用
 * - 读取 package.json
 * - 提取依赖并分类
 * - 检测框架、构建工具、测试框架
 * - 通过锁文件推断包管理器
 * - 检查 tsconfig 推断语言
 */
function handleDetectStack(args: Record<string, unknown>) {
  const rootPath = args.rootPath as string;
  const pkgPath = path.join(rootPath, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "no_package_json", message: "No package.json found in root" }) }] };
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

  // 合并 dependencies + devDependencies
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const keyDeps = Object.entries(allDeps)
    .map(([name, version]) => ({ name, version: String(version), category: categorizeDep(name) }))
    .slice(0, 30);

  const framework = detectFramework(allDeps);
  const buildTool = keyDeps.find((d) => d.category === "build")?.name;
  const testFramework = keyDeps.find((d) => d.category === "test")?.name;

  // 检测包管理器（按优先级检查锁文件）
  const pm = fs.existsSync(path.join(rootPath, "pnpm-lock.yaml"))
    ? "pnpm"
    : fs.existsSync(path.join(rootPath, "yarn.lock"))
    ? "yarn"
    : fs.existsSync(path.join(rootPath, "package-lock.json"))
    ? "npm"
    : undefined;

  // 检测语言（是否有 tsconfig.json）
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

// ==================== 架构模式分析逻辑 ====================

/** 检测文件名命名慣例 */
function detectNaming(name: string): DirArchPattern["naming"] {
  const base = name.replace(/\.[^.]+$/, ""); // 去掉副檔名
  if (/^[A-Z][a-zA-Z0-9]+$/.test(base)) return "PascalCase";
  if (/^[a-z][a-zA-Z0-9]+$/.test(base)) return "camelCase";
  if (/^[a-z][a-z0-9-]+$/.test(base)) return "kebab-case";
  return "other";
}

/** 從源碼中提取相對導入路徑 */
const IMPORT_RE = /import\s+(?:\{[^}]*\}|[^;{]+?)\s+from\s+['"]([^'"]+)['"]/g;

function extractImports(content: string, filePath: string, rootPath: string): string[] {
  const imports: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = IMPORT_RE.exec(content)) !== null) {
    const target = match[1];
    // 只保留相對導入（以 ./ 或 ../ 開頭）
    if (target.startsWith(".")) {
      const resolved = path.resolve(path.dirname(filePath), target);
      const relative = path.relative(rootPath, resolved).replace(/\\/g, "/");
      imports.push(relative);
    }
  }
  return imports;
}

/** 根據目錄名推斷用途 */
function inferDirPurpose(dir: string): string | undefined {
  const d = dir.toLowerCase().replace(/\\/g, "/");
  if (/components?/.test(d)) return "UI 元件";
  if (/pages?/.test(d)) return "頁面路由";
  if (/app\/router/.test(d) || /\bapp$/.test(d)) return "App Router 頁面";
  if (/lib/.test(d) || /utils?/.test(d)) return "工具函數";
  if (/hooks?/.test(d)) return "React Hooks";
  if (/stores?/.test(d) || /state/.test(d)) return "狀態管理";
  if (/types?/.test(d) || /interfaces/.test(d)) return "型別定義";
  if (/api/.test(d)) return "API 處理";
  if (/middleware/.test(d)) return "中介軟體";
  if (/styles?/.test(d) || /css/.test(d) || /theme/.test(d)) return "樣式";
  if (/config/.test(d)) return "配置";
  if (/layouts?/.test(d)) return "佈局";
  if (/\btests?\b/.test(d) || /__tests__/.test(d) || /spec/.test(d)) return "測試";
  return undefined;
}

/** 根據目錄名生成架構規則 */
function generateRule(dir: string, pattern: DirArchPattern): string {
  const purpose = pattern.suggestedPurpose ?? dir;
  const namingMap: Record<string, string> = {
    "PascalCase": "PascalCase 命名",
    "camelCase": "camelCase 命名",
    "kebab-case": "kebab-case 命名",
  };

  // 根據用途生成不同規則模版
  const templates: Record<string, (d: string, n: string) => string> = {
    "UI 元件": (d, n) => `${d} 目錄只放 UI 元件，${n}。理由：React 元件標準慣例，利於檔案辨識與自動索引。`,
    "頁面路由": (d, _n) => `${d} 目錄對應路由路徑，目錄結構即路由結構。理由：框架約定式路由，保持路由層級清晰。`,
    "App Router 頁面": (d, n) => `${d} 目錄為 Next.js App Router 入口，${n}。理由：App Router 約定使 page/layout/loading 自動對應路由。`,
    "工具函數": (d, n) => `${d} 目錄放純函數工具，不包含 UI 邏輯，${n}。理由：與業務邏輯分離，保持可測試性。`,
    "React Hooks": (d, n) => `${d} 目錄放自定義 Hook，以 "use" 前綴命名，${n}。理由：React Hooks 命名約定。`,
    "狀態管理": (d, _n) => `${d} 目錄集中管理全局狀態，不跨目錄直接引用 store 外部。理由：避免狀態引用混亂。`,
    "型別定義": (d, n) => `${d} 目錄放 TypeScript 型別定義，${n}。理由：集中型別便於複用與導入。`,
    "API 處理": (d, _n) => `${d} 目錄處理 API 請求/響應，不包含 UI 渲染邏輯。理由：前後端邏輯分離，一層只做一件事。`,
    "中介軟體": (d, _n) => `${d} 目錄放中介軟體邏輯，不直接處理業務。理由：中介軟體專注請求/響應管道。`,
  };

  const naming = namingMap[pattern.naming] ?? pattern.naming;
  const template = templates[purpose];

  if (template) return template(pattern.dir, naming);

  // 兜底：通用規則
  return `${pattern.dir} 目錄放 ${purpose} 相關檔案，${naming}。理由：項目實際組織方式。`;
}

/**
 * 處理 extract_arch_patterns 工具調用
 * - 掃描源文件目錄
 * - 檢測命名慣例
 * - 提取導入關係
 * - 生成架構規則
 */
async function handleExtractArchPatterns(args: Record<string, unknown>) {
  const rootPath = args.rootPath as string;

  if (!fs.existsSync(rootPath)) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "path_not_found", message: `Path not found: ${rootPath}` }) }] };
  }

  // 找源文件（排除常見生成目錄）
  const sourceFiles = await fg("**/*.{ts,tsx,js,jsx}", {
    cwd: rootPath,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.claude/**", "**/build/**", "**/coverage/**", "**/.next/**"],
    onlyFiles: true,
  });

  // 限制分析文件數量
  const MAX_FILES = 200;
  const filesToAnalyze = sourceFiles.slice(0, MAX_FILES);

  // 快速掃描所有源文件
  const summaries: SourceFileSummary[] = [];
  for (const fp of filesToAnalyze) {
    const dir = path.dirname(fp).replace(/\\/g, "/");
    const name = path.basename(fp);
    const dirKey = dir.split("/")[0]; // 只看頂層目錄（src/, apps/, packages/ 等）

    let content = "";
    try {
      content = fs.readFileSync(path.join(rootPath, fp), "utf-8").slice(0, 3000);
    } catch { continue; }

    const imports = extractImports(content, path.join(rootPath, fp), rootPath);

    summaries.push({
      path: fp,
      dir: dirKey,
      name,
      naming: detectNaming(name),
      extension: path.extname(name),
      imports,
    });
  }

  // 按目錄分組
  const dirMap = new Map<string, SourceFileSummary[]>();
  for (const s of summaries) {
    const existing = dirMap.get(s.dir) ?? [];
    existing.push(s);
    dirMap.set(s.dir, existing);
  }

  // 構建導入關係圖（誰導入誰）
  const importGraph = new Map<string, Set<string>>();
  for (const s of summaries) {
    for (const imp of s.imports) {
      const targetDir = imp.split("/")[0];
      if (targetDir && targetDir !== s.dir) {
        if (!importGraph.has(s.dir)) importGraph.set(s.dir, new Set());
        importGraph.get(s.dir)!.add(targetDir);
      }
    }
  }

  // 反向導入關係（誰被誰導入）
  const reverseGraph = new Map<string, Set<string>>();
  for (const [from, targets] of importGraph) {
    for (const to of targets) {
      if (!reverseGraph.has(to)) reverseGraph.set(to, new Set());
      reverseGraph.get(to)!.add(from);
    }
  }

  // 生成目錄級模式
  const dirPatterns: DirArchPattern[] = [];
  for (const [dir, files] of dirMap) {
    if (files.length < 2) continue; // 跳過只有 1 個檔案的目錄

    const namingCounts: Record<string, number> = {};
    const extSet = new Set<string>();

    for (const f of files) {
      namingCounts[f.naming] = (namingCounts[f.naming] ?? 0) + 1;
      extSet.add(f.extension);
    }

    // 取主導命名慣例
    const dominantNaming = Object.entries(namingCounts).sort((a, b) => b[1] - a[1])[0][0] as DirArchPattern["naming"];
    const sampleFiles = files.slice(0, 3).map((f) => f.path);

    dirPatterns.push({
      dir,
      fileCount: files.length,
      naming: dominantNaming,
      extensions: [...extSet],
      importsFrom: [...(importGraph.get(dir) ?? [])].sort(),
      importedBy: [...(reverseGraph.get(dir) ?? [])].sort(),
      sampleFiles,
      suggestedPurpose: inferDirPurpose(dir),
    });
  }

  // 排序：文件數多的目錄排前面
  dirPatterns.sort((a, b) => b.fileCount - a.fileCount);

  // 生成規則
  const rules: string[] = [];
  for (const p of dirPatterns) {
    const rule = generateRule(p.dir, p);
    rules.push(rule);
  }

  // 生成導入邊界規則
  for (const [dir, importsFrom] of importGraph) {
    for (const from of importsFrom) {
      // 如果 src/types 導入了 src/components → 可能有問題
      const dirPurpose = inferDirPurpose(dir);
      const fromPurpose = inferDirPurpose(from);
      if (dirPurpose === "型別定義" && fromPurpose === "UI 元件") {
        rules.push(`型別目錄 (${dir}) 不應導入 UI 元件目錄 (${from})。理由：型別定義應與 UI 邏輯解耦。`);
      }
    }
  }

  const result: ArchPatterns = { dirPatterns, rules };

  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}

// ==================== MCP 协议处理 ====================

/**
 * 注册 ListTools 处理器
 * 返回声明好的三个工具，供客户端发现
 */
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [SCAN_STRUCTURE_TOOL, ANALYZE_KEY_FILES_TOOL, DETECT_STACK_TOOL, EXTRACT_ARCH_PATTERNS_TOOL],
}));

/**
 * 注册 CallTool 处理器
 * 根据工具名分发到对应处理函数
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "scan_structure":
      return await handleScan(args ?? {});
    case "analyze_key_files":
      return await handleAnalyzeKeyFiles(args ?? {});
    case "detect_stack":
      return handleDetectStack(args ?? {});
    case "extract_arch_patterns":
      return await handleExtractArchPatterns(args ?? {});
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ==================== 启动服务 ====================

// 通过 stdio 建立传输层，连接 MCP 客户端
const transport = new StdioServerTransport();
await server.connect(transport);
