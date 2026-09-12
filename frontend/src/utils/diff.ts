// ── diff 共享语义(GitView / RepoBrowser FilePreview 共用)──────────
//   mergeToUnified: 全文 + diff hunks → VSCode 式内联行(删除行插入其新位置之前)
//   buildDiffBlocks: 行序列 → 概览条变动块(按行比例,连续同型聚块)

export type DiffLineType = 'context' | 'addition' | 'deletion'

export interface UnifiedLine {
  type: DiffLineType
  content: string
  oldLine?: number
  newLine?: number
}

export interface DiffHunkInput {
  header: string                                  // "@@ -a,b +c,d @@"
  lines: { type: DiffLineType; content: string }[]
}

/** 解析 hunk header 的起始行号 */
function parseHunkHeader(header: string): { oldStart: number; newStart: number; newCount: number } {
  const m = header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
  return {
    oldStart: m ? parseInt(m[1]) : 1,
    newStart: m ? parseInt(m[3]) : 1,
    newCount: m && m[4] ? parseInt(m[4]) : 1,
  }
}

/** 原始 diff 文本行({type,text})→ 结构化 hunks(FilePreview 的 git diff 数据源) */
export function parseRawDiffHunks(diffLines: { type: string; text: string }[]): DiffHunkInput[] {
  const hunks: DiffHunkInput[] = []
  let current: DiffHunkInput | null = null
  for (const line of diffLines) {
    const hunkMatch = line.text.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/)
    if (hunkMatch) {
      if (current) hunks.push(current)
      current = {
        header: `@@ -${hunkMatch[1]},${hunkMatch[2] || '1'} +${hunkMatch[3]},${hunkMatch[4] || '1'} @@`,
        lines: [],
      }
    } else if (current) {
      const type = (line.type === 'add' ? 'addition' : line.type === 'del' ? 'deletion' : 'context') as DiffLineType
      current.lines.push({ type, content: line.text.slice(1) })   // 剥掉 unified diff 的 ' '/'+ '/'-' 前缀
    }
  }
  if (current) hunks.push(current)
  return hunks
}

/**
 * 全文源码 + hunks → 内联 diff 行序列。
 * 删除行插入其原新位置之前;hunk 以删除行结尾 → 挂到 hunk 末尾之后。
 */
export function mergeToUnified(sourceLines: string[], hunks: DiffHunkInput[]): UnifiedLine[] {
  const addedSet = new Set<number>()
  const deletedAtNewPos = new Map<number, UnifiedLine[]>()   // 新行号 → 删除行

  for (const hunk of hunks) {
    const { oldStart, newStart, newCount } = parseHunkHeader(hunk.header)
    let delBuf: UnifiedLine[] = []
    let oldAt = oldStart
    let newAt = newStart
    for (const line of hunk.lines) {
      if (line.type === 'deletion') {
        delBuf.push({ type: 'deletion', content: line.content, oldLine: oldAt })
        oldAt++
        continue
      }
      if (delBuf.length) {
        deletedAtNewPos.set(newAt, (deletedAtNewPos.get(newAt) || []).concat(delBuf))
        delBuf = []
      }
      if (line.type === 'addition') addedSet.add(newAt)
      oldAt++
      newAt++
    }
    if (delBuf.length) {
      const tailPos = newStart + newCount
      deletedAtNewPos.set(tailPos, (deletedAtNewPos.get(tailPos) || []).concat(delBuf))
    }
  }

  // 主循环:源码行 + 在其新位置前插入删除行
  const out: UnifiedLine[] = []
  for (let i = 0; i < sourceLines.length; i++) {
    const lineNum = i + 1
    const dels = deletedAtNewPos.get(lineNum)
    if (dels) for (const d of dels) out.push({ ...d, newLine: undefined })
    out.push({
      type: addedSet.has(lineNum) ? 'addition' : 'context',
      content: sourceLines[i],
      oldLine: addedSet.has(lineNum) ? undefined : lineNum,
      newLine: lineNum,
    })
  }
  const tailDels = deletedAtNewPos.get(sourceLines.length + 1)
  if (tailDels) for (const d of tailDels) out.push({ ...d, newLine: undefined })
  return out
}

/** 概览条变动块:连续同型行聚合,top/height 为 0-1 比例 */
export function buildDiffBlocks(
  lines: { type: DiffLineType }[],
): { top: number; height: number; type: 'addition' | 'deletion' }[] {
  const total = lines.length
  if (!total) return []
  const blocks: { top: number; height: number; type: 'addition' | 'deletion' }[] = []
  let cur: { start: number; count: number; type: 'addition' | 'deletion' } | null = null
  const flush = () => {
    if (cur) {
      blocks.push({ top: cur.start / total, height: Math.max(cur.count / total, 0.006), type: cur.type })
      cur = null
    }
  }
  lines.forEach((l, i) => {
    if (l.type === 'context') { flush(); return }
    if (cur && cur.type === l.type) cur.count++
    else { flush(); cur = { start: i, count: 1, type: l.type as 'addition' | 'deletion' } }
  })
  flush()
  return blocks
}
