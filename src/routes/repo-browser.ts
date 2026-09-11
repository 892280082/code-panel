// ── Repo Browser API — file tree + segmented file reading ──

import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { requireProject, reqProject } from '../projects/context';
import { getRepo, type GitRepo } from '../git/git-repo-store';
import { errorMessage } from '../utils/route-utils';
import { safeResolve } from '../utils/safe-resolve';
import {
  getFileLog,
  getFileCommitDiff,
  getCommitFiles,
} from '../git/git-file-service';

const router = Router();

// 该项目作用域:repo 一律从该项目的 git.yaml 按 string id 解析
router.use('/api/repo-browser', requireProject);

// ── Route wrapper — resolves project + repoId + repo, wraps error handling ──

function withRepo(
  handler: (repo: GitRepo, repoId: string, req: Request, res: Response) => void,
  errorLabel: string,
) {
  return (req: Request, res: Response) => {
    try {
      const project = reqProject(req);
      const repoId = String(req.params.repoId ?? '');
      if (!repoId) {
        res.status(400).json({ ok: false, error: 'invalid repoId' });
        return;
      }
      const repo = getRepo(project, repoId);
      if (!repo) {
        res.status(404).json({ ok: false, error: `Repo ${repoId} not found` });
        return;
      }
      handler(repo, repoId, req, res);
    } catch (e: unknown) {
      console.error(`[repo-browser] ${errorLabel} error:`, e);
      res.status(500).json({ ok: false, error: errorMessage(e) });
    }
  };
}

// ── Constants ────────────────────────────────────────────

const DEFAULT_LIMIT = 100 * 1024;   // 100KB per chunk
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB max

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript',   '.tsx': 'tsx',
  '.js': 'javascript',   '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.vue': 'html',        '.html': 'html',      '.htm': 'html',
  '.css': 'css',         '.scss': 'scss',      '.less': 'less',
  '.json': 'json',       '.yaml': 'yaml',      '.yml': 'yaml',
  '.md': 'markdown',     '.mdx': 'markdown',
  '.py': 'python',       '.rb': 'ruby',
  '.go': 'go',           '.rs': 'rust',
  '.java': 'java',       '.kt': 'kotlin',      '.kts': 'kotlin',
  '.c': 'c',             '.cpp': 'cpp',        '.cc': 'cpp', '.cxx': 'cpp', '.h': 'c', '.hpp': 'cpp',
  '.sh': 'bash',         '.bash': 'bash',      '.zsh': 'bash',
  '.sql': 'sql',         '.xml': 'xml',        '.svg': 'xml',
  '.toml': 'toml',       '.ini': 'ini',        '.cfg': 'ini',
  '.env': 'plaintext',   '.gitignore': 'plaintext', '.dockerignore': 'plaintext',
  '.dockerfile': 'dockerfile',
  '.graphql': 'graphql', '.gql': 'graphql',
  '.proto': 'protobuf',
};

// ── Helpers ──────────────────────────────────────────────

// safeResolve 已提取到 src/utils/safe-resolve.ts 共享(胶囊/wiki 路由同用)

function getLang(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return LANG_MAP[ext] || 'plaintext';
}

function isBinary(buffer: Buffer): boolean {
  // Check first 512 bytes for null bytes
  const checkLen = Math.min(buffer.length, 512);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** Check if file is text by reading first chunk and checking for null bytes */
function isTextFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    return !isBinary(buf.subarray(0, bytesRead));
  } catch {
    return false;
  }
}

// ── GET /api/repo-browser/:repoId/git-changes ─────────────

