<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import CommandDrawer from '@/components/CommandDrawer.vue'
import TerminalPanel from '@/components/TerminalPanel.vue'
import { useTerminalStore } from '@/stores/terminal'

const terminalStore = useTerminalStore()

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
</template>
