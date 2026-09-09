# Apps 应用服务:apps.yaml 配置 + 启停生命周期 + 保活铁律

## apps.yaml 字段(一模块一文件,改完即生效)

```yaml
platforms:
  - name: 主平台                # 分组名(侧栏标题)
    backend:                   # 后端列
      - name: main
        file: .logs/main.log   # 日志文件(相对项目根,面板补绝对)
        port: 7123             # 端口(圆点存活探测;可省)
        start: "bash .claude/skills/fast-start/start.sh start main"   # 启动脚本(可省=纯状态点)
        stop:  "bash .claude/skills/fast-start/start.sh stop main"    # 停止脚本(可省)
    frontend: [ …同款… ]
```

- 每平台一张卡,后端/前端两列;**行右侧圆点 = 启停按钮**(有 start/stop 时;无脚本则纯状态点,点行开日志页);右键弹启停菜单
- 旧名 `logs.yaml` 兼容回退

## 启停 = 一次性终端(oneshot, keepShell=false)

点「启动」= 面板在一次性 ttyd 终端里执行 start 命令:

- **2s 内点中大窗** = 激活 → 窗口一直保留(看后端慢启动实时日志),手动 ✕ 才关
- **2s 内没点** → 自动收起成日志页工具栏左上 chip;点 chip 跳该服务日志页;20s 自动回收
- ⚠ 一次性会话跑完即结束,激活保留主要给后端慢启动看过程
- 右下终端的 1/2/3 数字条只列 tmux 常驻会话;oneshot 与手动命令终端不占数字

## ⚠ start/stop 脚本必须自己保活(AI 写配置前必读)

会话关闭时的 SIGHUP 会把脚本里刚 fork 的服务进程**连带杀掉** —— 现象:「点了启动,日志只有一行分隔线,服务秒死、端口永远起不来」。三要素缺一不可:

1. **脚本顶部 `trap '' HUP`** —— 整个 shell 及子进程免疫会话关闭信号
2. **daemonize 启动服务**(python 单 fork + setsid + execvp,脱离终端会话),不能裸 `cmd &`
3. **日志重定向到文件**(相对项目根,与 apps.yaml 的 `file` 一致)

标准写法(参考任意已跑通项目的 `fast-start/scripts/lib.sh`):

```bash
trap '' HUP                       # ⭐ 必须有
daemonize() {
    python3 -c '
import os, sys
if os.fork() != 0: os._exit(0)
os.setsid()
os.execvp(sys.argv[1], sys.argv[1:])
' "$@"
}
start_xxx() {
    kill_port <port>
    cd "$ROOT/<dir>" || return 1
    echo "--- xxx (<port>) ---" >> "$ROOT/.logs/xxx.log"
    daemonize <启动命令> >> "$ROOT/.logs/xxx.log" 2>&1 &
}
```

**验收**:面板点启动 → 不碰大窗让它收起/回收 → 端口仍存活(圆点变绿)、日志持续滚动。

**排查 ttyd 链路必须带 WebSocket 客户端连接** —— ttyd 是每个客户端连接时才执行一次命令,裸起 ttyd 模拟面板会得到「命令从未执行」的假象,极易误判成信号问题。
