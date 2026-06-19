/** 目录树节点 */
export interface TreeNode {
  name: string;
  type: "file" | "dir";
  path: string;
  size?: number;
  children?: TreeNode[];
}

/** 文件信息（用于 analyze_key_files 返回） */
export interface FileInfo {
  path: string;
  size: number;
  firstLine?: string;
  exports?: string[];
  inferredPurpose?: string;
}

/** 技术栈信息 */
export interface StackInfo {
  language?: string;
  framework?: string;
  buildTool?: string;
  testFramework?: string;
  packageManager?: string;
  projectType: string;
  keyDependencies: Array<{ name: string; version: string; category: string }>;
  scripts: Record<string, string>;
}

/** 目录级架构模式 */
export interface DirArchPattern {
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
export interface ArchPatterns {
  dirPatterns: DirArchPattern[];
  rules: string[];
}

/** 源文件快速扫描结果（用于导入分析） */
export interface SourceFileSummary {
  path: string;
  dir: string;
  name: string;
  naming: "PascalCase" | "camelCase" | "kebab-case" | "mixed" | "other";
  extension: string;
  imports: string[];
}
