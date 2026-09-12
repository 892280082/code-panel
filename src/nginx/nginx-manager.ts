// ── nginx 配置检测(⚙ nginx Tab)─────────────────────────────
//   只读:探测本机 nginx(进程/版本/conf 目录)、读项目 <根>/.code-panel/nginx/*.conf、
//   校验 nginx -t 语法、用 nginx -T 判断某 server_name 是否被加载、md5 比对项目副本与本机实际加载文件。
//   不做 reload/写操作(本机 nginx master 通常 root,reload 需 sudo,本期避免)。
//   override(可选):settings.nginx = { bin?, confPath? } —— 手动指定可执行/主 conf 路径。

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ProjectRow } from '../db/global-store';
import { projectCodePanelDir } from '../paths';
import { getSetting, setSetting } from '../db/global-store';
import { execCapture } from '../utils/exec';

function md5File(p: string): string | null {
  try {
    if (!fs.existsSync(p)) return null;
    return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
  } catch { return null; }
}

// ════════════════════════════════════════════════════════════
// override settings.nginx = { bin?, confPath? }
// ════════════════════════════════════════════════════════════

interface NginxOverride { bin?: string; confPath?: string }

export function nginxOverride(): NginxOverride {
  return getSetting<NginxOverride>('nginx', {});
}

export function saveNginxOverride(v: NginxOverride): NginxOverride {
  const clean: NginxOverride = {};
  if (v.bin && typeof v.bin === 'string' && v.bin.trim()) clean.bin = v.bin.trim();
  if (v.confPath && typeof v.confPath === 'string' && v.confPath.trim()) clean.confPath = v.confPath.trim();
  setSetting('nginx', clean);
  return clean;
}

// ════════════════════════════════════════════════════════════
// nginx 探测(版本 / 主 conf 路径 / include 目录 / 进程)
// ════════════════════════════════════════════════════════════

interface NginxInfo {
  bin: string;
  version: string;
  mainConf: string;      // 主 nginx.conf 路径(nginx -V --conf-path 或 fallback)
  includeDirs: string[]; // 主 conf 里 include *.conf 的目录(conf.d / servers)
  masterPid: number | null;
  running: boolean;
  override: NginxOverride;
}

/** which/命令在 PATH 里的可执行路径 */
function whichBin(name: string): string | null {
  const r = execCapture(`command -v ${name}`, { timeoutMs: 3000 });
  return r.out.trim() || null;
}

