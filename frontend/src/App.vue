<script setup lang="ts">
import { onMounted } from 'vue'
import CommandDrawer from '@/components/CommandDrawer.vue'
import TerminalPanel from '@/components/TerminalPanel.vue'
import RepoBrowserModal from '@/components/RepoBrowserModal.vue'
import CloudPanel from '@/components/CloudPanel.vue'
import SystemResourceMonitor from '@/components/SystemResourceMonitor.vue'
import QuickLinks from '@/components/QuickLinks.vue'
import EnvSwitcher from '@/components/EnvSwitcher.vue'
import { useTerminalStore } from '@/stores/terminal'
import { useRepoBrowserStore } from '@/stores/repo-browser'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const terminalStore = useTerminalStore()
const browserStore = useRepoBrowserStore()

onMounted(() => {
  auth.checkAuth()
  // 刷新后恢复上次打开的终端窗口(tmux 重连 / cmd 复用服务端会话)。
  // 稍等片刻,让项目列表(auth 后异步)加载完,再对 tmux 发起 attach。
  setTimeout(() => {
    if (auth.isLoggedIn) terminalStore.restorePersisted()
  }, 1600)
})
</script>

<template>
  <router-view />
  <template v-if="auth.isLoggedIn">
    <!-- 右上角常驻:资源监控 + 快捷方式 + 环境变量(切到任意 Tab 都在) -->
    <div class="top-right">
      <SystemResourceMonitor />
      <QuickLinks />
      <EnvSwitcher />
    </div>
    <CommandDrawer />
    <TerminalPanel />
    <RepoBrowserModal
      :visible="browserStore.visible"
      :repo-id="browserStore.repoId"
      :repo-name="browserStore.repoName"
      @close="browserStore.closeModal"
    />
    <CloudPanel />
  </template>
</template>

<style scoped>
/* 右上角常驻工具:资源监控圆环 + 快捷方式,各 Tab 共用 */
.top-right {
  position: fixed;
  top: 7px; right: 14px;
  z-index: 60;
  display: flex; align-items: center; gap: 6px;
  padding: 3px 4px 3px 8px;
  background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a);
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}
</style>

