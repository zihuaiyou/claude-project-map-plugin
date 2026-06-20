import fs from "node:fs";
import path from "node:path";
import type { LanguageProvider, LanguageInfo, ConfigPattern } from "./types.js";

const RUST_LANG: LanguageInfo = {
  name: "Rust",
  extensions: [".rs"],
  detectionFiles: ["Cargo.toml"],
  namingConvention: "snake_case (functions/vars) / PascalCase (types/traits)",
};

export class RustProvider implements LanguageProvider {
  readonly language = RUST_LANG;

  detect(rootPath: string): boolean {
    return fs.existsSync(path.join(rootPath, "Cargo.toml"));
  }

  sourceGlobs(): string[] {
    return ["**/*.rs"];
  }

  configFiles(): ConfigPattern[] {
    return [
      { pattern: "Cargo.toml", description: "Rust package manifest" },
      { pattern: "Cargo.lock", description: "Rust dependency lockfile" },
      { pattern: "rust-toolchain.toml", description: "Rust toolchain configuration" },
      { pattern: ".rustfmt.toml", description: "Rust formatter configuration" },
      { pattern: "clippy.toml", description: "Rust linter configuration" },
    ];
  }

  extractExports(content: string): string[] {
    const exports: string[] = [];
    const re = /^pub\s+(?:unsafe\s+)?(?:fn|struct|enum|trait|type|const|mod|use)\s+(\w+)/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      exports.push(match[1]);
    }
    return exports;
  }

  extractImports(content: string): string[] {
    const imports: string[] = [];

    // use path::to::Item;
    let re = /^use\s+(.+);/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // mod module;
    re = /^mod\s+(\w+);/gm;
    while ((match = re.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return imports;
  }

  recognizeFile(fileName: string): string | undefined {
    if (fileName === "Cargo.toml") return "Rust package manifest";
    if (fileName === "Cargo.lock") return "Rust dependency lockfile";
    if (fileName === "rust-toolchain.toml") return "Rust toolchain configuration";
    return undefined;
  }

  dirPurposeHints(): Record<string, string> {
    return {
      src: "Rust source root",
      "src/bin": "Binary entry points",
      tests: "Integration tests",
      examples: "Usage examples",
      benches: "Benchmarks",
    };
  }
}
