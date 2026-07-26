// ── 审批铃声通知 composable ─────────────────────────────
// 当有待审批的 SQL 时持续叮叮响，用户操作完自动停

import { ref } from 'vue'

export function useSoundNotification() {
  const soundEnabled = ref(true)
  const isRinging = ref(false)

  let audioCtx: AudioContext | null = null
  let gainNode: GainNode | null = null
  let oscTimer: ReturnType<typeof setInterval> | null = null

  /** 启动双音清脆铃声 ding-ding */
  function startBeeping() {
    if (!soundEnabled.value || isRinging.value) return
    isRinging.value = true
    try {
      audioCtx = new AudioContext()
      gainNode = audioCtx.createGain()
      gainNode.gain.value = 0.25
      gainNode.connect(audioCtx.destination)

      oscTimer = setInterval(() => {
        if (!audioCtx) return
        const now = audioCtx.currentTime

        // 第一声 1200Hz
        const osc1 = audioCtx.createOscillator()
        const g1 = audioCtx.createGain()
        osc1.type = 'sine'
        osc1.frequency.value = 1200
        g1.gain.setValueAtTime(0.25, now)
        g1.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
        osc1.connect(g1)
        g1.connect(audioCtx.destination)
        osc1.start(now)
        osc1.stop(now + 0.15)

        // 第二声 1600Hz（延时 0.1s）
        const osc2 = audioCtx.createOscillator()
        const g2 = audioCtx.createGain()
        osc2.type = 'sine'
        osc2.frequency.value = 1600
        g2.gain.setValueAtTime(0.2, now + 0.1)
        g2.gain.exponentialRampToValueAtTime(0.001, now + 0.28)
        osc2.connect(g2)
        g2.connect(audioCtx.destination)
        osc2.start(now + 0.1)
        osc2.stop(now + 0.28)
      }, 1800)
    } catch { /* audio not supported */ }
  }

  function stopBeeping() {
    isRinging.value = false
    if (oscTimer) { clearInterval(oscTimer); oscTimer = null }
    if (audioCtx) { audioCtx.close(); audioCtx = null }
    gainNode = null
  }

  function toggleSound() {
    soundEnabled.value = !soundEnabled.value
    if (!soundEnabled.value) stopBeeping()
  }

  function disposeSound() {
    stopBeeping()
  }

  return {
    soundEnabled,
    isRinging,
    startBeeping,
    stopBeeping,
    toggleSound,
    disposeSound,
  }
}
