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

## 执行策略

### 增量模式（默认，CLAUDE.md 有 `_git_ref`）

```
1. 读取 CLAUDE.md → 提取 _git_ref
2. git diff ref..HEAD --name-only → 变动文件列表
3. 无变动 → 检查目录树 → 仍无变化则跳过
4. 有变动 → 只扫有变动的文件
5. 更新 _git_ref 到 HEAD
```

**token 节省：** 跳过所有未变更文件的读取和分析。

### 全量模式（`--full` 或首次运行）

完整扫描全部目录结构、分析文件用途、检测技术栈、提取架构规则。

### 快速模式（`--quick`）

读取当前 CLAUDE.md，用 `scan_structure` 获取当前目录树，对比。结构无变化则跳过。

## 回退策略

| 场景 | 行为 |
|------|------|
| 项目不是 git 仓库 | 回退到全量扫描 |
| `_git_ref` 指向的 commit 不存在（rebase 后） | 回退到快速模式（目录树对比） |
| MCP Server 不可用 | 报错中止 |
