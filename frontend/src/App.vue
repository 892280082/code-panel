<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import CommandDrawer from '@/components/CommandDrawer.vue'
import TerminalPanel from '@/components/TerminalPanel.vue'
import RepoBrowserModal from '@/components/RepoBrowserModal.vue'
import { useTerminalStore } from '@/stores/terminal'
import { useRepoBrowserStore } from '@/stores/repo-browser'

const terminalStore = useTerminalStore()
const browserStore = useRepoBrowserStore()

function handleBeforeUnload() {
  terminalStore.cleanupAll()
}

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<template>
  <router-view />
  <CommandDrawer />
  <TerminalPanel />
  <RepoBrowserModal
    :visible="browserStore.visible"
    :repo-id="browserStore.repoId"
    :repo-name="browserStore.repoName"
    @close="browserStore.closeModal"
  />
</template>
