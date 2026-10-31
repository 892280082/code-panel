// ── 配置巡检:GET /api/inspect?project=<id> ──────────────
//   一发回答「这个项目现在到底配了什么、哪些活着、哪里错了」——
//   AI 改完 .code-panel/*.yaml 后用它自检生效,不用开页面肉眼看。
//   全部只读;密码一律脱敏(hasPassword);host 等显示插值后的实际生效值。

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import net from 'net';
import yaml from 'js-yaml';
import type { ProjectRow } from '../db/global-store';
import { requireProject, reqProject } from '../projects/context';
import { route } from '../utils/route-utils';
import { projectModuleYamlFile, projectCodePanelDir } from '../paths';
import { sqlConnections, redisConnections, gitRepos, logsFlatEntries } from '../projects/adapters';
import { getHealthStatus } from '../db/health-check';
import { envSnapshot } from '../env/env-store';
import { llmSnapshot } from '../llm/provider-store';
import type { LogsModuleYaml, PrdModuleYaml, GitModuleYaml, CommandsModuleYaml, LinksModuleYaml } from '../projects/yaml';

const router = Router();

/** 快速 TCP 探活(300ms 超时;inspect 不等长超时) */
function probePort(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.connect({ port, host });
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.setTimeout(300, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

interface ModuleBrief {
  file: string;            // 文件名(apps.yaml…)
  exists: boolean;
  mtime: string | null;    // 改完文件对比 mtime 即知面板读的是不是新的
  entries: number;         // 生效条目数
  error: string | null;    // YAML 解析失败原文
}

/** 读模块原始文件:解析错误要浮出来(loadProjectModule 内部容错吞掉了) */
function readModuleRaw(project: ProjectRow, module: Parameters<typeof projectModuleYamlFile>[1]): { parsed: unknown | null; error: string | null; mtime: string | null } {
  const file = projectModuleYamlFile(project.root, module);
  try {
    const st = fs.statSync(file);
    const text = fs.readFileSync(file, 'utf8');
    try {
      return { parsed: yaml.load(text) as unknown, error: null, mtime: st.mtime.toISOString() };
    } catch (e) {
      return { parsed: null, error: `YAML 解析失败: ${(e as Error).message}`, mtime: st.mtime.toISOString() };
    }
  } catch {
    return { parsed: null, error: null, mtime: null };   // 文件不存在(空配置,不算错)
  }
}

router.get('/api/inspect', requireProject, route(async (req, res) => {
  const project = reqProject(req);

  // ── 各模块摘要 ──
  const brief = (module: Parameters<typeof projectModuleYamlFile>[1], count: (p: unknown) => number): ModuleBrief => {
    const file = projectModuleYamlFile(project.root, module);
    const { parsed, error, mtime } = readModuleRaw(project, module);
    return { file: file.split('/').pop() || file, exists: mtime !== null, mtime, entries: parsed && !error ? count(parsed) : 0, error };
  };

  const appsRaw = readModuleRaw(project, 'logs').parsed as LogsModuleYaml | null;
  const services = (appsRaw?.platforms ?? []).flatMap(p => [...(p.backend ?? []), ...(p.frontend ?? [])]);
  const prdRaw = readModuleRaw(project, 'prd').parsed as PrdModuleYaml | null;
  const gitRaw = readModuleRaw(project, 'git').parsed as GitModuleYaml | null;

  // ── 连接(插值后的实际生效值 + 健康缓存 + 脱敏)──
  const sql = sqlConnections(project).map(c => {
    const h = getHealthStatus(project.id, c.id);
    return { id: c.id, type: c.type, host: c.type === 'sqlite' ? c.path : `${c.host}:${c.port ?? 3306}`, database: c.database, user: c.user, hasPassword: !!c.password, alive: h?.alive ?? false, version: h?.serverVersion ?? null, healthError: h?.error ?? null };
  });
  const redis = redisConnections(project).map(c => {
    const h = getHealthStatus(project.id, c.id);
    return { id: c.id, host: `${c.host}:${c.port ?? 6379}`, db: c.db ?? 0, hasPassword: !!c.password, alive: h?.alive ?? false, version: h?.serverVersion ?? null, healthError: h?.error ?? null };
  });

  // ── 应用端口存活(扁平服务表去重端口并行探)──
  const flat = logsFlatEntries(project);
  const ports = [...new Set(flat.map(e => e.port).filter((p): p is number => typeof p === 'number' && p > 0))];
  const alive = await Promise.all(ports.map(p => probePort(p)));
  const portAlive: Record<number, boolean> = {};
  ports.forEach((p, i) => { portAlive[p] = alive[i]; });

  // ── nginx confs(.code-panel/nginx/*.conf)──
  const nginxDir = projectCodePanelDir(project.root) + '/nginx';
  let nginxConfs: { name: string; mtime: string }[] = [];
  try {
    nginxConfs = fs.readdirSync(nginxDir).filter(f => f.endsWith('.conf'))
      .map(f => ({ name: f, mtime: fs.statSync(nginxDir + '/' + f).mtime.toISOString() }));
  } catch { /* 目录不存在 */ }

  // ── 环境组(当前生效)──
  const env = envSnapshot(project);

  // ── LLM 供应商(当前激活;脱敏)──
  const llm = llmSnapshot();
  const activeLlm = llm.providers.find(p => p.id === llm.active.providerId) ?? null;

  // ── 静态校验 errors ──
  const errors: string[] = [];
  for (const m of ['logs', 'sql', 'redis', 'prd', 'git', 'commands', 'links', 'envs'] as const) {
    const b = readModuleRaw(project, m === 'logs' ? 'logs' : m);
    if (b.error) errors.push(`${m}.yaml ${b.error}`);
  }
  for (const r of gitRepos(project)) {
    if (r.path && !fs.existsSync(r.path)) errors.push(`git.yaml: 仓库 "${r.id}" path 不存在: ${r.path}`);
  }
  for (const c of sqlConnections(project)) {
    if (c.type !== 'sqlite' && !c.host) errors.push(`sql.yaml: 连接 "${c.id}" 缺 host`);
    if (c.type === 'sqlite' && !c.path) errors.push(`sql.yaml: sqlite 连接 "${c.id}" 缺 path`);
  }
  for (const c of redisConnections(project)) {
    if (!c.host) errors.push(`redis.yaml: 连接 "${c.id}" 缺 host`);
  }
  for (const f of prdRaw?.folders ?? []) {
    // ⚠ folders.dir 是「相对项目根」的相对路径(yaml.ts 规范)——必须 resolve 到项目根再校验,
    //   否则相对面板进程 cwd(技能目录)永远误报「不存在」(2026-09-12 实证某项目三目录全误报)
    if (f.dir && !fs.existsSync(path.resolve(project.root, f.dir))) errors.push(`prd.yaml: 目录 "${f.name}" 不存在: ${f.dir}`);
  }

  res.json({
    ok: true,
    data: {
      project: { id: project.id, name: project.name, root: project.root, note: project.note ?? '' },
      env: { activeGroup: env.current, groups: env.groups.map(g => g.id) },
      llm: {
        active: activeLlm && {
          name: activeLlm.name,
          baseUrl: activeLlm.baseUrl,
          token: activeLlm.tokenTail,
          enabled: activeLlm.enabled,
          varCount: activeLlm.varCount,
        },
        enabledProviders: llm.providers.filter(p => p.enabled).map(p => p.name),
        rcMounted: llm.rcMounted,
        rc: llm.rc,
        envFile: llm.envFile,
        settingsForeignKeys: llm.foreignKeys,
      },
      modules: {
        apps:    { ...brief('logs', p => (p as LogsModuleYaml).platforms?.length ?? 0), services: services.length, portsAlive: `${Object.values(portAlive).filter(Boolean).length}/${ports.length}` },
        sql:     { ...brief('sql', p => (p as { connections?: unknown[] }).connections?.length ?? 0), connections: sql },
        redis:   { ...brief('redis', p => (p as { connections?: unknown[] }).connections?.length ?? 0), connections: redis },
        git:     { ...brief('git', p => (p as GitModuleYaml).repos?.length ?? 0), repos: gitRepos(project).map(r => ({ id: r.id, path: r.path, pathExists: fs.existsSync(r.path) })) },
        prd:     { ...brief('prd', p => (p as PrdModuleYaml).folders?.length ?? 0), dir: prdRaw?.dir ?? '' },
        commands: { ...brief('commands', p => (p as CommandsModuleYaml).commands?.length ?? 0) },
        links:   { ...brief('links', p => (p as LinksModuleYaml).groups?.length ?? 0) },
        envs:    { ...brief('envs', p => (p as { groups?: unknown[] }).groups?.length ?? 0) },
        nginx:   { confs: nginxConfs },
      },
      portAlive,
      errors,
    },
  });
}));

export default router;
