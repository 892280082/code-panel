<script setup lang="ts">
// ── FRP 公网暴露开关(右上工具条;⚙ 安全 Tab 首卡同效,走同一 API)──────
import { ref, onMounted } from 'vue'
import { apiFetch, errText } from '@/utils/api-fetch'

const on = ref(false)
const busy = ref(false)

async function load(): Promise<void> {
  try {
    const res = await apiFetch('/api/security/frp')
    const data = await res.json()
    if (data?.ok) on.value = !!data.data?.on
  } catch { /* 接口不可用 → 保持现状 */ }
}

async function toggle(): Promise<void> {
  if (busy.value) return
  const next = !on.value
  if (next && !window.confirm(
    '开启 FRP 公网暴露?\n\n公网 203.0.113.10 的 60101/60111/60112/60113 将对所有人开放,\n存在暴露风险 —— 仅在需要外网访问/演示时开启。')) return
  if (!next && !window.confirm('关闭 FRP 公网暴露?\n\n公网口全部下线;管理隧道(SSH/code-server/code-panel)不受影响。')) return
  busy.value = true
  const prev = on.value
  on.value = next
  try {
    const res = await apiFetch(`/api/security/frp/${next ? 'on' : 'off'}`)
    const data = await res.json()
    if (!data?.ok) throw new Error(data?.error || '操作失败')
  } catch (e) {
    on.value = prev
    alert(`公网开关操作失败:${errText(e)}`)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <div class="frp-wrap" :title="on ? 'FRP 公网暴露:开启中(点击关闭)' : 'FRP 公网暴露:已关闭(点击开启)'">
    <span class="frp-label">公网</span>
    <button class="frp-switch" :class="{ on }" :disabled="busy" @click="toggle" />
  </div>
</template>

<style scoped>
.frp-wrap { display: inline-flex; align-items: center; gap: 5px; }
.frp-label { font-size: 11px; color: var(--text-dim, #6b6b78); user-select: none; }
.frp-switch {
  width: 34px; height: 18px; border-radius: 9px; position: relative;
  background: #3a3a44; border: none; cursor: pointer; transition: background 0.2s; padding: 0;
}
.frp-switch:disabled { opacity: 0.5; cursor: wait; }
.frp-switch.on { background: #67c23a; }
.frp-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 14px; height: 14px; border-radius: 50%; background: #fff;
  transition: left 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.4);
}
.frp-switch.on::after { left: 18px; }
</style>
