<script setup lang="ts">
import { onMounted, watchEffect } from 'vue'
import CommandDrawer from '@/components/CommandDrawer.vue'
import TerminalPanel from '@/components/TerminalPanel.vue'
import RepoBrowserModal from '@/components/RepoBrowserModal.vue'
import CloudPanel from '@/components/CloudPanel.vue'
import { useTerminalStore } from '@/stores/terminal'
import { useRepoBrowserStore } from '@/stores/repo-browser'
import { useAuthStore } from '@/stores/auth'
import { useProjectsStore } from '@/stores/projects'

const auth = useAuthStore()
const projects = useProjectsStore()

// 浏览器标签页标题跟随当前项目(多标签页各开一个项目时,靠标题区分)
watchEffect(() => {
  const name = projects.currentProject?.name
  document.title = name ? `${name} · code-panel` : 'code-panel'
})
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

<style scoped>
/* 右上工具已随各视图自身的 .toolbar(见 TopRightTools.vue) */
</style>

