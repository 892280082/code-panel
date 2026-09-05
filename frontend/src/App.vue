<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import CommandDrawer from '@/components/CommandDrawer.vue'
import TerminalPanel from '@/components/TerminalPanel.vue'
import RepoBrowserModal from '@/components/RepoBrowserModal.vue'
import { useTerminalStore } from '@/stores/terminal'
import { useRepoBrowserStore } from '@/stores/repo-browser'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const terminalStore = useTerminalStore()
const browserStore = useRepoBrowserStore()

function handleBeforeUnload() {
  terminalStore.cleanupAll()
}

onMounted(() => {
  auth.checkAuth()
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
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
  </template>
</template>
