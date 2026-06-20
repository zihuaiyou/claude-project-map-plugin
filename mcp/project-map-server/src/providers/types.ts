export interface LanguageInfo {
  name: string;
  extensions: string[];
  detectionFiles: string[];
  namingConvention: string;
}

export interface ConfigPattern {
  pattern: string;
  description: string;
}

export interface LanguageProvider {
  readonly language: LanguageInfo;

  detect(rootPath: string): boolean;
  sourceGlobs(): string[];
  configFiles(): ConfigPattern[];
  extractExports(content: string): string[];
  extractImports(content: string): string[];
  recognizeFile(fileName: string): string | undefined;
  dirPurposeHints(): Record<string, string>;
}