/** 从主 conf 文本解析 include "目录/*.conf" 的目录列表 */
function parseIncludeDirs(confText: string, mainConf: string): string[] {
  const dirs: string[] = [];
  const re = /include\s+([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(confText)) !== null) {
    const pattern = m[1].trim();
    if (!/\*\.conf$/.test(pattern)) continue;   // 只关心通配 *.conf 的目录 include
    const dir = path.dirname(pattern.replace(/^['"]|['"]$/g, ''));
    const abs = path.isAbsolute(dir) ? dir : path.resolve(path.dirname(mainConf), dir);
    if (fs.existsSync(abs)) dirs.push(abs);
  }
  return Array.from(new Set(dirs));
}

export function resolveNginx(): NginxInfo {
  const override = nginxOverride();
  const bin = override.bin || whichBin('nginx') || 'nginx';

  // nginx -V(大写):版本在第一行,configure args 里含 --conf-path= / --prefix=
  const vres = execCapture(`${bin} -V 2>&1`, { timeoutMs: 5000 });
  const vText = vres.out + vres.err;
  const versionM = /nginx version:\s*([^\s]+)/.exec(vText);
  const version = versionM ? versionM[1] : '';
  const confPathM = /--conf-path=(\S+)/.exec(vText);
  const prefixM = /--prefix=(\S+)/.exec(vText);

  let mainConf = override.confPath || (confPathM ? confPathM[1] : '');
  if (!mainConf) {
    mainConf = prefixM
      ? path.join(prefixM[1], 'conf', 'nginx.conf')          // brew: <prefix>/conf/nginx.conf
      : '/etc/nginx/nginx.conf';                              // Ubuntu fallback
  }

  let includeDirs: string[] = [];
  if (fs.existsSync(mainConf)) {
    includeDirs = parseIncludeDirs(fs.readFileSync(mainConf, 'utf8'), mainConf);
  }

  // 进程:pgrep nginx master(无则回退 ps)
  let masterPid: number | null = null;
  const pg = execCapture('pgrep -x nginx 2>/dev/null || pgrep -f "nginx: master" 2>/dev/null', { timeoutMs: 5000 });
  const pids = (pg.out.trim().match(/\d+/g) || []).map(Number).filter(Boolean);
  if (pids.length) masterPid = pids[0];

  return { bin, version, mainConf, includeDirs, masterPid, running: masterPid !== null, override };
}

// ════════════════════════════════════════════════════════════
// 项目 .code-panel/nginx 目录读写
// ════════════════════════════════════════════════════════════

export function projectNginxDir(root: string): string {
  return path.join(projectCodePanelDir(root), 'nginx');
}

/** 某项目 .code-panel/nginx 下 .conf 文件列表 */
export function listProjectConfs(project: ProjectRow): { name: string; abs: string; size: number; mtime: number }[] {
  const dir = projectNginxDir(project.root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.conf'))
    .map(d => {
      const p = path.join(dir, d.name);
      const st = fs.statSync(p);
      return { name: d.name, abs: p, size: st.size, mtime: Math.round(st.mtimeMs) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 读某项目 conf(仅限项目 nginx 目录内,防穿越) */
export function readProjectConf(project: ProjectRow, name: string): { name: string; content: string } | null {
  const dir = projectNginxDir(project.root);
  const base = path.basename(name);
  if (!base.endsWith('.conf')) return null;
  const p = path.join(dir, base);
  if (!p.startsWith(dir) || !fs.existsSync(p)) return null;
  return { name: base, content: fs.readFileSync(p, 'utf8') };
}

// ════════════════════════════════════════════════════════════
// 检测:语法 + 是否被加载 + md5 一致性
// ════════════════════════════════════════════════════════════

/** 提取 conf 文本里第一个 server_name(可能多个域名,取首个) */
function firstServerName(content: string): string | null {
  const m = /\bserver_name\s+([^;]+);/.exec(content);
  if (!m) return null;
  const first = m[1].trim().split(/\s+/)[0];
  return first || null;
}

/** 从 nginx -T 生效配置文本里搜是否出现该 server_name(整词) */
function serverNameLoaded(effective: string, name: string): boolean {
  return new RegExp(`\\bserver_name\\s+[^;]*\\b${name.replace(/\./g, '\\.')}\\b`).test(effective);
}

export interface NginxCheckResult {
  file: string;
  serverName: string | null;
  syntax: { ok: boolean; output: string };
  loaded: 'loaded' | 'missing' | 'nginx-down' | 'no-server-name';
  localFiles: { path: string; md5Match: boolean }[];  // 本机 include 目录里同名的文件
  projectMd5: string | null;
  nginx: NginxInfo;
}

export function checkProjectConf(project: ProjectRow, name: string): NginxCheckResult | null {
  const read = readProjectConf(project, name);
  if (!read) return null;
  const { content } = read;
  const info = resolveNginx();
  const serverName = firstServerName(content);
  const projectMd5 = md5File(path.join(projectNginxDir(project.root), read.name));

  // nginx -t 语法(输出在 stderr;ok=退出码 0)
  const t = execCapture(`${info.bin} -t 2>&1`, { timeoutMs: 5000 });

  let loaded: NginxCheckResult['loaded'] = 'nginx-down';
  let localFiles: { path: string; md5Match: boolean }[] = [];
  if (info.running) {
    if (!serverName) {
      loaded = 'no-server-name';
    } else {
      const eff = execCapture(`${info.bin} -T 2>&1`, { timeoutMs: 5000 });
      loaded = serverNameLoaded(eff.out + eff.err, serverName) ? 'loaded' : 'missing';
    }
    // 本机 include 目录里是否有同名 conf,md5 是否与项目副本一致
    for (const dir of info.includeDirs) {
      const p = path.join(dir, read.name);
      if (fs.existsSync(p)) {
        localFiles.push({ path: p, md5Match: md5File(p) === projectMd5 });
      }
    }
  }

  return {
    file: read.name,
    serverName,
    syntax: { ok: t.ok, output: (t.out + t.err).trim() },
    loaded,
    localFiles,
    projectMd5,
    nginx: info,
  };
}
