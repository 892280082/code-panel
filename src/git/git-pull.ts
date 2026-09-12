// ── Git pull + log operations ─────────────────────────────

import { gitExec, type GitExecError } from './git-exec';
import fs from 'fs';
import { errorMessage } from '../utils/route-utils';
import { LOG_FORMAT, parseLogOutput, groupByDay, type DayGroup } from './git-log';

// ── Shared helpers ────────────────────────────────────────

function runGit(repoPath: string, args: string): string {
  try {
    return gitExec(`git -C "${repoPath}" ${args}`);
  } catch (e) {
    const err = e as GitExecError;
    if (err.stderr) throw new Error(err.stderr.trim());
    throw e;
  }
}

function safeGit(repoPath: string, args: string): string | null {
  try { return runGit(repoPath, args); }
  catch { return null; }
}

function getBranch(repoPath: string): string {
  try { return runGit(repoPath, 'rev-parse --abbrev-ref HEAD').trim(); }
  catch { return 'unknown'; }
}

function validateRepo(repoPath: string): string | null {
  if (!fs.existsSync(repoPath)) return `Path not found: ${repoPath}`;
  if (!fs.existsSync(`${repoPath}/.git`)) return `Not a git repo: ${repoPath}`;
  return null;
}

// ── Pull ──────────────────────────────────────────────────

export interface PullResult {
  repoId: string;
  repoName: string;
  branch: string;
  status: 'pulled' | 'up-to-date' | 'conflict' | 'error' | 'no-remote';
  message: string;
  pulledCount?: number;  // number of new commits pulled
}

export function pullRepo(repoId: string, repoName: string, repoPath: string): PullResult {
  const pathErr = validateRepo(repoPath);
  if (pathErr) {
    return { repoId, repoName, branch: 'N/A', status: 'error', message: pathErr };
  }

  const branch = getBranch(repoPath);

  // Check if there's a remote
  const remote = safeGit(repoPath, 'remote');
  if (!remote || !remote.trim()) {
    return { repoId, repoName, branch, status: 'no-remote', message: 'No remote configured' };
  }

  // Check if there's an upstream tracking branch
  const upstream = safeGit(repoPath, 'rev-parse --abbrev-ref @{u} 2>/dev/null');
  if (!upstream) {
    return {
      repoId, repoName, branch,
      status: 'no-remote',
      message: 'No upstream tracking branch configured',
    };
  }

  // git pull --ff-only: 只快进，绝不合入
  // fetch 成功 → 尝试快进；不能快进/冲突 → 报错退出，不碰工作区
  try {
    const out = runGit(repoPath, 'pull --ff-only').trim();
    if (out.includes('Already up to date')) {
      return { repoId, repoName, branch, status: 'up-to-date', message: 'Already up to date', pulledCount: 0 };
    }
    return { repoId, repoName, branch, status: 'pulled', message: out || 'Pulled successfully' };
  } catch (e: unknown) {
    const msg = errorMessage(e);
    if (msg.includes('Not possible to fast-forward') || msg.includes('CONFLICT')) {
      return { repoId, repoName, branch, status: 'conflict', message: 'Cannot fast-forward — local branch has diverged or has conflicts' };
    }
    return { repoId, repoName, branch, status: 'error', message: msg };
  }
}

// ── Commit Log ────────────────────────────────────────────

export interface RepoLog {
  repoId: string;
  repoName: string;
  branch: string;
  error?: string;
  totalCommits: number;
  dayGroups: DayGroup[];
}

export function getCommitLog(
  repoId: string,
  repoName: string,
  repoPath: string,
  limit = 100,
  offset = 0,
): RepoLog {
  const pathErr = validateRepo(repoPath);
  if (pathErr) {
    return { repoId, repoName, branch: 'N/A', error: pathErr, totalCommits: 0, dayGroups: [] };
  }

  const branch = getBranch(repoPath);

  try {
    const raw = runGit(repoPath, `log --format="${LOG_FORMAT}" --max-count=${limit} --skip=${offset}`);
    if (!raw.trim()) {
      return { repoId, repoName, branch, totalCommits: 0, dayGroups: [] };
    }
    const commits = parseLogOutput(raw);
    return { repoId, repoName, branch, totalCommits: commits.length, dayGroups: groupByDay(commits) };
  } catch (e: unknown) {
    return {
      repoId, repoName, branch,
      error: errorMessage(e),
      totalCommits: 0, dayGroups: [],
    };
  }
}
