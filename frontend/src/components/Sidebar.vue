<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

const tabs = [
  { path: '/log', label: 'Logs' },
  { path: '/sql', label: 'SQL' },
]
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <h2>▸ {{ route.path === '/sql' ? 'SQL Review' : 'Log Viewer' }}</h2>
      <div class="sidebar-nav">
        <a v-for="t in tabs" :key="t.path"
           class="nav-tab"
           :class="{ active: route.path === t.path }"
           @click.prevent="router.push(t.path)">
          {{ t.label }}
        </a>
      </div>
    </div>
    <slot />
  </aside>
</template>

<style scoped>
.sidebar {
  width: 280px; min-width: 280px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  z-index: 10;
}
.sidebar-header {
  padding: 20px 20px 12px;
  border-bottom: 1px solid var(--border);
}
.sidebar-header h2 {
  font-size: 14px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 12px;
}
.sidebar-nav {
  display: flex;
  border-bottom: 1px solid var(--border);
  padding: 0 8px;
}
.nav-tab {
  flex: 1; text-align: center;
  padding: 8px 0; font-size: 10px;
  color: var(--text-dim);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  text-decoration: none;
  transition: all 0.15s;
}
.nav-tab:hover, .nav-tab.active {
  color: var(--text);
  border-bottom-color: var(--glow-dim);
}
</style>
