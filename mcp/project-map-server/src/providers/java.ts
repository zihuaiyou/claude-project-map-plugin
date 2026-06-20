import fs from "node:fs";
import path from "node:path";
import type { LanguageProvider, LanguageInfo, ConfigPattern } from "./types.js";

const JAVA_LANG: LanguageInfo = {
  name: "Java",
  extensions: [".java"],
  detectionFiles: ["pom.xml", "build.gradle"],
  namingConvention: "PascalCase",
};

export class JavaProvider implements LanguageProvider {
  readonly language = JAVA_LANG;

  detect(rootPath: string): boolean {
    return JAVA_LANG.detectionFiles.some((f) => fs.existsSync(path.join(rootPath, f)));
  }

  sourceGlobs(): string[] {
    return ["**/*.java"];
  }

  configFiles(): ConfigPattern[] {
    return [
      { pattern: "pom.xml", description: "Maven build configuration" },
      { pattern: "build.gradle", description: "Gradle build configuration" },
      { pattern: "build.gradle.kts", description: "Gradle Kotlin DSL build configuration" },
      { pattern: "settings.gradle", description: "Gradle settings" },
      { pattern: "gradlew", description: "Gradle wrapper script" },
    ];
  }

  extractExports(content: string): string[] {
    const exports: string[] = [];
    const re = /(?:public\s+)?(?:class|interface|enum|@interface|record)\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      exports.push(match[1]);
    }
    return [...new Set(exports)];
  }

  extractImports(content: string): string[] {
    const imports: string[] = [];
    const re = /^import\s+(?:static\s+)?([\w.*]+);/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      imports.push(match[1]);
    }
    return imports;
  }

  recognizeFile(fileName: string): string | undefined {
    if (fileName === "pom.xml") return "Maven build configuration";
    if (fileName === "build.gradle" || fileName === "build.gradle.kts") return "Gradle build configuration";
    if (fileName === "settings.gradle") return "Gradle settings";
    return undefined;
  }

  dirPurposeHints(): Record<string, string> {
    return {
      "src/main/java": "Java source root",
      "src/test/java": "Java test root",
      "src/main/resources": "Application resources",
    };
  }
}
