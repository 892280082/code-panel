// ── 全局面板设置(reviewMode / ttyd / terminalDefaultCwd / jwt) ──
//   全部落在 ~/.code-panel/data.db settings 表(global-store)。
//   不再读 config.json 的 prd/groups/databases —— 那些已随项目下沉到 <项目根>/.code-panel/*.yaml。

import { getSetting, setSetting } from './db/global-store';
import { getSecurityStatus } from './security/stealth';

export interface GlobalSettings {
  reviewMode: boolean;
  ttyd?: { port: number; command: string; args?: string };
  terminalDefaultCwd?: string;
  jwt?: { expiryHours?: number };
  security?: { enabled: boolean; secretPath: string }; // 安全模式(仅安全视图,不含 cookieSecret)
}

/** 读取全局设置(合并默认值) */
export function getGlobalSettings(): GlobalSettings {
  return {
    reviewMode: getReviewMode(),
    ttyd: getSetting<GlobalSettings['ttyd']>('ttyd', undefined),
    terminalDefaultCwd: getSetting<string>('terminalDefaultCwd', ''),
    jwt: getSetting<GlobalSettings['jwt']>('jwt', { expiryHours: 24 }),
    security: getSecurityStatus(),
  };
}

/** 兼容别名(ttyd-manager / proxy 仍用 getConfig) */
export function getConfig(): GlobalSettings {
  return getGlobalSettings();
}

/** 保存配置:仅收 reviewMode(全局);其它字段改走 /api/projects/:id/yaml 或 settings */
export function saveConfig(cfg: { reviewMode?: boolean }): GlobalSettings {
  if (typeof cfg?.reviewMode === 'boolean') setReviewMode(cfg.reviewMode);
  return getGlobalSettings();
}

// ── Review mode(全局开关,存在 settings 表) ───────────────

export function getReviewMode(): boolean {
  return getSetting<boolean>('reviewMode', true);
}

export function setReviewMode(enabled: boolean): boolean {
  setSetting('reviewMode', !!enabled);
  return getReviewMode();
}

// ── 终端默认工作目录(全局设置) ────────────────────────────

export function getTerminalDefaultCwd(): string {
  return getSetting<string>('terminalDefaultCwd', '');
}

export function setTerminalDefaultCwd(cwd: string): void {
  setSetting('terminalDefaultCwd', (cwd || '').trim() || '');
}
