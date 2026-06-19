# 📋 Project Map — CLAUDE.md 自动维护插件

> **Claude 开局就有项目地图。省 token，守规范。**

---

## 💡 解决两大痛点

### 🔥 痛点 1：新对话盲目扫文件 → 烧 token

无 CLAUDE.md → Claude 不认项目 → 每提需求都盲目读大量无关文件摸索。

**解法：** 自动维护一份精准轻量的 CLAUDE.md（≤200 行）。Claude 开局就知道 Key Files 和架构规则，直接命中目标，不浪费 token。

| 项目规模 | 行数 | 内容 |
| -------- | ---- | ---- |
| 小型 <200 文件 | ≤200 | 关键文件 + 目录 + 规则 |
| 中型 200-1000 | ≤200 | 分组摘要 + 规则 |
| 大型 >1000 | ≤200 | 目录 + 规则 |

### 🏛️ 痛点 2：Claude 不认历史规范 → 代码风格割裂

无 CLAUDE.md → Claude 不知道项目约定、命名规范、架构限制 → 每次生成的代码风格不一致。

**解法：** CLAUDE.md 记录 Architecture Rules（命令式 + 理由），每次对话自动加载。Claude 始终遵循已有设计，不另起炉灶。

### ⚡ 增值：CLAUDE.md 更新本身也省 token

`/update-map` 默认增量模式，只扫描 git 变更文件，跳过 **95-97%** 未改动代码。全量 30 秒 → 增量 5 秒。

## 🚀 快速开始

```bash
cd mcp/project-map-server && pnpm install

# 在 Claude Code 中运行
/update-map              # 智能增量更新
/update-map --full       # 强制全量
/update-map --quick      # 快速更新，仅对比文件树
/update-map --package <name>  # monorepo 子包
```

## 📖 命令速查

| 命令 | 用途 |
|------|------|
| `/update-map` | 增量更新（默认） |
| `--full` | 强制全量重扫 |
| `--quick` | 仅比对目录树 |
| `--package <name>` | 限子包范围 |

## 💡 Tips1: Monorepo 路径导航

`--package <name>` 能生成子包 CLAUDE.md，但 **Claude 启动只读根目录 CLAUDE.md**，不会主动发现子包。需在根 CLAUDE.md 显式列出路径：

```yaml
## Packages
- packages/foo/ — 工具库，规则：纯函数无副作用
- packages/bar/ — API 服务，规则：路由在 index.ts 注册

## Rules
- 涉及 packages/ 下的代码，先读对应包的 CLAUDE.md
```

否则子包 CLAUDE.md 即使存在，Claude 也不会去读。

## 💡 Tips2: 语言生态支持

目前仅支持 **JavaScript / TypeScript** 生态。Java、Python、Go、Rust 等项目可正常使用目录扫描和文件结构功能，但**技术栈检测、关键文件识别、导出分析**等功能暂不支持。

对应设计文档中 [9.3 多语言栈深度分析](docs/design.md#93-多语言栈深度分析) 迭代计划。

---

📐 设计思路见 [docs/design.md](docs/design.md)
