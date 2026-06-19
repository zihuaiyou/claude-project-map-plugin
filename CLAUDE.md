# Project Map

_上次更新: 2026-06-19 | 架构版本: 1 | _git_ref: d7c9b8f_

## Tech Stack
- Language: TypeScript 5.x
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
│   └── src/             # MCP Server 源码（7 模块）
├── docs/                # 设计文档
└── .superpowers/        # SDD 任务文件
```

## Key Files
- `.claude/skills/project-map.md` — 核心 Skill：编排全量/增量/快速/包级流程，调用 MCP tools，生成 CLAUDE.md
- `.claude/commands/update-map.md` — 手动触发入口，支持 --full / --quick / --package 参数
- `mcp/project-map-server/src/index.ts` — 入口，创建 server，注册 tool/resource handlers
- `mcp/project-map-server/src/scan.ts` — scan_structure tool：递归扫描目录树
- `mcp/project-map-server/src/analyze-files.ts` — analyze_key_files tool：读文件推断用途
- `mcp/project-map-server/src/detect-stack.ts` — detect_stack tool：检测技术栈
- `mcp/project-map-server/src/arch-patterns.ts` — extract_arch_patterns tool：分析命名/导入
- `mcp/project-map-server/src/resources.ts` — MCP Resource：暴露 packages/*/CLAUDE.md

## Architecture Rules
- MCP Server 只读不写。理由：读写分离，写入由 Skill 用 Write 工具完成。
- 所有 MCP tool 的 rootPath 由 Skill 按 --package 动态计算。理由：同一套 tool 支持根目录和子包扫描。
- 离线增量式更新（git diff ref..HEAD）。理由：只分析变更文件，跳过不变部分，节省 token。
- CLAUDE.md 不得超 200 行。理由：保持上下文轻量，压缩规则由 Skill 强制执行。

## Conventions
- MCP Server 按职责拆模块（scan / analyze / detect / arch / resources），index.ts 只做编排
- 文件导出命名：handleXxx 为 handler 函数，XXX_TOOL 为 tool schema 常量
- ESModule（type: "module"），显式 .js 扩展名导入
