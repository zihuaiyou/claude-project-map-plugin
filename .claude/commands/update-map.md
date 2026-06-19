---
name: update-map
description: 更新/刷新项目结构地图 (CLAUDE.md)，手动触发 project-map skill
---

# /update-map 命令

## 用法

| 命令 | 效果 |
|------|------|
| `/update-map` | 全量更新：重新扫描全部项目结构并刷新 CLAUDE.md |
| `/update-map --quick` | 快速增量：读取当前 CLAUDE.md，只检查变更的文件并更新 |

## 执行流程

### 全量模式（默认）

1. 调用 `project-map` Skill 的完整流程
2. 扫描全部目录结构、分析文件用途、检测技术栈
3. 生成 ≤ 200 行的 CLAUDE.md
4. 报告变更摘要

### 快速模式（`--quick`）

1. 读取当前 CLAUDE.md
2. 使用 MCP `scan_structure` 获取当前目录树
3. 与 CLAUDE.md 中的结构对比
4. 如果结构无变化 → 提示「项目结构无变化，无需更新」
5. 如果有变化 → 只更新变化的部分，保留已知信息
