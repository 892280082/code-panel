/**
 * Clipboard utility — works in HTTP/IP contexts where navigator.clipboard is blocked.
 *
 * navigator.clipboard.writeText() only works in secure contexts (HTTPS or localhost).
 * When accessing via IP over HTTP, it throws a SecurityError.
 * This utility uses document.execCommand('copy') which, while deprecated, still works
 * in non-secure contexts as long as it's called SYNCHRONOUSLY from a user gesture.
 *
 * ⚠ IMPORTANT: The caller must NOT use await when calling this function.
 *   The execCommand('copy') requires the call to be synchronous within the user
 *   gesture (click) handler. Any await breaks the gesture chain.
 */

export function copyToClipboard(text: string): boolean {
  // Create a temporary textarea — must be in the DOM for execCommand to work
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;opacity:0;left:-9999px;top:-9999px;pointer-events:none'
  document.body.appendChild(ta)

  let success = false
  try {
    ta.focus()
    ta.select()
    success = document.execCommand('copy')
  } catch {
    // execCommand failed
  } finally {
    document.body.removeChild(ta)
  }

  // Also try the modern API as a best-effort (for secure contexts where it may work faster)
  if (!success && window.isSecureContext && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {})
  }

  return success
}

// ── 异步版(时空胶囊/并入 wiki 用;用户手势内调用)────────
//   与 copyToClipboard 同思路:navigator.clipboard 优先(secure
//   context),http 内网退化 execCommand 兜底。

export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch { /* 落到兜底 */ }
  }
  return copyToClipboard(text)
}

/** 「并入 wiki」提示词:粘到终端给 claude code,由它执行归档(SKILL.md) */
export function wikiPrompt(capsuleId: string): string {
  const name = capsuleId.replace(/\.(md|markdown)$/i, '')
  return `/code-panel 归入wiki 思维文档:${name}`
}

/** 「时空胶囊」命令前缀:粘到终端后由用户自己补主题 */
export function brainstormPrompt(): string {
  return '/code-panel 时空胶囊 '
}
