---
name: snapshot
description: 显示最近的项目快照，或生成新快照（加 -n 参数）
---

# /snapshot 命令

## 功能

显示最近保存的项目快照报告，或者生成新快照。

## 用法

| 命令 | 效果 |
|------|------|
| `/snapshot` | 显示最新保存的快照 |
| `/snapshot -n` | 生成新的快照并显示 |
| `/snapshot -l` | 列出所有历史快照 |
| `/snapshot -d 2` | 显示指定编号的历史快照（配合 -l 查看编号） |

## 执行流程

### 模式 1：显示最近快照（默认）

1. 读取 `.claude/memory/snapshots/latest.md`
2. 展示快照内容
3. 显示快照时间和相对现在的时间差

### 模式 2：生成新快照（`-n`）

1. 调用 `project-snapshot` Skill 的完整流程
2. 等待结果并展示

### 模式 3：列出历史快照（`-l`）

1. 使用 Glob 列出 `.claude/memory/snapshots/snapshot-*.md`
2. 按时间倒序排列
3. 显示编号、日期、文件大小

### 模式 4：查看指定快照（`-d N`）

1. 使用 Glob 列出快照文件
2. 按时间排序后取第 N 个
3. 展示其内容

## 设计说明（教学注释）

此命令覆盖的知识点：
1. ✅ Slash Command 基本结构（metadata + 指令）
2. ✅ 参数传递（`-n`, `-l`, `-d N`）
3. ✅ 与 Skill 组合（`-n` 模式复用 project-snapshot Skill）
4. ✅ 读取持久化数据（latest.md）
5. ✅ 简单的条件分支（4 种模式）
