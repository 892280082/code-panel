<script setup lang="ts">
defineProps<{
  title: string
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩 -->
    <div v-if="show" class="drawer-overlay" @click="emit('close')"></div>

    <!-- 抽屉 -->
    <Transition name="slide">
      <aside v-if="show" class="drawer">
        <div class="drawer-header">
          <span class="drawer-title">{{ title }}</span>
          <button class="drawer-close" @click="emit('close')">✕</button>
        </div>
        <div class="drawer-body">
          <slot />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-overlay {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0,0,0,0.4);
}
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 360px; z-index: 60;
  background: var(--surface);
  border-left: 1px solid var(--border);
  display: flex; flex-direction: column;
  box-shadow: -4px 0 20px rgba(0,0,0,0.3);
}
.drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--border);
}
.drawer-title {
  font-size: 13px; font-weight: 700;
  color: var(--text);
}
.drawer-close {
  font-family: var(--font); font-size: 12px;
  padding: 2px 8px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer;
}
.drawer-close:hover { color: var(--danger); border-color: var(--danger); }
.drawer-body {
  flex: 1; overflow-y: auto; padding: 4px;
}
.drawer-body::-webkit-scrollbar { width: 4px; }
.drawer-body::-webkit-scrollbar-track { background: transparent; }
.drawer-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

.slide-enter-active, .slide-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.slide-enter-from { transform: translateX(100%); opacity: 0; }
.slide-leave-to { transform: translateX(100%); opacity: 0; }
</style>
