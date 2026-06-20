import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { DirArchPattern, ArchPatterns, SourceFileSummary } from "./types.js";
import { getProviderForExtension, getAllProviders } from "./providers/registry.js";

// ==================== Tool Schema ====================

export const EXTRACT_ARCH_PATTERNS_TOOL = {
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

// ==================== Helpers ====================

function detectNaming(name: string): DirArchPattern["naming"] {
  const base = name.replace(/\.[^.]+$/, "");
  if (/^[A-Z][a-zA-Z0-9]+$/.test(base)) return "PascalCase";
  if (/^[a-z][a-zA-Z0-9]+$/.test(base)) return "camelCase";
  if (/^[a-z][a-z0-9-]+$/.test(base)) return "kebab-case";
  return "other";
}

function extractImports(content: string, filePath: string, rootPath: string): string[] {
  const ext = path.extname(filePath);
  const provider = getProviderForExtension(ext);

  if (provider) {
    return provider.extractImports(content);
  }

  // Fallback: JS/TS ESM imports (existing logic)
  const imports: string[] = [];
  const IMPORT_RE = /import\s+(?:\{[^}]*\}|[^;{]+?)\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_RE.exec(content)) !== null) {
    const target = match[1];
    if (target.startsWith(".")) {
      const resolved = path.resolve(path.dirname(filePath), target);
      const relative = path.relative(rootPath, resolved).replace(/\\/g, "/");
      imports.push(relative);
    }
  }
  return imports;
}

function inferDirPurpose(dir: string): string | undefined {
  const d = dir.toLowerCase().replace(/\\/g, "/");

  // Multi-language dir hints from providers
  for (const p of getAllProviders()) {
    for (const [hintDir, purpose] of Object.entries(p.dirPurposeHints())) {
      if (d === hintDir || d.startsWith(hintDir + "/")) {
        return purpose;
      }
    }
  }

  // Language-agnostic
  if (/\btests?\b/.test(d) || /__tests__/.test(d) || /spec/.test(d)) return "測試";
  if (/docs/.test(d)) return "文件";
  if (/examples/.test(d)) return "範例";
  if (/scripts/.test(d)) return "腳本";

  // JS/TS framework dir hints (existing)
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

  return undefined;
}

function generateRule(dir: string, pattern: DirArchPattern): string {
  const purpose = pattern.suggestedPurpose ?? dir;
  const namingMap: Record<string, string> = {
    "PascalCase": "PascalCase 命名",
    "camelCase": "camelCase 命名",
    "kebab-case": "kebab-case 命名",
  };

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

  return `${pattern.dir} 目錄放 ${purpose} 相關檔案，${naming}。理由：項目實際組織方式。`;
}

// ==================== Handler ====================

export async function handleExtractArchPatterns(args: Record<string, unknown>) {
  const rootPath = args.rootPath as string;

  if (!fs.existsSync(rootPath)) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "path_not_found", message: `Path not found: ${rootPath}` }) }] };
  }

  const sourceFiles = await fg("**/*.{ts,tsx,js,jsx,java,py,go,rs}", {
    cwd: rootPath,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.claude/**", "**/build/**", "**/coverage/**", "**/.next/**"],
    onlyFiles: true,
  });

  const MAX_FILES = 200;
  const filesToAnalyze = sourceFiles.slice(0, MAX_FILES);

  const summaries: SourceFileSummary[] = [];
  for (const fp of filesToAnalyze) {
    const dir = path.dirname(fp).replace(/\\/g, "/");
    const name = path.basename(fp);
    const dirKey = dir.split("/")[0];

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

  const dirMap = new Map<string, SourceFileSummary[]>();
  for (const s of summaries) {
    const existing = dirMap.get(s.dir) ?? [];
    existing.push(s);
    dirMap.set(s.dir, existing);
  }

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

  const reverseGraph = new Map<string, Set<string>>();
  for (const [from, targets] of importGraph) {
    for (const to of targets) {
      if (!reverseGraph.has(to)) reverseGraph.set(to, new Set());
      reverseGraph.get(to)!.add(from);
    }
  }

  const dirPatterns: DirArchPattern[] = [];
  for (const [dir, files] of dirMap) {
    if (files.length < 2) continue;

    const namingCounts: Record<string, number> = {};
    const extSet = new Set<string>();

    for (const f of files) {
      namingCounts[f.naming] = (namingCounts[f.naming] ?? 0) + 1;
      extSet.add(f.extension);
    }

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

  dirPatterns.sort((a, b) => b.fileCount - a.fileCount);

  const rules: string[] = [];
  for (const p of dirPatterns) {
    const rule = generateRule(p.dir, p);
    rules.push(rule);
  }

  for (const [dir, importsFrom] of importGraph) {
    for (const from of importsFrom) {
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
