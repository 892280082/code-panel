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
