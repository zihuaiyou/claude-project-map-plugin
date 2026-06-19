---
name: project-snapshot
description: 分析项目当前状态并生成快照报告，包括文件统计、TODO/FIXME 检测、最近 git 变更
---

# Project Snapshot 技能

## 指令

当用户要求"分析项目状态"、"生成快照"、"查看项目概览"时，执行以下流程。

### 流程概览

```
用户请求
    │
    ▼
并行收集数据 (Agent)
    ├── Agent A: 文件统计 (Glob)
    ├── Agent B: 标记检测 (Grep)
    ├── Agent C: Git 日志 (Bash)
    │
    ▼
主 Claude 汇总数据
    │
    ▼
生成报告 → 保存快照到记忆 → 输出结果
```

### 步骤 1：并行收集数据

同时派出 3 个子 Agent 收集不同维度的数据：

**Agent A - 文件统计**
- 使用 Glob 统计各类型文件数量
- 找出超过 300 行的大文件
- 排除 `node_modules/`, `.git/`, `dist/`, `.claude/`

**Agent B - 标记检测**
- 使用 Grep 搜索 `TODO`、`FIXME`、`HACK` 标记
- 按文件分组汇总，标注每个标记的位置和行号

**Agent C - Git 日志**
- 使用 `git log --oneline -10` 获取最近 10 条提交
- 使用 `git diff --stat HEAD~3..HEAD` 获取最近变更的文件列表

### 步骤 2：汇总与生成报告

将三个 Agent 的结果整理为结构化报告：

```markdown
## 📸 项目快照 — {project-name}

### 📁 文件统计
| 类型 | 数量 | 行数 |
|------|:----:|:----:|
| .ts  | 42   | 3200 |
| ...

### 🏷️ 标记
- TODO: 12 处（优先处理过期标记）
- FIXME: 3 处
- HACK: 1 处

### 🕐 最近变更 (最近 10 次提交)
- feat: add snapshot skill (2 小时前)
- fix: resolve type error (5 小时前)
- ...

### 📦 大文件 (>300行)
- src/utils/parser.ts (412 行)

### 📊 综合数据
- 项目总文件数: {N}
- 项目总行数: {N}
- 上次快照对比变化: ±N 文件
```

### 步骤 3：保存快照

将报告保存到 `.claude/memory/snapshots/` 目录：
- 文件名: `snapshot-YYYY-MM-DD-HHmm.md`
- 同时更新 `.claude/memory/snapshots/latest.md` 指向最新快照
- 保留最近 10 个快照，超出自动清理最旧的

### 步骤 4：输出结果

向用户展示完整报告，并简要总结关键发现：
- "项目共有 X 个文件，Y 行代码"
- "有 Z 个 TODO 标记需要关注"
- "最近修改集中在 A、B、C 文件"

## 检查清单

- [ ] 派出了 3 个子 Agent 并行收集数据
- [ ] 每个 Agent 都获得了有效结果（非空）
- [ ] 生成了完整报告
- [ ] 快照保存到 memory 目录
- [ ] 清理了超出数量的旧快照
- [ ] 向用户展示了报告和总结

## 工具使用规范

| 工具 | 用途 | 约束 |
|------|------|------|
| `Agent` | 派生子任务并行收集数据 | 只用于只读分析，不执行修改 |
| `Glob` | 统计文件 | 必须排除 node_modules/.git/dist |
| `Grep` | 搜索 TODO/FIXME | 只搜索 src/ 目录，排除 dist |
| `Bash` | 执行 git 命令 | 只运行 `git log`/`git diff`，不修改 git |
| `Write` | 保存快照文件 | 只写 `.claude/memory/snapshots/` 目录 |
| `Read` | 读取上次快照做对比 | 只读，不修改 |

## 边界约束

- **不做任何修改**：本技能只读分析，不修改代码
- **不执行 npm/test/build 命令**：仅限 git 日志查询
- **不分析超过 2000 个文件的项目**（防止超时）
- **如果发现超过 10 个 FIXME，提醒用户优先处理**
- **不访问外部 API**：所有操作在本地完成

## 设计说明（教学注释）

此示例覆盖的知识点：
1. ✅ Skill 文件结构（metadata + 指令 + 检查清单）
2. ✅ 多 Agent 并行（`Agent` tool + 3 个子任务）
3. ✅ 多工具组合（Glob、Grep、Bash、Write、Read）
4. ✅ 文件记忆持久化（`.claude/memory/snapshots/` 目录）
5. ✅ 边界约束（明确什么不能做）
6. ✅ 检查清单确保完整性
7. ✅ 输出格式化（markdown 表格）
8. ✅ 渐进式执行（并行 → 汇总 → 保存 → 输出）
