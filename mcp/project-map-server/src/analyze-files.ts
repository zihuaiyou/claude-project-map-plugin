import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { FileInfo } from "./types.js";
import { getProviderForExtension, getAllProviders } from "./providers/registry.js";

// ==================== Tool Schema ====================

export const ANALYZE_KEY_FILES_TOOL = {
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

// ==================== Helpers ====================

function extractExports(content: string, extension?: string): string[] {
  if (extension) {
    const provider = getProviderForExtension(extension);
    if (provider) return provider.extractExports(content);
  }

  // Fallback: JS/TS exports (existing logic for .ts/.tsx/.js/.jsx)
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
  const dir = path.dirname(filePath).replace(/\\/g, "/");

  // JS/TS config files (existing)
  if (name === "package.json") return "Project metadata & dependencies";
  if (name === "tsconfig.json") return "TypeScript configuration";
  if (name === ".eslintrc.js" || name === ".eslintrc.cjs") return "Linting rules";
  if (name === "next.config.js" || name === "next.config.ts") return "Next.js configuration";
  if (name === "tailwind.config.ts" || name === "tailwind.config.js") return "Tailwind CSS configuration";
  if (name === "vitest.config.ts" || name === "jest.config.ts") return "Test configuration";
  if (name === "docker-compose.yml" || name === "docker-compose.yaml") return "Docker service orchestration";
  if (name === "Dockerfile") return "Container image definition";

  // Multi-language config files (via providers — check by extension and exact name)
  const ext = path.extname(name);
  const extProvider = getProviderForExtension(ext);
  if (extProvider) {
    const recognized = extProvider.recognizeFile(name);
    if (recognized) return recognized;
  }
  for (const p of getAllProviders()) {
    const recognized = p.recognizeFile(name);
    if (recognized) return recognized;
  }

  // Language-agnostic directory hints
  if (dir.includes("tests") || dir.includes("__tests__") || dir.includes("spec")) return "Test files";
  if (dir.includes("docs")) return "Documentation";
  if (dir.includes("examples") || dir.includes("samples")) return "Examples";
  if (dir.includes("scripts")) return "Build/utility scripts";

  // JS/TS framework dir hints (existing)
  if (dir.includes("pages") || dir.includes("app/router")) return "Page component / route handler";
  if (dir.includes("components") || dir.includes("Component")) return "UI component";
  if (dir.includes("lib") || dir.includes("utils") || dir.includes("helpers")) return "Utility / helper functions";
  if (dir.includes("hooks")) return "React hooks";
  if (dir.includes("stores") || dir.includes("store")) return "State management";
  if (dir.includes("types") || dir.includes("interfaces")) return "Type definitions";
  if (dir.includes("api") && !dir.includes("component")) return "API client / server handler";
  if (dir.includes("middleware")) return "Middleware";
  if (dir.includes("styles") || dir.includes("css")) return "Styles / theme";

  if (exports.length > 0) return `Exports: ${exports.slice(0, 3).join(", ")}${exports.length > 3 ? "..." : ""}`;
  if (firstLine) return firstLine.replace(/^[/#*!\s]+/, "").trim().slice(0, 60);

  return "Unknown";
}

// ==================== Handler ====================

export async function handleAnalyzeKeyFiles(args: Record<string, unknown>) {
  const rootPath = args.rootPath as string;

  if (!fs.existsSync(rootPath)) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "path_not_found", message: `Path not found: ${rootPath}` }) }] };
  }

  let pathsToAnalyze: string[];
  const filePaths = args.filePaths as string[] | undefined;

  if (filePaths && filePaths.length > 0) {
    pathsToAnalyze = filePaths
      .map((fp) => path.join(rootPath, fp))
      .filter((p) => fs.existsSync(p));
  } else {
    const globs = (args.globs as string[]) ?? (() => {
      const allExtensions = new Set<string>([".ts", ".tsx", ".js", ".jsx"]);
      for (const p of getAllProviders()) {
        for (const ext of p.language.extensions) {
          allExtensions.add(ext);
        }
      }
      const extPattern = [...allExtensions].join(",");
      return [
        "package.json",
        "tsconfig.json",
        `**/*.{${extPattern}}`,
        "*.config.{js,ts}",
      ];
    })();
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
    const ext = path.extname(p);
    const exports = extractExports(content, ext);
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
