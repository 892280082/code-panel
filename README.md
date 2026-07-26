# Code Panel — Claude Skill

> **日志查看 + SQL 执行面板**，这是一个 Claude Code Skill，放置在用户级 `~/.claude/skills/` 目录下。

## 这是什么？

一个本地运行的面板工具，提供两大核心功能：

| 功能 | 路径 | 用途 |
|------|------|------|
| **📋 日志查看器** | `http://localhost:3008/log` | 实时追踪日志文件、分组管理、端口存活检测、SSE 实时推送 |
| **🗄️ SQL 执行面板** | `http://localhost:3008/sql` | SQL 查询/审批、多数据库连接管理、审批铃声提醒、AI 查询历史记录 |

## 一键启动

```bash
bash ~/.claude/skills/code-panel/read-log.sh
```

启动脚本会自动完成：
1. ✅ 安装后端 Node.js 依赖
2. ✅ 安装前端 Vue 3 依赖
3. ✅ 构建前端（仅首次或代码变更后）
4. ✅ 启动服务 → 自动打开浏览器

如果是首次使用，确保已安装 Node.js >= 18。

## 面板截图

```
┌──────────────────────────────────────────────────┐
│  [🛡 Review Mode: ON] [↻ Refresh]  Token: a1b2c3  │
├──────────────┬───────────────────┬───────────────┤
│  proj ▼      │                   │  📋 AI 查询   │
│              │   SQL 详情区域     │  ✅ 审批记录   │
│  ● opencode  │                   │  🔔           │
│  ● zc-main   │                   │               │
│  ● zc-exam   │                   │               │
├──────────────┤                   │               │
│ PENDING│DONE │                   │               │
│ job list...  │                   │               │
└──────────────┴───────────────────┴───────────────┘
```

## 给 AI 的说明

这是一个 **Claude Code Skill**，位于用户 `~/.claude/skills/code-panel/` 下。

- Skill 元数据在 [`SKILL.md`](SKILL.md) 中定义
- 启动脚本来 [`read-log.sh`](read-log.sh)
- 后端代码 `src/`，前端代码 `frontend/src/`

### AI 使用该 Skill 的行为规则

详见 [`SKILL.md`](SKILL.md#-ai-绝对行为规范严格遵守)，核心要点：

| 操作 | 评审模式 ON | 评审模式 OFF |
|------|-----------|------------|
| **SELECT 查询** | ✅ AI 可直接调用 | ✅ AI 可直接调用 |
| **写入操作** | ❌ 只能提交到队列，通知用户审批 | ✅ 可直接执行 |
| **审批/拒绝** | 🚫 **AI 绝对禁止**（只有管理员可以） | — |
| **开关评审模式** | 🚫 **AI 绝对禁止** | — |

> 每次 SQL 操作都需提供 `title`（标题）说明原因。
> 评审模式下有新的待审批 SQL 时，浏览器会持续叮叮提醒，直到管理员处理完毕。

## 技术栈

- **后端**: Node.js + Express 5 + TypeScript (tsx)
- **前端**: Vue 3 + Pinia + Vue Router + Vite
- **数据库**: MySQL（连接执行）/ SQLite（本地配置存储）
- **实时推送**: SSE (Server-Sent Events)

## 端口

服务运行在 **3008 端口**，可通过修改 `src/server.ts` 中的 `PORT` 变更。

## 项目结构

```
code-panel/
├── SKILL.md              # Skill 元数据 + AI 行为规范
├── read-log.sh            # 一键启动脚本
├── config.json            # 仅存储 reviewMode
├── sql-queue.json         # SQL 审批队列
├── sql-history.json       # AI 查询历史记录
├── src/                   # 后端源码
│   ├── server.ts          # Express 服务入口
│   ├── routes/            # API 路由
│   │   ├── logs.ts        # 日志相关
│   │   ├── sql-exec.ts    # SQL 查询/提交
│   │   ├── sql-review.ts  # SQL 审批
│   │   ├── sql-history.ts # 查询历史
│   │   └── databases.ts   # 数据库连接管理
│   ├── db/                # 数据库层
│   │   ├── connector.ts   # MySQL/SQLite 连接器
│   │   └── db-config-store.ts  # 连接配置 SQLite 存储
│   ├── sql-queue.ts       # 审批队列存储
│   └── sql-history.ts     # 历史记录存储
├── data/                  # SQLite 数据文件
│   └── db-config.sqlite   # 数据库+日志配置
└── frontend/              # 前端源码
    └── src/
        ├── views/         # 页面组件
        ├── stores/        # Pinia 状态管理
        ├── components/    # 通用组件
        └── composables/   # 组合式函数
```
