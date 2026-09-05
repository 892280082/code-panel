// ── 全局路径统一解析(彻底摆脱 __dirname / process.cwd() 找数据) ──
//   全局数据根:~/.code-panel(可用环境变量 CODE_PANEL_HOME 覆盖)
//   每个项目:<项目根>/.code-panel/ (logs/sql/prd/git.yaml + data/ 运行时数据)

import os from 'os';
import path from 'path';

/** 全局数据根目录(所有面板实例共享) */
export function globalDataDir(): string {
  const env = process.env.CODE_PANEL_HOME;
  return env && env.trim() ? path.resolve(env.trim()) : path.join(os.homedir(), '.code-panel');
}

/** 全局数据根下某文件 */
export function globalDataFile(rel: string): string {
  return path.join(globalDataDir(), rel);
}

/** 全局 sqlite 库路径 */
export const GLOBAL_DB_PATH = globalDataFile('data.db');

/** 全局 JWT 密钥文件路径 */
export const JWT_SECRET_PATH = globalDataFile('jwt.secret');

/** 项目根下的 .code-panel 目录 */
export function projectCodePanelDir(root: string): string {
  return path.join(root, '.code-panel');
}

/** 项目 .code-panel/data 运行时数据目录(gitignore) */
export function projectDataDir(root: string): string {
  return path.join(projectCodePanelDir(root), 'data');
}

/** 项目某个模块 YAML 配置文件路径(apps.yaml 取代旧 logs.yaml) */
export function projectModuleYamlFile(
  root: string,
  module: 'logs' | 'sql' | 'prd' | 'git' | 'commands' | 'links',
): string {
  const name = module === 'logs' ? 'apps' : module;
  return path.join(projectCodePanelDir(root), `${name}.yaml`);
}

/** 项目某运行时数据文件路径 */
export function projectDataFile(root: string, rel: string): string {
  return path.join(projectDataDir(root), rel);
}
