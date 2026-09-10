<script setup lang="ts">
// ── 右上工具组:资源监控 + 快捷方式 + 模型供应商 + 环境变量 ──
//   用法:嵌进各视图自己的 .toolbar 最右(margin-left:auto 推到右端),
//   使其与视图原有左侧按钮在同一根导航条内,而非悬浮页面右上角。
import SystemResourceMonitor from '@/components/SystemResourceMonitor.vue'
import QuickLinks from '@/components/QuickLinks.vue'
import ProviderSwitcher from '@/components/ProviderSwitcher.vue'
import EnvSwitcher from '@/components/EnvSwitcher.vue'
</script>

<template>
  <div class="top-tools">
    <SystemResourceMonitor />
    <QuickLinks />
    <ProviderSwitcher />
    <EnvSwitcher />
  </div>
</template>

<style scoped>
.top-tools {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto; /* 在父 flex .toolbar 内推到最右 */
}
</style>