router.get('/api/repo-browser/:repoId/git-changes', withRepo((repo, _repoId, req, res) => {
  const { execSync } = require('child_process');
  const changedDirs = new Set<string>();
  const changedFiles = new Set<string>();

  try {
    // Tracked changes (staged + unstaged)
    // -c core.quotePath=false + -z: 禁用 git 路径引号转义(含非 ASCII 的文件名会被包一层 "")，NUL 分隔防换行文件名
    const diffOutput = execSync('git -c core.quotePath=false diff --name-only -z HEAD', { cwd: repo.path, encoding: 'utf8', timeout: 5000 });
    // Untracked files
    const untrackedOutput = execSync('git -c core.quotePath=false ls-files --others --exclude-standard -z', { cwd: repo.path, encoding: 'utf8', timeout: 5000 });

    const allChanged = (diffOutput + '\0' + untrackedOutput).split('\0').filter(Boolean);

    for (const filePath of allChanged) {
      changedFiles.add(filePath);
      // Add all parent directories
      const parts = filePath.split('/');
      for (let i = 0; i < parts.length - 1; i++) {
        changedDirs.add(parts.slice(0, i + 1).join('/'));
      }
    }
  } catch (e: any) {
    // git command might fail (not a git repo, etc.)
    return res.json({ ok: true, changedDirs: [], changedFiles: [], error: e.message });
  }

  res.json({
    ok: true,
    changedDirs: Array.from(changedDirs),
    changedFiles: Array.from(changedFiles),
  });
}, 'git-changes'));

// ── GET /api/repo-browser/:repoId/tree ───────────────────

router.get('/api/repo-browser/:repoId/tree', withRepo((repo, repoId, req, res) => {
  const subPath = (req.query.path as string) || '';
  let targetPath: string;
  try {
    targetPath = safeResolve(repo.path, subPath);
  } catch {
    return res.status(403).json({ ok: false, error: 'Invalid path' });
  }

  // Must be a directory (ENOENT → 404, 不抛 500)
  let stat: fs.Stats;
  try {
    stat = fs.statSync(targetPath);
  } catch {
    return res.status(404).json({ ok: false, error: 'Directory not found' });
  }
  if (!stat.isDirectory()) {
    return res.status(400).json({ ok: false, error: 'Path is not a directory' });
  }

  const names = fs.readdirSync(targetPath);
  const entries: { name: string; type: 'file' | 'dir'; size: number }[] = [];

  for (const name of names) {
    try {
      const s = fs.statSync(path.join(targetPath, name));
      entries.push({
        name,
        type: s.isDirectory() ? 'dir' : 'file',
        size: s.isFile() ? s.size : 0,
      });
    } catch {
      // Skip entries we can't stat (symlinks, permission errors, etc.)
    }
  }

  // Sort: directories first, then files, alphabetical within each group
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  res.json({
    ok: true,
    repoId,
    repoName: repo.name,
    path: subPath || '',
    entries,
  });
}, 'tree'));

// ── GET /api/repo-browser/:repoId/file ───────────────────

router.get('/api/repo-browser/:repoId/file', withRepo((repo, _repoId, req, res) => {
  const subPath = req.query.path as string;
  if (!subPath) return res.status(400).json({ ok: false, error: 'path query parameter required' });

  let targetPath: string;
  try {
    targetPath = safeResolve(repo.path, subPath);
  } catch {
    return res.status(403).json({ ok: false, error: 'Invalid path' });
  }

  // Must exist and be a file
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ ok: false, error: 'File not found' });
  }
  const stat = fs.statSync(targetPath);
  if (!stat.isFile()) {
    return res.status(400).json({ ok: false, error: 'Path is not a file' });
  }

  const totalSize = stat.size;

  // Check binary
  if (!isTextFile(targetPath)) {
    return res.json({
      ok: true,
      path: subPath, content: '', lang: '',
      offset: 0, limit: 0, totalSize, hasMore: false, binary: true,
    });
  }

  // Size cap
  if (totalSize > MAX_FILE_SIZE) {
    return res.status(400).json({
      ok: false,
      error: `File too large (${(totalSize / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB.`,
    });
  }

  // Parse offset/limit
  const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
  const limit = Math.min(DEFAULT_LIMIT, Math.max(1, parseInt(req.query.limit as string) || DEFAULT_LIMIT));

  // Read chunk
  const fd = fs.openSync(targetPath, 'r');
  const buf = Buffer.alloc(Math.min(limit, totalSize - offset));
  const bytesRead = fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);

  const content = buf.toString('utf8', 0, bytesRead);
  const hasMore = offset + bytesRead < totalSize;

  res.json({
    ok: true, path: subPath, content,
    lang: getLang(targetPath), offset, limit: bytesRead,
    totalSize, hasMore, binary: false,
  });
}, 'file'));

