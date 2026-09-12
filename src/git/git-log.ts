// ── Git commit-log 解析(git-pull 与 git-file-service 共享)──
//   此前两处各写一份逐字符等价的「按 40 位 hex+| 切条目 → 拆六字段
//   → 按日期分组倒序」,收编到此;格式串与解析语义不变。

export const LOG_FORMAT = '%H|%an|%ae|%aI|%s|%b';

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

/** 解析 git log 输出(格式见 LOG_FORMAT);body 多行会并回最后一条 */
export function parseLogOutput(raw: string): CommitEntry[] {
  const entries: CommitEntry[] = [];
  // 新提交以「40 位 hex + |」开头的行开始;其余行并入上一条的 body
  const lines = raw.split('\n').reduce<string[]>((acc, line) => {
    if (/^[0-9a-f]{40}\|/.test(line)) acc.push(line);
    else if (acc.length > 0) acc[acc.length - 1] += '\n' + line;
    return acc;
  }, []);

  for (const entry of lines) {
    const firstPipe = entry.indexOf('|');
    if (firstPipe < 0) continue;
    const hash = entry.slice(0, firstPipe);
    const rest = entry.slice(firstPipe + 1);
    const parts = rest.split('|');
    // 前 3 个 | 固定分隔;subject 之后可能含 | 与换行,全部归 subject+body
    const subjectAndBody = parts.slice(3).join('|');
    const firstNewline = subjectAndBody.indexOf('\n');
    entries.push({
      hash,
      author: parts[0] || '',
      email: parts[1] || '',
      date: parts[2] || '',
      subject: firstNewline >= 0 ? subjectAndBody.slice(0, firstNewline) : subjectAndBody,
      body: firstNewline >= 0 ? subjectAndBody.slice(firstNewline + 1).trim() : '',
    });
  }
  return entries;
}

/** 按日期(ISO 前 10 位)分组,新日期在前 */
export function groupByDay(commits: CommitEntry[]): DayGroup[] {
  const map = new Map<string, CommitEntry[]>();
  for (const c of commits) {
    const day = c.date.slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(c);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, cmts]) => ({ date, commits: cmts }));
}
