// ── 服务看门狗(systemd user 定时器)──────────────────────
//   面板进程停机超 30s → 由系统级定时器自动拉起,不依赖面板自己活着。
//   仅 Linux(systemd user)环境可用;Mac / 容器不支持(前端提示并禁用)。
//   机制(2026-09-12 在 3700X 上演练验证过):
//   · code-panel.service   —— 服务本体(已存在则不覆盖)
//   · code-panel-watchdog.timer —— 每分钟触发 oneshot 检查
//   · 检查逻辑:停机时长 = now - InactiveEnterTimestamp;<30s 不打扰
//     (systemd 自身 Restart 正在重试,防两边打架),≥30s 才 reset-failed + start
//   ⚠ systemctl 时间戳带 CST 缩写会被 date 误解析成美国中部时间 → 强制 TZ=Asia/Shanghai

import fs from 'fs';
import path from 'path';
import os from 'os';

import { execText } from '../utils/exec';
export const WATCHDOG_GRACE_SEC = 30;   // 停机多久才算「真起不来」
export const WATCHDOG_INTERVAL_MIN = 1; // 检查周期(分钟)

const PANEL_UNIT = 'code-panel.service';
const WD_SERVICE = 'code-panel-watchdog.service';
const WD_TIMER = 'code-panel-watchdog.timer';

function unitDir(): string { return path.join(os.homedir(), '.config/systemd/user'); }
function scriptPath(): string { return path.join(os.homedir(), '.local/bin/code-panel-watchdog.sh'); }
/** 面板仓库根(src/security → 上两级) */
function repoRoot(): string { return path.resolve(__dirname, '..', '..'); }

/** systemctl --user(补 XDG 环境,防非交互 shell 缺失) */
function runUserCtl(args: string, timeoutMs = 15000): string {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  if (!env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = `/run/user/${process.getuid?.() ?? 1000}`;
  return execText(`systemctl --user ${args}`, { timeoutMs, env });
}

/** 环境是否支持(Linux + systemd user manager 可用)
 *  注:is-system-running 在 user 实例上 degraded 时退出码=1(execSync 会抛),故用 show-environment 探活 */
export function isWatchdogSupported(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    runUserCtl('show-environment', 5000);
    return true;
  } catch { return false; }
}

function isQuietOk(args: string): boolean {
  try { runUserCtl(`${args} --quiet`); return true; } catch { return false; }
}

export interface WatchdogStatus {
  supported: boolean;
  /** 看门狗 timer 已安装并启用 */
  installed: boolean;
  timerActive: boolean;
  /** 被守护的面板服务本体状态(active = 正常运行) */
  panelActive: boolean;
  scriptPath: string;
  timerUnit: string;
  graceSec: number;
  intervalMin: number;
}

export function watchdogStatus(): WatchdogStatus {
  const supported = isWatchdogSupported();
  if (!supported) {
    return { supported: false, installed: false, timerActive: false, panelActive: false,
      scriptPath: scriptPath(), timerUnit: WD_TIMER, graceSec: WATCHDOG_GRACE_SEC, intervalMin: WATCHDOG_INTERVAL_MIN };
  }
  const installed = fs.existsSync(path.join(unitDir(), WD_TIMER));
  return {
    supported: true,
    installed,
    timerActive: installed && isQuietOk(`is-active ${WD_TIMER}`),
    panelActive: isQuietOk(`is-active ${PANEL_UNIT.replace('.service', '')}`),
    scriptPath: scriptPath(),
    timerUnit: WD_TIMER,
    graceSec: WATCHDOG_GRACE_SEC,
    intervalMin: WATCHDOG_INTERVAL_MIN,
  };
}

/** 检查脚本(30s 缓冲 + TZ 修复版,与手工部署在 3700X 验证过的逐字一致) */
function watchdogScript(): string {
  return [
    '#!/bin/sh',
    `# code-panel 看门狗:停机 >${WATCHDOG_GRACE_SEC}s 才拉起(留时间给 systemd 自身 Restart 重试,防两边打架)`,
    '# 由面板「安全」Tab 自动部署;手动改了会在下次安装时被覆盖',
    '# 注:systemctl 时间戳带 CST 缩写,POSIX date 会误解析成美国中部时间 ——',
    '#     去掉时区后缀并以 TZ=Asia/Shanghai 强制解析',
    'STATE=$(systemctl --user is-active code-panel)',
    '[ "$STATE" = "active" ] && exit 0',
    'TS=$(systemctl --user show code-panel -p InactiveEnterTimestamp --value)',
    `if [ -z "$TS" ]; then AGE=999; else TS_CLEAN=\${TS% CST}; AGE=\$(( \$(date +%s) - \$(TZ=Asia/Shanghai date -d "$TS_CLEAN" +%s) )); fi`,
    `if [ "$AGE" -ge ${WATCHDOG_GRACE_SEC} ]; then`,
    '  systemctl --user reset-failed code-panel',
    '  systemctl --user start code-panel',
    `  echo "code-panel down \${AGE}s (>=${WATCHDOG_GRACE_SEC}s) → pulled up"`,
    `  exit 0`,
    `fi`,
    `echo "code-panel down \${AGE}s (<${WATCHDOG_GRACE_SEC}s) → waiting, systemd retrying"`,
    '',
  ].join('\n');
}

