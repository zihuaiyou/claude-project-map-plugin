import fs from "node:fs";
import path from "node:path";
import type { TreeNode } from "./types.js";

// ==================== Tool Schema ====================

export const SCAN_STRUCTURE_TOOL = {
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

// ==================== Helpers ====================

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

  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

// ==================== Handler ====================

export async function handleScan(args: Record<string, unknown>) {
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
