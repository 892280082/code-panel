// ── Git pull + log operations ─────────────────────────────

import { execSync } from 'child_process';
import fs from 'fs';
import { errorMessage } from '../utils/route-utils';

// ── Shared helpers ────────────────────────────────────────

function runGit(repoPath: string, args: string): string {
  try {
    return execSync(`git -C "${repoPath}" ${args}`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 30000,
      env: { ...process.env, LC_ALL: 'C.UTF-8' },
    });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
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

export interface CommitEntry {
  hash: string;
  author: string;
  email: string;
  date: string;        // ISO 8601
  subject: string;
  body: string;
}

export interface DayGroup {
  date: string;        // "2026-07-10"
  commits: CommitEntry[];
}

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
    // Use | as delimiter (very unlikely in commit messages)
    const format = '%H|%an|%ae|%aI|%s|%b';
    const raw = runGit(repoPath, `log --format="${format}" --max-count=${limit} --skip=${offset}`);

    if (!raw.trim()) {
      return { repoId, repoName, branch, totalCommits: 0, dayGroups: [] };
    }

    // Parse commits
    const commits: CommitEntry[] = [];
    // Split by commit delimiter: a line that starts with a 40-char hex hash
    const entries = raw.split('\n').reduce<string[]>((acc, line) => {
      // New commit starts with 40-char hex hash followed by |
      if (/^[0-9a-f]{40}\|/.test(line)) {
        acc.push(line);
      } else if (acc.length > 0) {
        // Append body lines to the last commit
        acc[acc.length - 1] += '\n' + line;
      }
      return acc;
    }, []);

    for (const entry of entries) {
      // Find the first | to split hash from rest
      const firstPipe = entry.indexOf('|');
      if (firstPipe < 0) continue;

      const hash = entry.slice(0, firstPipe);
      const rest = entry.slice(firstPipe + 1);

      // Split the rest: author|email|date|subject|body
      // The first 4 | delimiters are fixed, the rest belongs to body
      const parts = rest.split('|');
      const author = parts[0] || '';
      const email = parts[1] || '';
      const date = parts[2] || '';
      // Subject and body: parts[3..].join('|') but body may contain newlines
      const subjectAndBody = parts.slice(3).join('|');
      const firstNewline = subjectAndBody.indexOf('\n');
      const subject = firstNewline >= 0 ? subjectAndBody.slice(0, firstNewline) : subjectAndBody;
      const body = firstNewline >= 0 ? subjectAndBody.slice(firstNewline + 1).trim() : '';

      commits.push({ hash, author, email, date, subject, body });
    }

    // Group by date (YYYY-MM-DD)
    const groupMap = new Map<string, CommitEntry[]>();
    for (const c of commits) {
      const day = c.date.slice(0, 10); // Extract YYYY-MM-DD from ISO date
      if (!groupMap.has(day)) groupMap.set(day, []);
      groupMap.get(day)!.push(c);
    }

    // Sort groups newest first
    const dayGroups: DayGroup[] = Array.from(groupMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, commits]) => ({ date, commits }));

    return { repoId, repoName, branch, totalCommits: commits.length, dayGroups };
  } catch (e: unknown) {
    return {
      repoId, repoName, branch,
      error: errorMessage(e),
      totalCommits: 0, dayGroups: [],
    };
  }
}