/** 面板服务本体单元(不存在时才生成;已存在 = 用户手调过,不覆盖) */
function ensurePanelUnit(): 'created' | 'kept' {
  const unit = path.join(unitDir(), PANEL_UNIT);
  if (fs.existsSync(unit)) return 'kept';
  const nodeBin = process.execPath;
  const tsxBin = path.join(repoRoot(), 'node_modules/.bin/tsx');
  if (!fs.existsSync(tsxBin)) throw new Error(`tsx 不存在: ${tsxBin}(先在仓库根 npm install)`);
  const content = [
    '[Unit]',
    'Description=code-panel ops panel (port 3008)',
    'After=network.target',
    '',
    '[Service]',
    // ⚠ systemd 单元不支持行内注释 —— 注释必须独占一行,否则整个赋值被静默忽略(实测踩坑)
    '# 只杀主进程:默认 control-group 会连 cgroup 里的 tmux server 一起杀(面板孵化的 tmux 会话随重启陪葬);',
    '# ExecStart 必须直连 node+tsx(勿用 npx —— wrapper 层杀不干净会占住 3008,新进程起不来)',
    'KillMode=process',
    `WorkingDirectory=${repoRoot()}`,
    `ExecStart=${nodeBin} ${tsxBin} src/server.ts`,
    'Restart=on-failure',
    'RestartSec=5',
    `Environment=HOME=${os.homedir()}`,
    // 面板终端(ttyd)继承本服务环境:带上 node 所在 bin(nvm 目录),
    // 否则终端里找不到 claude/node 等 nvm 安装的命令(systemd 默认 PATH 只有 /usr/bin:/bin)
    `Environment=PATH=${path.dirname(nodeBin)}:/usr/local/bin:/usr/bin:/bin`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
  fs.writeFileSync(unit, content);
  return 'created';
}

/** 安装并启用看门狗(幂等;不重启面板 —— 安装动作本身不能打断正在跑的服务) */
export function installWatchdog(): WatchdogStatus {
  if (!isWatchdogSupported()) throw new Error('当前环境不支持(仅 Ubuntu/Linux systemd 可用)');

  fs.mkdirSync(path.dirname(scriptPath()), { recursive: true });
  fs.writeFileSync(scriptPath(), watchdogScript());
  fs.chmodSync(scriptPath(), 0o755);

  const panelUnitState = ensurePanelUnit();

  fs.mkdirSync(unitDir(), { recursive: true });
  fs.writeFileSync(path.join(unitDir(), WD_SERVICE), [
    '[Unit]',
    `Description=code-panel watchdog — pull up only if down >${WATCHDOG_GRACE_SEC}s`,
    '',
    '[Service]',
    'Type=oneshot',
    `ExecStart=${scriptPath()}`,
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(unitDir(), WD_TIMER), [
    '[Unit]',
    'Description=Check code-panel every minute',
    '',
    '[Timer]',
    `OnCalendar=*:0/${WATCHDOG_INTERVAL_MIN}`,
    'Persistent=true',
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n'));

  runUserCtl('daemon-reload');
  runUserCtl(`enable --now ${WD_TIMER}`);
  if (panelUnitState === 'created') {
    // 首次装出服务单元:面板可能正以别的进程跑着(占 3008),不贸然 start;
    // 由看门狗/用户后续处理,这里只注册
    runUserCtl(`enable ${PANEL_UNIT}`);
  }
  return watchdogStatus();
}

/** 停用并清理看门狗(保留面板服务本体 code-panel.service) */
export function uninstallWatchdog(): WatchdogStatus {
  if (!isWatchdogSupported()) throw new Error('当前环境不支持(仅 Ubuntu/Linux systemd 可用)');
  try { runUserCtl(`disable --now ${WD_TIMER}`); } catch (e) { /* 未启用 */ void e; }
  fs.rmSync(path.join(unitDir(), WD_TIMER), { force: true });
  fs.rmSync(path.join(unitDir(), WD_SERVICE), { force: true });
  fs.rmSync(scriptPath(), { force: true });
  runUserCtl('daemon-reload');
  return watchdogStatus();
}
