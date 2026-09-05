<script setup lang="ts">
// ── Sidebar:标题 + 导航 + 左上角 ⚙(全局配置) + 内容插槽 ──
//   项目切换/登出都收纳进 ⚙ 配置面板,不再占用侧栏。

import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useProjectsStore } from '@/stores/projects'
import GlobalConfigModal from '@/components/GlobalConfigModal.vue'

const router = useRouter()
const route = useRoute()
const projects = useProjectsStore()

const showCfg = ref(false)

const tabs = [
  { path: '/log', label: 'Apps' },
  { path: '/sql', label: 'SQL' },
  { path: '/prd', label: 'PRD' },
  { path: '/git', label: 'Git' },
]

onMounted(() => {
  // 登录后装载项目列表(切换/默认选中),使各视图能按当前项目加载
  projects.load().catch(() => {})
})
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="title-row">
        <h2>▸ {{ route.path === '/sql' ? 'SQL Review' : route.path === '/prd' ? 'PRD Docs' : route.path === '/git' ? 'Git Diff' : 'Apps' }}</h2>
        <button class="gear" title="配置(项目/账号)" @click="showCfg = true">⚙</button>
      </div>
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

    <GlobalConfigModal v-if="showCfg" @close="showCfg = false" />
  </aside>
</template>

<style scoped>
.sidebar {
  width: 336px; min-width: 336px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  z-index: 10;
}
.sidebar-header {
  padding: 20px 20px 12px;
  border-bottom: 1px solid var(--border);
}
.title-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-bottom: 12px;
}
.title-row h2 {
  font-size: 14px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--text-dim);
  margin: 0;
}
.gear {
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: 4px;
  width: 22px; height: 22px; font-size: 13px; line-height: 1;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.gear:hover { color: var(--glow); border-color: var(--glow-dim); }
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
