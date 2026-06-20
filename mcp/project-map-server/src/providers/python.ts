import fs from "node:fs";
import path from "node:path";
import type { LanguageProvider, LanguageInfo, ConfigPattern } from "./types.js";

const PY_LANG: LanguageInfo = {
  name: "Python",
  extensions: [".py"],
  detectionFiles: ["requirements.txt", "setup.py", "pyproject.toml", "setup.cfg"],
  namingConvention: "snake_case",
};

export class PythonProvider implements LanguageProvider {
  readonly language = PY_LANG;

  detect(rootPath: string): boolean {
    return PY_LANG.detectionFiles.some((f) => fs.existsSync(path.join(rootPath, f)));
  }

  sourceGlobs(): string[] {
    return ["**/*.py"];
  }

  configFiles(): ConfigPattern[] {
    return [
      { pattern: "requirements.txt", description: "Python dependency list" },
      { pattern: "setup.py", description: "Python package setup script" },
      { pattern: "pyproject.toml", description: "Python project configuration (PEP 621)" },
      { pattern: "setup.cfg", description: "Python package configuration" },
      { pattern: "Pipfile", description: "Pipenv dependency specification" },
      { pattern: "mypy.ini", description: "MyPy type checker configuration" },
      { pattern: ".flake8", description: "Flake8 linter configuration" },
    ];
  }

  extractExports(content: string): string[] {
    const exports: string[] = [];

    // __all__ list
    const allMatch = content.match(/__all__\s*=\s*\[([^\]]+)\]/);
    if (allMatch) {
      const items = allMatch[1].match(/['"]([^'"]+)['"]/g);
      if (items) {
        items.forEach((i) => exports.push(i.replace(/['"]/g, "")));
        return exports;
      }
    }

    // Public functions/classes (no underscore prefix)
    const re = /^(?:async\s+)?(?:def|class)\s+([^_\s][^\s(/:]*)/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      if (!match[1].startsWith("_")) {
        exports.push(match[1]);
      }
    }
    return exports;
  }

  extractImports(content: string): string[] {
    const imports: string[] = [];

    // import X
    let re = /^import\s+(\S+)/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      imports.push(match[1].split(/\s+as\s+/)[0]);
    }

    // from X import Y
    re = /^from\s+(\S+)\s+import/gm;
    while ((match = re.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return imports;
  }

  recognizeFile(fileName: string): string | undefined {
    if (fileName === "requirements.txt") return "Python dependency list";
    if (fileName === "setup.py") return "Python package setup script";
    if (fileName === "pyproject.toml") return "Python project configuration";
    if (fileName === "setup.cfg") return "Python package configuration";
    if (fileName === "Pipfile") return "Pipenv dependency specification";
    return undefined;
  }

  dirPurposeHints(): Record<string, string> {
    return {
      src: "Python source root",
      tests: "Test suite root",
      docs: "Documentation",
    };
  }
}
