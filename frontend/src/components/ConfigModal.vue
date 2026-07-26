<script setup lang="ts">
import { useLogStore } from '@/stores/logs'

const store = useLogStore()
</script>

<template>
  <Teleport to="body">
    <div v-if="store.showConfig" class="modal-overlay" @click.self="store.showConfig = false">
      <div class="modal">
        <div class="modal-header">
          <span>config.json</span>
          <button @click="store.showConfig = false">✕</button>
        </div>
        <div class="modal-body">
          <textarea v-model="configText" spellcheck="false"></textarea>
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" @click="store.showConfig = false">Cancel</button>
          <button class="btn-primary" @click="trySave">Save & Apply</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts">
import { ref, watch } from 'vue'
const store = useLogStore()
const configText = ref('')

watch(() => store.showConfig, (v) => {
  if (v) configText.value = JSON.stringify(store.config, null, 2)
})

async function trySave() {
  try {
    store.config = JSON.parse(configText.value)
    await store.saveConfig()
  } catch (e: any) {
    alert('Invalid JSON: ' + e.message)
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 650px; max-height: 80vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  font-size: 12px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-dim);
  display: flex; justify-content: space-between; align-items: center;
}
.modal-header button {
  background: transparent; border: none;
  color: var(--text-dim); font-size: 18px; cursor: pointer;
}
.modal-body { flex: 1; padding: 12px; overflow: hidden; }
.modal-body textarea {
  width: 100%; height: 400px;
  background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 14px; font-family: var(--font); font-size: 11px;
  line-height: 1.6; resize: none; outline: none;
  font-variant-ligatures: none;
}
.modal-body textarea:focus { border-color: var(--glow-dim); }
.modal-footer {
  display: flex; gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  justify-content: flex-end;
}
.modal-footer button {
  font-family: var(--font); font-size: 11px;
  padding: 6px 18px; border-radius: var(--radius);
  cursor: pointer; letter-spacing: 0.04em;
}
.btn-ghost {
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border);
}
.btn-primary {
  background: var(--glow-dim); color: var(--text);
  border: 1px solid var(--glow);
}
</style>
