<script setup lang="ts">
import { useSqlStore } from '@/stores/sql'

const store = useSqlStore()

async function confirm() {
  if (store.rejectTargetId) await store.rejectJob(store.rejectTargetId)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="store.rejectTargetId" class="modal-overlay" @click.self="store.closeRejectModal()">
      <div class="modal">
        <div class="modal-header">
          <span>Reject SQL</span>
          <button @click="store.closeRejectModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="label">Reason (optional):</div>
          <textarea v-model="store.rejectReason" placeholder="为什么拒绝这条 SQL..."></textarea>
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" @click="store.closeRejectModal()">Cancel</button>
          <button class="btn-reject" @click="confirm">✗ Reject</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.modal {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; width: 420px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.modal-header {
  padding: 16px 20px; border-bottom: 1px solid var(--border);
  font-size: 12px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-dim);
  display: flex; justify-content: space-between; align-items: center;
}
.modal-header button { background: transparent; border: none; color: var(--text-dim); font-size: 18px; cursor: pointer; }
.modal-body { padding: 16px; }
.modal-body .label { font-size: 11px; color: var(--text-dim); margin-bottom: 8px; }
.modal-body textarea {
  width: 100%; height: 80px; background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 10px; font-family: var(--font); font-size: 11px;
  resize: none; outline: none;
}
.modal-footer {
  display: flex; gap: 8px; padding: 12px 20px;
  border-top: 1px solid var(--border); justify-content: flex-end;
}
.modal-footer button {
  font-family: var(--font); font-size: 11px;
  padding: 6px 18px; border-radius: var(--radius); cursor: pointer;
}
.btn-ghost { background: transparent; color: var(--text-dim); border: 1px solid var(--border); }
.btn-reject { background: var(--danger); color: #fff; border: none; }
</style>
