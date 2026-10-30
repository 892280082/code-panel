# 09 · 终端:ttyd / tmux / 命令抽屉

> 负责:网页终端(iframe 内 ttyd)、tmux 持久会话、命令抽屉按钮、终端 HTTP 代理。
> 关键文件:`src/terminal/ttyd-manager.ts`、`tmux-manager.ts`、`proxy.ts`、`command-store.ts`、`src/routes/terminal.ts`、`tmux.ts`、`frontend/src/components/CommandDrawer.vue`、`TerminalPanel.vue`、`FloatingTerminal.vue`、`TmuxSessionsTab.vue`、`stores/terminal.ts`、`composables/useFabChips.ts`。

## 1. 端口结构

| 端口 | 归属 | 生命周期 |
|---|---|---|
| 9001 | FAB 浮动终端(持久 ttyd session) | 面板存活期 |
| 9002-9011 | 命令终端池(页面级) | 页面关闭即回收 |
| 9020-9029 | tmux 接入池(ttyd attach 到已有 tmux) | 断开即销毁通道,可随时重连 |

**启动清理**:面板启动时清理上个进程遗留的 9002-9011 孤儿 ttyd(systemd `ExecStartPre` 只清 3008/9001)。

## 2. ttyd 管理

`ttyd-manager.ts`:

- `startTTYD()`:拉起 9001 持久终端
- 命令终端:`allocateCmdPort()` 从池中取空闲 → spawn ttyd → 记录 `port → {pid, session}`
- 页面关闭/超时 → 杀掉 ttyd,**不杀 tmux 会话**(tmux 由用户决定)
- 池满 → 明确报错(`No available ports in pool`),前端提示"先关一些终端"

## 3. tmux 管理

`tmux-manager.ts`:

- 枚举:`tmux list-sessions -F ...` 解析 `name|windows|created|attached|path`
- 创建:`tmux new-session -d -s <name> -c <cwd>`
- 接入:为已有会话分配 9020-9029 端口,spawn `ttyd tmux attach -t <name>`
- 断开:杀 ttyd attach,保留 tmux 会话
- **会话名白名单**:创建/attach/删除前校验(`[A-Za-z0-9._-]` 等),防命令注入
- 启动恢复:`restoreTmuxSessions()` 把上次的接入信息恢复

> 前端 `Ctrl+1` 切换所有 tmux 窗口的显示;状态存在 `stores/terminal.ts`。

## 4. 代理

`proxy.ts`:

- `terminalProxyMiddleware`:按端口/路径把 HTTP 请求转发到对应 ttyd(iframe 用)
- WebSocket 升级单独处理;JWT 校验(iframe 可通过 `?token=` 带)
- `mountTerminalProxy()` 在 server 启动时挂载

## 5. 命令抽屉

`command-store.ts` + `commands.yaml`:

```yaml
commands:
  - { id: deploy, label: 部署, command: "bash deploy.sh", cwd: ?, subgroup: 发布 }
```

- 系统预设是面板常量(不入文件);项目自定义来自 yaml
- `POST /api/terminal/sessions` 建页面级命令终端,执行 `command`
- 支持子分组 `subgroup`、重排序、隐藏分组(`/api/terminal/subgroup-hidden`)

## 6. 接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/terminal/status` | 端口池状态 |
| POST/GET/DELETE | `/api/terminal/sessions[/:port]` | 页面命令终端创建/列表/关闭 |
| GET | `/api/terminal/commands?project=` | 命令按钮(系统 + 项目) |
| POST/PUT/DELETE | `/api/terminal/commands[/:id]` | 增改删(写回 commands.yaml) |
| PUT | `/api/terminal/commands/reorder` | 排序 |
| GET/PUT | `/api/terminal/subgroup-hidden` | 分组隐藏设置 |
| GET | `/api/terminal/tmux/list?project=` | tmux 会话列表 |
| POST | `/api/terminal/tmux/create` | 新建会话 `{name,cwd}` |
| POST | `/api/terminal/tmux/attach` | 接入会话 → 返回端口 |
| DELETE | `/api/terminal/tmux-sessions/:port` | 断接入 |
| DELETE | `/api/terminal/tmux/:name` | 彻底删除会话 |

## 7. 前端结构

| 组件 | 职责 |
|---|---|
| `CommandDrawer.vue` | 右下 FAB + 抽屉(命令/历史/会话三 Tab) |
| `TerminalPanel.vue` | iframe 终端窗口(拖拽/缩放/最小化/编号) |
| `FloatingTerminal.vue` | 单终端容器 |
| `TmuxSessionsTab.vue` | tmux 会话列表/新建/接入/删除 |
| `TmuxCaptureModal.vue` | 抓取会话屏幕文本 |
| `stores/terminal.ts` | 窗口状态、attach、最小化、恢复、快捷键 |
| `composables/useFabChips.ts` | FAB 拖拽与芯片联动 |

## 8. 扩展指南

### 给命令终端加"预设参数"

- `commands.yaml` 里用 button 的 `command` 即可,不必改代码
- 若需要参数输入框:在 `command-store.ts` 加字段,前端加表单,执行前拼接(**做 shell 引号转义**)

### 加一个"终端录制/回放"

- ttyd 不支持录制,需在 tmux `pipe-pane` 侧做
- 录制文件放项目 `data/`,前端加播放器

### 换终端内核(例如 xterm.js + node-pty)

- 影响面大:代理中间件、端口池、iframe 全部要换
- 建议新开模块并行跑,不要原地替换

## 9. 常见坑

- **端口池泄漏**:异常退出会留下孤儿 ttyd,启动清理必须保留
- **命令注入**:会话名/命令参数一律白名单或严格转义
- **tmux 会话名**:物理名带项目前缀 `p_<pid>_<name>`,UI 用短名
- **iframe 不能带头**:JWT 用 `?token=`;注意 URL 日志泄露(本地面板可接受)
- **关页面 ≠ 关 tmux**:用户回到面板应能重新 attach(状态要持久化)
- **ttyd 排查要带 WS 客户端**:裸 HTTP 探测会误判

## 10. 相关速查

接口清单:`references/api-reference.md` 的「终端 / 文件 / 备份 / nginx / 全局」节。
