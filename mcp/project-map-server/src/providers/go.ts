import fs from "node:fs";
import path from "node:path";
import type { LanguageProvider, LanguageInfo, ConfigPattern } from "./types.js";

const GO_LANG: LanguageInfo = {
  name: "Go",
  extensions: [".go"],
  detectionFiles: ["go.mod"],
  namingConvention: "camelCase (unexported) / PascalCase (exported)",
};

export class GoProvider implements LanguageProvider {
  readonly language = GO_LANG;

  detect(rootPath: string): boolean {
    return fs.existsSync(path.join(rootPath, "go.mod"));
  }

  sourceGlobs(): string[] {
    return ["**/*.go"];
  }

  configFiles(): ConfigPattern[] {
    return [
      { pattern: "go.mod", description: "Go module definition" },
      { pattern: "go.sum", description: "Go dependency checksums" },
      { pattern: "Makefile", description: "Build automation" },
    ];
  }

  extractExports(content: string): string[] {
    const exports: string[] = [];
    // Go exports = capitalized symbols: func/type/var/const
    const re = /^(?:func|type|var|const)\s+([A-Z]\w*)/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      exports.push(match[1]);
    }
    return exports;
  }

  extractImports(content: string): string[] {
    const imports: string[] = [];

    // Single: import "path"
    let re = /^import\s+"([^"]+)"/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Block: import ( "path1" "path2" )
    const blockMatch = content.match(/^import\s+\(([\s\S]*?)\)/m);
    if (blockMatch) {
      const lines = blockMatch[1].split("\n");
      for (const line of lines) {
        const stripped = line.replace(/^\s*/, "").replace(/^"([^"]+)"\s*$/, "$1");
        if (stripped && !stripped.startsWith("//") && !stripped.startsWith("_ ")) {
          // Handle alias: alias "path"
          const parts = stripped.split(/\s+/);
          const pkg = parts[parts.length - 1].replace(/^"/, "").replace(/"$/, "");
          if (pkg) imports.push(pkg);
        }
      }
    }

    return imports;
  }

  recognizeFile(fileName: string): string | undefined {
    if (fileName === "go.mod") return "Go module definition";
    if (fileName === "go.sum") return "Go dependency checksums";
    return undefined;
  }

  dirPurposeHints(): Record<string, string> {
    return {
      cmd: "Application entry points",
      pkg: "Library packages",
      internal: "Private packages (Go internal convention)",
      api: "API definitions",
    };
  }
}
