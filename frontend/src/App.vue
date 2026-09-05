<script setup lang="ts">
import { onMounted } from 'vue'
import CommandDrawer from '@/components/CommandDrawer.vue'
import TerminalPanel from '@/components/TerminalPanel.vue'
import RepoBrowserModal from '@/components/RepoBrowserModal.vue'
import CloudPanel from '@/components/CloudPanel.vue'
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
