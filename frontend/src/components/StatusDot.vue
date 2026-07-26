<script setup lang="ts">
defineProps<{
  status?: 'alive' | 'dead' | 'missing' | 'pending' | 'executed' | 'rejected' | 'failed'
  blink?: boolean
}>()
</script>

<template>
  <span class="dot" :class="[status || '', { blink: blink }]"></span>
</template>

<style scoped>
.dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  background: var(--text-dim); transition: background 0.3s, box-shadow 0.3s;
}
.dot.alive, .dot.executed {
  background: var(--glow);
  box-shadow: 0 0 6px var(--glow), 0 0 12px var(--glow-dim);
}
.dot.dead, .dot.rejected, .dot.failed { background: var(--danger); box-shadow: 0 0 4px var(--danger); }
.dot.missing, .dot.pending { background: var(--warn); box-shadow: 0 0 4px var(--warn); }
.dot.blink { animation: pulse 0.6s ease-in-out infinite alternate; }
@keyframes pulse {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0.3; transform: scale(1.4); }
}
</style>
