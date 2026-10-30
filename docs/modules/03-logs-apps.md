# 03 · 应用服务:日志 + 启停

> 负责:按平台展示应用服务卡片、实时日志(SSE)、端口存活探测、一键启动/停止。
> 关键文件:`src/log-monitor.ts`、`src/routes/logs.ts`、`src/terminal/ttyd-manager.ts`(oneshot)、`frontend/src/views/LogView.vue`、`stores/logs.ts`、`components/LogTabsPane.vue`、`LogPlatformCard.vue`。

## 1. 配置:`apps.yaml`

```yaml
platforms:
  - name: 主平台                 # 分组名(侧栏标题)
    backend:                     # 后端列
      - name: main
        file: .logs/main.log     # 日志文件(相对项目根;面板补绝对)
        port: 7123               # 端口(圆点存活探测;可省)
        start: "bash scripts/start.sh main"   # 启动脚本(可省 = 纯状态点)
        stop:  "bash scripts/stop.sh main"
    frontend:                    # 前端列(结构同 backend)
      - name: main-web
        file: .logs/web.log
        port: 7124
```

- 兼容旧名 `logs.yaml`
- 无 `start/stop` → 只是状态点,点行打开日志页
- 字段读取与默认值在 `src/projects/yaml.ts` 的 `LogsFile` 类型

## 2. 日志采集(SSE)

`src/log-monitor.ts`:

- 轮询/监听各服务的 `file`,维护"最近 N 行"缓冲与增量
- `GET /api/stream?project=&token=` 建立 SSE,推送 `{type:'log'|'port'|...}`
- 前端 `stores/logs.ts`:按文件维度管理打开页签、行数、活动心跳(3 秒)

其他日志接口:

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/logs?project=` | 服务清单 + `alive/active/size` |
| GET | `/api/log/content?project=&file=` | 读某服务日志(**只允许清单内的文件**) |
| POST | `/api/log/clear?project=` | 清空日志文件 |

> 安全要点:`file` 必须校验在 `apps.yaml` 清单内,防止任意文件读取。

## 3. 启停 = 一次性终端(oneshot)

点「启动」→ 面板开一个**一次性 ttyd 会话**(页面级,不在 9001/9002 池)执行 `start` 命令:

- 2 秒内点中大窗 → 保留窗口看慢启动日志;不点 → 自动收成 chip,20 秒回收
- 脚本被杀 = 服务秒死,所以 **start/stop 脚本必须自己保活**(见下)

### 脚本保活三要素(写配置前必读)

```bash
trap '' HUP                       # ① 免疫会话关闭的 SIGHUP
daemonize() {                     # ② 真正脱离终端(setsid + exec)
  python3 -c '
import os, sys
if os.fork() != 0: os._exit(0)
os.setsid()
os.execvp(sys.argv[1], sys.argv[1:])
' "$@"
}
start_x() {
  kill_port 7123                  # 先清端口
  cd "$ROOT/app" || return 1
  echo "--- x (7123) ---" >> "$ROOT/.logs/x.log"
  daemonize java -jar app.jar >> "$ROOT/.logs/x.log" 2>&1 &   # ③ 日志重定向到 apps.yaml 的 file
}
```

验收:面板点启动 → 不碰大窗 → 20 秒后端口仍存活、日志持续滚动。

## 4. 前端结构

| 组件 | 职责 |
|---|---|
| `views/LogView.vue` | 页面骨架:左平台卡 + 右日志区 |
| `components/LogPlatformCard.vue` | 单平台卡片(后端/前端两列、状态圆点、右键菜单) |
| `components/LogTabsPane.vue` | 日志页签(打开/关闭/ANSI 三模式 strip/raw/color) |
| `components/TerminalPanel.vue` | iframe 终端窗口(oneshot 与 tmux 共用) |
| `stores/logs.ts` | 页签、内容、活动心跳、自动滚动 |

渲染日志时用 `composables/useAnsi.ts` 处理 ANSI 颜色,避免 XSS(先转义再加 span)。

## 5. 扩展指南

### 加一类服务(例如"定时任务")

- 在 `apps.yaml` 的平台卡里加一列(需要改类型 + 前端渲染)
- 或独立成新模块:见 [13-how-to-add-a-module.md](13-how-to-add-a-module.md)

### 改日志采集方式(例如读 journald)

- 在 `src/log-monitor.ts` 里加数据源,保持输出接口不变(`{file, lines}`)
- 前端无需改动

### 给服务加"最近错误高亮"

- 在 `stores/logs.ts` 的渲染管线加一层过滤(注意大日志性能:只处理可视窗口)

## 6. 常见坑

- **`file` 路径必须相对项目根**(写绝对路径会在换机器后失效)
- **端口探测**用 TCP connect,不要用 HTTP(服务可能只监听内网/非 HTTP)
- **oneshot 的 SIGHUP 坑**:不 `trap '' HUP` 就会出现"点了启动,日志只有一行分隔线,服务秒死"
- **ttyd 链路排查必须带 WebSocket 客户端**:裸 curl ttyd 会出现"命令从未执行"的假象
- 日志文件被轮转/截断时,SSE 要能重开(见 `log-monitor.ts` 的 size 回退逻辑)

## 7. 相关速查

- 生命周期细节:`references/apps-lifecycle.md`
- 接口清单:`references/api-reference.md` 的「Apps / 日志 / 资源」节
