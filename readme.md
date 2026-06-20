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

## 🚀 安装

### 方式一：插件市场（推荐）

```bash
# 在 Claude Code 中运行
/plugin marketplace add https://github.com/zihuaiyou/claude-project-map-plugin.git
/plugin install project-map

# 装完直接用
/update-map
```

### 方式二：本地路径

```bash
# 下载
git clone https://github.com/zihuaiyou/claude-project-map-plugin.git
cd claude-project-map-plugin/mcp/project-map-server && pnpm install && cd ..

# 在 Claude Code 中注册
/plugin marketplace add ./path/to/claude-project-map-plugin
/plugin install project-map
```

## 📖 命令

| 命令 | 用途 |
|------|------|
| `/update-map` | 增量更新（默认） |
| `--full` | 强制全量重扫 |
| `--quick` | 仅比对目录树 |
| `--package <name>` | 限子包范围 |

---

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

## 💡 Tips2: 多语言支持

现已支持 **TypeScript / JavaScript + Java、Python、Go、Rust** 五种技术栈的深度分析，覆盖：

| 语言 | 检测方式 | 识别内容 |
| ----- | -------- | -------- |
| TypeScript / JavaScript | package.json / tsconfig.json | 框架、构建工具、导出声明、ESM 导入 |
| Java | pom.xml / build.gradle | 类/接口声明、Maven/Gradle 配置 |
| Python | requirements.txt / setup.py / pyproject.toml | 函数/类导出、依赖列表 |
| Go | go.mod | 导出符号（首字母大写）、模块定义 |
| Rust | Cargo.toml | pub 符号、use 导入、crate 配置 |

---

📐 设计思路见 [docs/design.md](docs/design.md)
