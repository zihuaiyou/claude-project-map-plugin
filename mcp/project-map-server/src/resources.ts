import fs from "node:fs";
import path from "node:path";

/**
 * 查找 monorepo 子包的 CLAUDE.md 文件
 * 搜索 packages/<name>/CLAUDE.md 和 apps/<name>/CLAUDE.md
 * 使用 process.cwd() 作为项目根路径（MCP Server 从项目根启动）
 */
export function findPackageClaudeMds(): { uri: string; name: string; filePath: string }[] {
  const root = process.cwd();
  const results: { uri: string; name: string; filePath: string }[] = [];
  const searchDirs = ["packages", "apps"];

  for (const searchDir of searchDirs) {
    try {
      const dir = path.join(root, searchDir);
      if (!fs.existsSync(dir)) continue;

      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        if (!fs.statSync(fullPath).isDirectory()) continue;

        const claudePath = path.join(fullPath, "CLAUDE.md");
        if (fs.existsSync(claudePath)) {
          const pkgName = `${searchDir}/${entry}`;
          results.push({
            uri: `projectmap://package/${pkgName}/CLAUDE.md`,
            name: `${pkgName}/CLAUDE.md`,
            filePath: claudePath,
          });
        }
      }
    } catch { /* 跳过没有权限的目录 */ }
  }

  return results;
}
