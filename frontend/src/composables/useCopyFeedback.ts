// ── 复制反馈(copied 闪断)─────────────────────────────
//   此前 8 处各自手写「copied ref + clearTimeout + setTimeout 复位」,
//   收编到此;复制本体走 utils/clipboard(带 http 内网兜底)。

import { ref } from 'vue'
import { copyText } from '@/utils/clipboard'

export function useCopyFeedback(ms = 1500) {
  const copied = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  /** 复制成功 → copied 亮 ms 毫秒后自动熄灭;失败保持 false */
  async function copy(text: string): Promise<boolean> {
    if (!await copyText(text)) return false
    copied.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { copied.value = false }, ms)
    return true
  }

  return { copied, copy }
}
