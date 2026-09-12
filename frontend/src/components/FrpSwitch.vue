<script setup lang="ts">
// ── FRP 公网暴露开关(嵌 🔗 快捷方式弹窗头部)────────────
//   状态源 = composables/useFrp 模块级单例,与 ⚙ 安全 Tab 首卡同源即时同步。
import { computed, onMounted } from 'vue'
import { useFrp } from '@/composables/useFrp'

const { info, busy, load, toggle } = useFrp()
const on = computed(() => !!info.value?.on)

async function doToggle(): Promise<void> {
  const r = await toggle(!on.value)
  if (!r.ok && r.error) alert(`公网开关操作失败:${r.error}`)
}
onMounted(load) // 每次挂载刷新一次(弹窗重开 → 状态新鲜)
</script>

<template>
  <div class="frp-wrap" :title="on ? 'FRP 公网暴露:开启中(点击关闭)' : 'FRP 公网暴露:已关闭(点击开启)'">
    <span class="frp-label">公网</span>
    <button class="frp-switch" :class="{ on }" :disabled="busy" @click="doToggle" />
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