// ── GET /api/repo-browser/:repoId/diff ───────────────────

router.get('/api/repo-browser/:repoId/diff', withRepo((repo, _repoId, req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ ok: false, error: 'path query parameter required' });

  let targetPath: string;
  try { targetPath = safeResolve(repo.path, filePath); } catch {
    return res.status(403).json({ ok: false, error: 'Invalid path' });
  }

  const { execSync } = require('child_process');
  let diffOutput = '';
  try {
    diffOutput = execSync(`git diff HEAD -- "${targetPath}"`, {
      cwd: repo.path, encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024,
    });
  } catch { /* no changes */ }

  const lines = diffOutput.split('\n').map(line => {
    if (line.startsWith('+') && !line.startsWith('+++')) return { type: 'add', text: line };
    if (line.startsWith('-') && !line.startsWith('---')) return { type: 'del', text: line };
    return { type: 'ctx', text: line };
  });

  res.json({ ok: true, path: filePath, lines, rawDiff: diffOutput });
}, 'diff'));

// ── GET /api/repo-browser/:repoId/file-log ─────────────────

router.get('/api/repo-browser/:repoId/file-log', withRepo((repo, _repoId, req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ ok: false, error: 'path query parameter required' });

  // Prevent path traversal
  try { safeResolve(repo.path, filePath); } catch {
    return res.status(403).json({ ok: false, error: 'Invalid path' });
  }

  const limit = parseInt((req.query.limit as string) || '50');
  const dayGroups = getFileLog(repo.path, filePath, limit);
  const totalCommits = dayGroups.reduce((s, g) => s + g.commits.length, 0);

  res.json({ ok: true, path: filePath, totalCommits, dayGroups });
}, 'file-log'));

// ── GET /api/repo-browser/:repoId/file-commit-diff ──────────

router.get('/api/repo-browser/:repoId/file-commit-diff', withRepo((repo, _repoId, req, res) => {
  const filePath = req.query.path as string;
  const commitHash = req.query.commit as string;
  if (!filePath) return res.status(400).json({ ok: false, error: 'path query parameter required' });
  if (!commitHash) return res.status(400).json({ ok: false, error: 'commit query parameter required' });

  // Prevent path traversal
  try { safeResolve(repo.path, filePath); } catch {
    return res.status(403).json({ ok: false, error: 'Invalid path' });
  }

  try {
    const result = getFileCommitDiff(repo.path, commitHash, filePath);
    res.json({ ok: true, ...result });
  } catch (e: unknown) {
    const err = e as { stderr?: string };
    res.status(404).json({
      ok: false,
      error: err.stderr ? err.stderr.trim() : 'Commit not found or file not in commit',
    });
  }
}, 'file-commit-diff'));

// ── GET /api/repo-browser/:repoId/commit-files ──────────────

router.get('/api/repo-browser/:repoId/commit-files', withRepo((repo, _repoId, req, res) => {
  const commitHash = req.query.commit as string;
  if (!commitHash) return res.status(400).json({ ok: false, error: 'commit query parameter required' });

  try {
    const result = getCommitFiles(repo.path, commitHash);
    res.json({ ok: true, ...result });
  } catch (e: unknown) {
    const err = e as { stderr?: string };
    res.status(404).json({
      ok: false,
      error: err.stderr ? err.stderr.trim() : 'Commit not found',
    });
  }
}, 'commit-files'));

export default router;
