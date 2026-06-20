# Project Map

_上次更新: 2026-06-20 | 架构版本: 2 | _git_ref: ae1b91d_

## Tech Stack

- Language: TypeScript 5.x (JS/TS 内置) + Java/Python/Go/Rust (LanguageProvider)
- Build: tsc
- PM: pnpm
- Runtime: Node.js

## Directory Structure
```
├── .claude/
│   ├── skills/          # Skill 编排指令
│   ├── commands/        # Slash 命令定义
│   └── settings.json    # MCP Server 注册
├── mcp/project-map-server/
│   └── src/
│       ├── index.ts     # 入口，创建 server，注册 handlers
│       ├── scan.ts      # scan_structure：递归扫描目录树
│       ├── analyze-files.ts  # analyze_key_files：读文件推断用途
│       ├── detect-stack.ts   # detect_stack：检测技术栈+语言
│       ├── arch-patterns.ts  # extract_arch_patterns：命名/导入
│       ├── types.ts     # 共享类型（含 StackInfo.languages）
│       └── providers/   # LanguageProvider 体系
│           ├── types.ts     # 接口定义
│           ├── registry.ts  # 注册表，供工具遍历
│           ├── java.ts      # Java 检测（pom.xml/build.gradle）
│           ├── python.ts    # Python 检测（requirements.txt/setup.py）
│           ├── go.ts        # Go 检测（go.mod）
│           └── rust.ts      # Rust 检测（Cargo.toml）
├── examples/
│   └── mixed-lang-demo/  # Java+Python 混合验证示例
├── docs/                # 设计文档
└── .superpowers/        # SDD 任务文件
```

## Key Files

- `.claude/skills/project-map.md` — 核心 Skill：编排全量/增量/快速/包级流程
- `mcp/project-map-server/src/index.ts` — MCP 入口，注册 4 个 tool handlers
- `mcp/project-map-server/src/providers/registry.ts` — Provider 注册表，供所有工具遍历
- `mcp/project-map-server/src/providers/types.ts` — LanguageProvider 接口（6 方法）
- `mcp/project-map-server/src/scan.ts` — scan_structure：递归目录树扫描
- `mcp/project-map-server/src/detect-stack.ts` — detect_stack：多语言技术栈检测

## Architecture Rules

- MCP Server 只读不写。理由：读写分离，写入由 Skill 用 Write 工具完成。
- 所有 MCP tool 的 rootPath 由 Skill 按 --package 动态计算。理由：同一套 tool 支持根目录和子包扫描。
- 离线增量式更新（git diff ref..HEAD）。理由：只分析变更文件，节省 token。
- CLAUDE.md 不得超 200 行。理由：保持上下文轻量。
- LanguageProvider 接口模式：每种语言独立模块，通过 registry 注册。理由：新增语言无需改工具代码，只需创建 Provider 文件。

## Conventions

- MCP Server 按职责拆模块（scan / analyze / detect / arch / providers / types），index.ts 只做编排
- 文件导出命名：handleXxx 为 handler 函数，XXX_TOOL 为 tool schema 常量
- Provider 实现类命名：XxxProvider，统一在 registry.ts 注册
- ESModule（type: "module"），显式 .js 扩展名导入
