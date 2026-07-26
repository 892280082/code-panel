<script setup lang="ts">
import { useSqlStore } from '@/stores/sql'
import StatusDot from './StatusDot.vue'

const store = useSqlStore()
</script>

<template>
  <div class="db-health">
    <div v-if="!store.databases.length" class="empty">No databases</div>
    <div
      v-for="db in store.databases" :key="db.id"
      class="db-row"
      @click="store.setDbFilter(db.id)"
    >
      <StatusDot :status="db.alive ? 'alive' : db.lastCheck ? 'dead' : undefined" />
      <span class="db-name">{{ db.name }}</span>
      <span class="db-type">{{ db.type }}</span>
      <span v-if="db.serverVersion" class="db-ver">v{{ db.serverVersion }}</span>
      <span v-if="store.dbPendingCounts[db.id]" class="pending-badge">
        {{ store.dbPendingCounts[db.id] }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.db-health { flex: 1; overflow-y: auto; min-height: 0; padding: 0 12px 8px; border-bottom: 1px solid var(--border); }
.empty { font-size: 10px; color: var(--text-dim); padding: 4px 0; }
.db-row {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 4px; font-size: 12px; cursor: pointer;
  border-radius: var(--radius);
}
.db-row:hover { background: #1a1a22; }
.db-name { color: var(--text); }
.db-type { color: var(--text-dim); font-size: 10px; }
.db-ver { color: var(--text-dim); font-size: 9px; }
.pending-badge {
  background: var(--warn); color: #000; font-size: 9px; font-weight: 700;
  padding: 1px 5px; border-radius: 8px; margin-left: auto;
}
</style>
