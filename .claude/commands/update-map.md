---
name: update-map
description: 更新/刷新项目结构地图 (CLAUDE.md)，手动触发 project-map skill
---

# /update-map 命令

## 用法

| 命令 | 效果 |
|------|------|
| `/update-map` | 智能更新：有 `_git_ref` 则增量，否则全量 |
| `/update-map --full` | 强制全量：忽略 `_git_ref`，完整重扫 |
| `/update-map --quick` | 快速比对：目录树对比，无变化则跳过 |
| `/update-map --package <name>` | 限定到子包：处理 `packages/<name>/` 或 `apps/<name>/` |
| `/update-map --package foo --quick` | 包级快速模式 |

`--package` 将范围限定到 monorepo 的单个子包：
- MCP 调用限定到包目录
- git diff 限定到包路径
- CLAUDE.md 写入到包目录（非根目录）

## 执行策略

### 增量模式（默认）

扫描 targetFile 提取 `_git_ref` → git diff 获变更文件 → 只分析变更文件。

### 全量模式（`--full`）

完整扫描目标路径的全部文件。

### 快速模式（`--quick`）

目录树对比，无变化则跳过。

### 包级模式（`--package`）

目标路径从根目录切换到子包目录。

## 回退策略

| 场景 | 行为 |
|------|------|
| 项目不是 git 仓库 | 全量扫描 |
| `_git_ref` commit 不存在（rebase） | 快速模式 |
| `--package <name>` 路径不存在 | 报错并列出可用包 |
| MCP Server 不可用 | 报错中止 |
