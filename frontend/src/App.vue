<script setup lang="ts">
import { onMounted } from 'vue'

onMounted(() => {
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Close modals handled by stores
    }
  })
})
</script>

<template>
  <router-view />
</template>
