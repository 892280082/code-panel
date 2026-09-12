// ── shell rc 托管工具(env 环境组 / llm 供应商两个 store 共用)──────
//   收编自 env-store.ts 与 provider-store.ts 的逐字复制:rc 探测、managed 块挂载、export 转义。

import fs from 'fs';
import os from 'os';
import path from 'path';

/** shell rc 路径(CODE_PANEL_RC 可覆盖;否则按常见顺序探测,兜底 ~/.zshrc) */
export function shellRcPath(): string {
  const env = (process.env.CODE_PANEL_RC || '').trim();
  if (env) return env;
  const home = os.homedir();
  for (const c of ['.zshrc', '.bashrc', '.bash_profile', '.profile']) {
    const cand = path.join(home, c);
    if (fs.existsSync(cand)) return cand;
  }
  return path.join(home, '.zshrc');
}

/** export KEY="..." 的值转义 */
export function esc(v: string): string {
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** 确保 shell rc 挂载 source 指定文件(幂等:按起止标记判重;marker 需各托管块唯一) */
export function ensureRcMount(rcTop: string, rcBot: string, sourceFile: string): { rc: string; added: boolean } {
  const rc = shellRcPath();
  let content = '';
  try {
    content = fs.readFileSync(rc, 'utf8');
  } catch { /* rc 缺失则新建 */ }
  if (content.includes(rcTop)) return { rc, added: false };
  const block = `\n${rcTop}\n[ -f "${sourceFile}" ] && source "${sourceFile}"\n${rcBot}\n`;
  fs.writeFileSync(rc, content.replace(/\n?$/, '\n') + block, 'utf8');
  return { rc, added: true };
}

/** rc 是否已挂载指定标记块 */
export function rcMounted(rcTop: string): boolean {
  try {
    return fs.readFileSync(shellRcPath(), 'utf8').includes(rcTop);
  } catch {
    return false;
  }
}
