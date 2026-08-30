// ── Git diff executor + parser ────────────────────────────

import { execSync } from 'child_process';
import fs from 'fs';
import { errorMessage } from '../utils/route-utils';

// ── Structured types ─────────────────────────────────────

export interface DiffLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;  // for renamed files
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface RepoDiff {
  repoId: number;
  repoName: string;
  repoPath: string;
  branch: string;
  error?: string;
  stat: string;        // raw git diff --stat output
  files: FileDiff[];
}

// ── Execute git commands ──────────────────────────────────

function runGit(repoPath: string, args: string): string {
  try {
    return execSync(`git -C "${repoPath}" ${args}`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 15000,
      env: { ...process.env, LC_ALL: 'C.UTF-8' },
    });
  } catch (e: unknown) {
    // git diff exits with code 1 if there are no changes - that's fine
    const err = e as { stdout?: string; stderr?: string };
    if (err.stdout) return err.stdout;
    if (err.stderr) throw new Error(err.stderr.trim());
    throw e;
  }
}

function getBranch(repoPath: string): string {
  try {
    return runGit(repoPath, 'rev-parse --abbrev-ref HEAD').trim();
  } catch {
    return 'unknown';
  }
}

function safeGit(repoPath: string, args: string): string | null {
  try { return runGit(repoPath, args); }
  catch { return null; }
}

// ── Parse unified diff ────────────────────────────────────

function parseDiff(raw: string): FileDiff[] {
  if (!raw.trim()) return [];
  const files: FileDiff[] = [];
  const lines = raw.split('\n');
  let i = 0;
  let currentFile: FileDiff | null = null;
  let currentHunk: DiffHunk | null = null;

  while (i < lines.length) {
    const line = lines[i];

    // New file header: diff --git a/xxx b/xxx
    if (line.startsWith('diff --git ')) {
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
        currentHunk = null;
      }
      if (currentFile) files.push(currentFile);

      currentFile = {
        path: '',
        status: 'modified',
        additions: 0,
        deletions: 0,
        hunks: [],
      };

      // Parse paths from diff --git a/path b/path
      const m = line.match(/diff --git a\/(.*?) b\/(.*?)$/);
      if (m) {
        currentFile.path = m[2] || m[1];
        if (m[1] !== m[2]) {
          currentFile.oldPath = m[1];
        }
      }
      i++;
      continue;
    }

    if (!currentFile) { i++; continue; }

    // File mode / status lines
    if (line.startsWith('new file mode')) {
      currentFile.status = 'added'; i++; continue;
    }
    if (line.startsWith('deleted file mode')) {
      currentFile.status = 'deleted'; i++; continue;
    }
    if (line.startsWith('rename from ')) {
      currentFile.status = 'renamed';
      currentFile.oldPath = line.slice('rename from '.length).trim();
      i++; continue;
    }
    if (line.startsWith('rename to ')) {
      currentFile.path = line.slice('rename to '.length).trim();
      i++; continue;
    }
    if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') ||
        line.startsWith('similarity index ') || line.startsWith('old mode ') || line.startsWith('new mode ')) {
      i++; continue;
    }

    // Hunk header: @@ -old,count +new,count @@
    if (line.startsWith('@@')) {
      if (currentHunk) currentFile.hunks.push(currentHunk);

      currentHunk = { header: line, lines: [] };

      // Parse line numbers from @@ -a,b +c,d @@
      const hm = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      let oldLine = hm ? parseInt(hm[1]) : 1;
      let newLine = hm ? parseInt(hm[3]) : 1;

      // Collect lines in this hunk
      i++;
      while (i < lines.length) {
        const hl = lines[i];
        if (hl.startsWith('@@') || hl.startsWith('diff --git ')) break;

        if (hl.startsWith('+')) {
          currentHunk.lines.push({ type: 'addition', content: hl.slice(1), newLine: newLine++ });
          currentFile.additions++;
        } else if (hl.startsWith('-')) {
          currentHunk.lines.push({ type: 'deletion', content: hl.slice(1), oldLine: oldLine++ });
          currentFile.deletions++;
        } else if (hl.startsWith(' ') || hl === '') {
          const content = hl.startsWith(' ') ? hl.slice(1) : hl;
          currentHunk.lines.push({ type: 'context', content, oldLine: oldLine++, newLine: newLine++ });
        }
        // Skip \ No newline at end of file markers
        i++;
      }
      continue;
    }

    i++;
  }

  // Save last hunk and file
  if (currentFile) {
    if (currentHunk) currentFile.hunks.push(currentHunk);
    files.push(currentFile);
  }

  return files;
}

// ── Summary (lightweight, for AI quick check) ─────────────

export interface DiffSummary {
  repoId: number;
  repoName: string;
  repoPath: string;
  branch: string;
  error?: string;
  clean: boolean;
  fileCount: number;
  additions: number;
  deletions: number;
  files: Array<{ path: string; status: string; additions: number; deletions: number }>;
}

export function getSummary(repoId: number, repoName: string, repoPath: string, staged = false): DiffSummary {
  if (!fs.existsSync(repoPath)) {
    return { repoId, repoName, repoPath, branch: 'N/A', clean: true, fileCount: 0, additions: 0, deletions: 0, files: [], error: `Path not found: ${repoPath}` };
  }
  if (!fs.existsSync(`${repoPath}/.git`)) {
    return { repoId, repoName, repoPath, branch: 'N/A', clean: true, fileCount: 0, additions: 0, deletions: 0, files: [], error: `Not a git repo: ${repoPath}` };
  }

  const branch = getBranch(repoPath);

  try {
    const args = staged ? 'diff --staged' : 'diff';
    const raw = safeGit(repoPath, `${args} --stat`) || '';
    const files = parseDiff(safeGit(repoPath, args) || '');

    return {
      repoId, repoName, repoPath, branch,
      clean: files.length === 0,
      fileCount: files.length,
      additions: files.reduce((s, f) => s + f.additions, 0),
      deletions: files.reduce((s, f) => s + f.deletions, 0),
      files: files.map(f => ({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions })),
    };
  } catch (e: unknown) {
    return { repoId, repoName, repoPath, branch, clean: true, fileCount: 0, additions: 0, deletions: 0, files: [], error: errorMessage(e) };
  }
}

// ── Full diff API ─────────────────────────────────────────

export function getDiff(repoId: number, repoName: string, repoPath: string, staged = false): RepoDiff {
  // Validate path
  if (!fs.existsSync(repoPath)) {
    return { repoId, repoName, repoPath, branch: 'N/A', stat: '', files: [], error: `Path not found: ${repoPath}` };
  }
  if (!fs.existsSync(`${repoPath}/.git`)) {
    return { repoId, repoName, repoPath, branch: 'N/A', stat: '', files: [], error: `Not a git repo: ${repoPath}` };
  }

  const branch = getBranch(repoPath);

  try {
    const args = staged ? 'diff --staged' : 'diff';
    const statRaw = safeGit(repoPath, `${args} --stat`) || '';
    const diffRaw = safeGit(repoPath, args) || '';

    return {
      repoId, repoName, repoPath, branch,
      stat: statRaw.trim(),
      files: parseDiff(diffRaw),
    };
  } catch (e: unknown) {
    return {
      repoId, repoName, repoPath, branch,
      stat: '', files: [],
      error: errorMessage(e),
    };
  }
}
