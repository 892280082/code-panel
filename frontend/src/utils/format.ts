// ── 展示格式化(时间/大小)─────────────────────────────
//   此前 fmtTime 在 5 个组件各复制一份(变体:相对时间/无兜底),
//   收编到此;fmtSize 两版输出格式有差异暂不统一。

/** M/D HH:mm;无值(0/null/undefined)返回 '' */
export function fmtTime(ms?: number | null): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 相对时间:刚刚 / N分前 / N时前 / M/D */
export function fmtRelTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}时前`
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
