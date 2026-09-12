// ── Git File Service — file log, commit diff, commit files ──
//   Extracted from routes/repo-browser.ts for reuse & testability.
//   All functions exec git commands against repoPath.

import { execSync } from 'child_process';
import { LOG_FORMAT, parseLogOutput, groupByDay, type CommitEntry, type DayGroup } from './git-log';

// ── Types ──────────────────────────────────────────────────

export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  text: string;
}

export interface CommitDiffResult {
  commit: string;
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
  rawDiff: string;
  stat: string;
}

export interface CommitFileItem {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface CommitFilesResult {
  commit: string;
  subject: string;
  author: string;
  date: string;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  files: CommitFileItem[];
}

export interface CommitMeta {
  subject: string;
  author: string;
  date: string;
}

// ── Helpers ────────────────────────────────────────────────

/** Parse diff output into typed lines */
function parseDiff(output: string): DiffLine[] {
  return output.split('\n').map(line => {
    if (line.startsWith('+') && !line.startsWith('+++')) return { type: 'add' as const, text: line };
    if (line.startsWith('-') && !line.startsWith('---')) return { type: 'del' as const, text: line };
    return { type: 'ctx' as const, text: line };
  });
}

/** Parse diff --stat to extract addition/deletion counts */
function parseStat(statOutput: string): { additions: number; deletions: number } {
  const addMatch = statOutput.match(/(\d+) insertion(?:s?)\(\+\)/);
  const delMatch = statOutput.match(/(\d+) deletion(?:s?)\(-\)/);
  return {
    additions: addMatch ? parseInt(addMatch[1]) : 0,
    deletions: delMatch ? parseInt(delMatch[1]) : 0,
  };
}

// ── Public API ─────────────────────────────────────────────

/**
 * Get git log for a file, grouped by day.
 * Returns empty array on error (no commits for file).
 */
export function getFileLog(repoPath: string, filePath: string, limit = 50): DayGroup[] {
  try {
    const raw = execSync(
      `git -C "${repoPath}" log --format="${LOG_FORMAT}" --max-count=${limit} -- "${filePath}"`,
      { encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024 },
    );
    if (!raw.trim()) return [];
    return groupByDay(parseLogOutput(raw));
  } catch {
    return [];
  }
}

/**
 * Get diff for one file in a specific commit.
 * Throws on commit-not-found or file-not-in-commit.
 */
export function getFileCommitDiff(repoPath: string, commitHash: string, filePath: string): CommitDiffResult {
  const diffOutput = execSync(
    `git -C "${repoPath}" show ${commitHash} -- "${filePath}"`,
    { encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024 },
  );
  const statOutput = execSync(
    `git -C "${repoPath}" diff ${commitHash}^..${commitHash} --stat -- "${filePath}"`,
    { encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024 },
  );

  const stat = parseStat(statOutput);
  return {
    commit: commitHash,
    path: filePath,
    additions: stat.additions,
    deletions: stat.deletions,
    lines: parseDiff(diffOutput),
    rawDiff: diffOutput,
    stat: statOutput.trim(),
  };
}

/**
 * Get all files changed in a commit, with per-file +/– counts.
 * Throws on commit-not-found.
 */
export function getCommitFiles(repoPath: string, commitHash: string): CommitFilesResult {
  // Changed files list with status codes
  const nameStatusOutput = execSync(
    `git -C "${repoPath}" diff-tree --no-commit-id -r --name-status ${commitHash}`,
    { encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024 },
  );

  const statusMap: Record<string, string> = {
    A: 'added', M: 'modified', D: 'deleted', R: 'renamed',
    C: 'copied', T: 'type-change', U: 'unmerged',
  };

  const files: CommitFileItem[] = [];
  const lines = nameStatusOutput.split('\n').filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([A-Z])\s+(.+)$/);
    if (!match) continue;
    files.push({
      path: match[2].trim(),
      status: statusMap[match[1]] || 'modified',
      additions: 0,
      deletions: 0,
    });
  }

  // Batch get per-file +/– stats
  for (const file of files) {
    try {
      const fileStat = execSync(
        `git -C "${repoPath}" diff ${commitHash}^..${commitHash} --stat -- "${file.path}"`,
        { encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 },
      );
      const stat = parseStat(fileStat);
      file.additions = stat.additions;
      file.deletions = stat.deletions;
    } catch { /* skip unstatable files */ }
  }

  // Commit metadata
  const meta = getCommitMeta(repoPath, commitHash);

  return {
    commit: commitHash,
    subject: meta.subject,
    author: meta.author,
    date: meta.date,
    totalFiles: files.length,
    totalAdditions: files.reduce((s, f) => s + f.additions, 0),
    totalDeletions: files.reduce((s, f) => s + f.deletions, 0),
    files,
  };
}

/**
 * Get subject/author/date for a commit.
 */
export function getCommitMeta(repoPath: string, commitHash: string): CommitMeta {
  try {
    const logOutput = execSync(
      `git -C "${repoPath}" log --format="${LOG_FORMAT}" --max-count=1 ${commitHash}`,
      { encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 },
    );
    const entries = parseLogOutput(logOutput);
    if (entries.length > 0) {
      return {
        subject: entries[0].subject,
        author: entries[0].author,
        date: entries[0].date,
      };
    }
  } catch { /* fall through */ }
  return { subject: '', author: '', date: '' };
}
