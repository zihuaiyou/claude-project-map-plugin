import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";

const server = new Server(
  { name: "project-map-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Tool definitions
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

const ANALYZE_KEY_FILES_TOOL = {
  name: "analyze_key_files",
  description: "Read key config files and source headers to infer file purposes",
  inputSchema: {
    type: "object" as const,
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
    type: "object" as const,
    properties: {
      rootPath: { type: "string", description: "Project root absolute path" },
    },
    required: ["rootPath"],
  },
};

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
  if (pkg.private && (pkg.scripts as Record<string, unknown>)?.build) return "app";
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

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [SCAN_STRUCTURE_TOOL, ANALYZE_KEY_FILES_TOOL, DETECT_STACK_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "scan_structure":
      return await handleScan(args ?? {});
    case "analyze_key_files":
      return await handleAnalyzeKeyFiles(args ?? {});
    case "detect_stack":
      return handleDetectStack(args ?? {});
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
