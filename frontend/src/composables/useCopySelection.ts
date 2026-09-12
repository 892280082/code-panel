// ── 选中文本时浮出复制按钮（含文件路径） ────────────────

import { ref, onMounted, onUnmounted } from 'vue'
import { copyText } from '@/utils/clipboard'

export function useCopySelection(filePath: () => string) {
  const showCopy = ref(false)
  const copyLeft = ref(0)
  const copyTop = ref(0)
  const selectedText = ref('')

  function onMouseUp(e: MouseEvent) {
    // 点击复制按钮自身时不处理，避免按钮消失导致 click 无法触发
    if ((e.target as HTMLElement)?.closest('.copy-float')) return

    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      showCopy.value = false
      return
    }
    selectedText.value = sel.toString()

    // Position near top-left of selection
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    copyLeft.value = rect.left
    copyTop.value = rect.top - 36  // Float above selection
    showCopy.value = true
  }

  async function doCopy() {
    const text = `${filePath()}\n\`\`\`\n${selectedText.value}\n\`\`\``
    await copyText(text)   // secure context 优先,http 内网 execCommand 兜底
    showCopy.value = false
  }

  onMounted(() => document.addEventListener('mouseup', onMouseUp))
  onUnmounted(() => document.removeEventListener('mouseup', onMouseUp))

  return { showCopy, copyLeft, copyTop, doCopy }
}
