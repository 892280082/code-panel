<script setup lang="ts">
import { onMounted, onUnmounted, watchEffect } from 'vue'
import CommandDrawer from '@/components/CommandDrawer.vue'
import TerminalPanel from '@/components/TerminalPanel.vue'
import TmuxCaptureModal from '@/components/TmuxCaptureModal.vue'
import CapsuleToast from '@/components/CapsuleToast.vue'
import CapsulePreviewModal from '@/components/CapsulePreviewModal.vue'
import RepoBrowserModal from '@/components/RepoBrowserModal.vue'
import CloudPanel from '@/components/CloudPanel.vue'
import { useTerminalStore } from '@/stores/terminal'
import { useRepoBrowserStore } from '@/stores/repo-browser'
import { useCapsuleStore } from '@/stores/capsule'
import { useAuthStore } from '@/stores/auth'
import { useProjectsStore } from '@/stores/projects'
import { getHotkeys, startHotkeyListener } from '@/utils/hotkeys'

const auth = useAuthStore()
const projects = useProjectsStore()

// 浏览器标签页标题跟随当前项目(多标签页各开一个项目时,靠标题区分)
watchEffect(() => {
  const name = projects.currentProject?.name
  document.title = name ? `${name} · code-panel` : 'code-panel'
})
const terminalStore = useTerminalStore()
const browserStore = useRepoBrowserStore()
const capsuleStore = useCapsuleStore()

// ── 全局快捷键(⚙ →「快捷键」Tab 可改键,改完即时生效)────
// Ctrl+1 = 显示/隐藏全部 tmux 终端窗口(动作在 terminal store;
// 焦点在终端 iframe 内的场景由 TerminalPanel 注入转发监听兜住)
let offHotkeys: (() => void) | null = null

onMounted(() => {
  auth.checkAuth()
  // 焦点抢回:鼠标点浏览器「刷新按钮」后焦点常留在地址栏,此时页面
  // 收不到任何按键(快捷键失效的主因);尝试把焦点拉回页面文档域。
  window.focus()
  // 时空胶囊:登录即拉列表 + 连 SSE(全局,与项目无关)
  if (auth.isLoggedIn) capsuleStore.init()
  // 快捷键映射每次按键实时读取(改键免重启)
  offHotkeys = startHotkeyListener(() => {
    const map: Record<string, () => void> = {}
    map[getHotkeys().toggleTerm] = () => terminalStore.toggleTmuxVisibility()
    return map
  })
  // 刷新后恢复上次打开的终端窗口(tmux 重连 / cmd 复用服务端会话)。
  // 稍等片刻,让项目列表(auth 后异步)加载完,再对 tmux 发起 attach。
  setTimeout(() => {
    if (auth.isLoggedIn) terminalStore.restorePersisted()
  }, 1600)
})

onUnmounted(() => { offHotkeys?.() })
</script>

<template>
  <router-view />
  <template v-if="auth.isLoggedIn">
    <CommandDrawer />
    <TerminalPanel />
    <TmuxCaptureModal />
    <CapsuleToast />
    <CapsulePreviewModal />
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

