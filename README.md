# Code Panel (v3) — Claude Skill

> **多项目运维控制面板**:JWT 登录 + 每项目 `.code-panel` 配置文件 + 应用服务实时日志与启停 + SQL 评审 + Git + PRD + 命令终端 + tmux 持久会话 + 云文件 + 快捷方式 + 自动备份。Claude Code Skill,位于 `~/.claude/skills/code-panel/`。

## 快速上手

```bash
bash ~/.claude/skills/code-panel/start.sh      # 安装依赖 + 构建前端 + 启动(3008)
open http://localhost:3008                      # 登录:demo / change-me(首启由 config.json credentials 播种)
```

登录后左上 ⚙ 配置「项目」切换/添加项目。每个项目根目录维护 `.code-panel/`(apps.yaml、sql.yaml、prd.yaml、git.yaml、commands.yaml、links.yaml + uploads/downloads + data/),**配置文件提交式随仓库走、可手改、修改即生效**。

## 功能入口

| 功能 | 路径 |
|------|------|
| 应用服务日志 + 启停(Apps,按平台卡) | `/log` |
| SQL 查询 / 审批 / 历史 | `/sql` |
| 项目内 Git(diff/历史/文件浏览) | `/git` |
| PRD 文档(MD→HTML + 原型 iframe + 完成态) | `/prd` |
| ⚙ 配置(项目 / 备份 / 文件 / 账号) | 左上 ⚙ |
| 右上常驻:快捷方式 Quick Links + 系统资源圆环 | 各页右上 |
| 右下 💻 命令终端 + tmux 会话 + ☁ 云文件 + 📂 仓库浏览 | 各页浮动 |

## 存储(严格两层)

- **全局唯一库** `~/.code-panel/data.db`(users 账号 / projects 注册表,含中文备注 note / settings 公共配置)+ `jwt.secret`;`CODE_PANEL_HOME` 可覆盖根目录。
- **项目** `<项目根>/.code-panel/`:`apps.yaml`(应用服务,旧 `logs.yaml` 兼容)`sql.yaml` `prd.yaml` `git.yaml` `commands.yaml`(自定义命令)`links.yaml`(快捷方式)→ 配置,提交式;**改文件即生效**;`uploads/` `downloads/`(☁,gitignore)与 `data/`(SQL 历史/队列、PRD 完成态、tmux 备注、cloud-config.json;gitignore)为运行时数据。
- 加日志/库/命令/快捷方式/PRD/git = 编辑项目里对应 yaml(顶部注释就是字段说明),无需面板配置 API。
- 旧中央 sqlite 分组(proj/… 等)已废弃;旧数据可从 `backup-*.tar.gz` 查回。

## 认证

- JWT 保护除 `/api/auth/login` 外全部 `/api/*`;令牌三通道:Bearer 头 / `?token=`(SSE/iframe/下载)/ `cp_auth` cookie。
- 「记住我」= 记住登录态(localStorage);不勾 = sessionStorage(关标签登出)。错误 14 次锁定。

## 给 AI 的说明

- Skill 元数据与**完整 API 清单、存储模型、AI 行为规范**见 [`SKILL.md`](SKILL.md)。
- 数据库写入在 Review Mode 下必须 `/api/sql/submit` 进队列并通知用户审批;**AI 禁止自行审批/拒绝/开关评审模式**。
- 项目级接口记得带 `?project=<id>`。

## 技术栈 / 端口

- 后端 Node + Express 5 + TS(tsx);前端 Vue 3 + Pinia + Vue Router + Vite;sql.js 全局库;js-yaml 配置;MySQL/SQLite 连接。
- 服务 3008;ttyd 终端 9001 + 页面终端 9002-9011 + tmux 接入 9020-9029。

## 结构

```
code-panel/
├── SKILL.md            # 元数据 + 存储模型 + API + PRD 规范 + AI 行为
├── start.sh            # 一键启动
├── config.json         # credentials(首启播种账号)+ 默认 reviewMode
├── src/
│   ├── server.ts       # Express 入口(auth → 代理 → 路由)
│   ├── auth/           # jwt / lockout / routes-auth
│   ├── db/global-store.ts   # ~/.code-panel/data.db(users/projects/settings)
│   ├── projects/       # yaml 骨架/读写、相对路径规则、sql 运行数据、请求项目上下文
│   ├── paths.ts        # 全局路径统一解析
│   ├── terminal/       # ttyd / tmux / 命令终端 proxy(JWT 收紧)
│   ├── launch/         # 旧快捷启动(已被 links.yaml 取代)
│   ├── backup/         # 全局库 + 各项目 .code-panel 打包
│   └── routes/
├── frontend/src/       # views / stores / components / composables
├── templates/prd/      # PRD 目录模板(复制即用)
└── references/         # PRD 编写规范等
```
