import fs from "node:fs";
import path from "node:path";
import type { StackInfo } from "./types.js";

// ==================== Tool Schema ====================

export const DETECT_STACK_TOOL = {
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

// ==================== 依赖分类映射 ====================

const CATEGORY_MAP: Record<string, string[]> = {
  framework: ["react", "next", "vue", "nuxt", "svelte", "angular", "express", "nest", "fastify"],
  build: ["webpack", "vite", "turbopack", "esbuild", "rollup", "parcel", "tsup"],
  test: ["vitest", "jest", "playwright", "cypress", "testing-library", "mocha", "ava"],
  styling: ["tailwindcss", "styled-components", "emotion", "sass", "less", "postcss", "unocss"],
  db: ["prisma", "drizzle", "typeorm", "mongoose", "sequelize", "knex", "redis"],
};

// ==================== Helpers ====================

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

// ==================== Handler ====================

export function handleDetectStack(args: Record<string, unknown>) {
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

  const pm = fs.existsSync(path.join(rootPath, "pnpm-lock.yaml"))
    ? "pnpm"
    : fs.existsSync(path.join(rootPath, "yarn.lock"))
    ? "yarn"
    : fs.existsSync(path.join(rootPath, "package-lock.json"))
    ? "npm"
    : undefined;

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
