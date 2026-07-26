<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useSqlStore } from '@/stores/sql'
import Sidebar from '@/components/Sidebar.vue'
import StatusDot from '@/components/StatusDot.vue'
import DbHealthList from '@/components/DbHealthList.vue'
import RejectModal from '@/components/RejectModal.vue'

const store = useSqlStore()

onMounted(() => store.init())
onUnmounted(() => store.stopPolling())

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function statusColor(s: string): string {
  return { pending:'var(--warn)',executed:'var(--glow)',rejected:'var(--danger)',failed:'var(--danger)' }[s] || 'var(--text)'
}

async function handleToggleReview() {
  try { await store.toggleReviewMode() }
  catch (e: any) { alert('切换失败: ' + e.message) }
}

async function handleApprove(id: string) {
  const result = await store.approveJob(id)
  if (!result.ok) {
    alert('Execute failed: ' + (result.error || 'unknown'))
    await store.loadJobs()
  }
}
</script>

<template>
  <div class="app">
    <Sidebar>
      <!-- DB selector -->
      <div class="db-select-row">
        <span class="filter-label">筛选↓</span>
        <select class="db-select" :value="store.dbFilter" @change="store.setDbFilter(($event.target as HTMLSelectElement).value)">
          <option value="">All Databases</option>
          <option v-for="db in store.databases" :key="db.id" :value="db.id">{{ db.name }}</option>
        </select>
        <button class="btn-refresh" @click="store.refreshDatabases()" title="Refresh DB status">↻</button>
      </div>

      <!-- DB health -->
      <DbHealthList />

      <!-- Section tabs -->
      <div class="section-tabs">
        <div
          v-for="s in (['pending','executed','rejected','failed'] as const)" :key="s"
          class="section-tab"
          :class="{ active: store.currentSection === s }"
          @click="store.setSection(s)"
        >
          {{ s.toUpperCase() }}
          <span v-if="s === 'pending' && store.pendingCount" class="badge warn">{{ store.pendingCount }}</span>
        </div>
      </div>

      <!-- Job list -->
      <div class="scroll-list">
        <div v-if="!store.filteredJobs.length" class="empty-jobs">No {{ store.currentSection }} jobs</div>
        <div
          v-for="job in store.filteredJobs" :key="job.id"
          class="sql-item"
          :class="{ selected: store.selectedJob?.id === job.id }"
          @click="store.selectJob(job)"
        >
          <div class="sql-id">
            #{{ job.id }} · {{ new Date(job.submittedAt).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) }}
            · {{ store.databases.find(d => d.id === job.dbId)?.name || job.dbId }}
          </div>
          <div class="sql-text">{{ job.sql.slice(0, 80) }}{{ job.sql.length > 80 ? '...' : '' }}</div>
          <div class="sql-meta">📝 {{ job.reason.slice(0, 40) }}{{ job.reason.length > 40 ? '...' : '' }}</div>
        </div>
      </div>
    </Sidebar>

    <!-- Main -->
    <main class="main">
      <!-- Toolbar -->
      <div class="toolbar">
        <button
          :class="{ on: store.reviewMode, danger: !store.reviewMode }"
          @click="handleToggleReview"
        >{{ store.reviewMode ? '🛡 Review Mode: ON' : '⚡ Review Mode: OFF (silent)' }}</button>
        <button @click="store.loadJobs()">↻ Refresh</button>
        <span class="token-display">Token: {{ store.reviewToken || '???' }}</span>
      </div>

      <!-- SQL Detail -->
      <div v-if="!store.selectedJob" class="sql-panel empty-panel">
        <span>Select a SQL job from the sidebar</span>
      </div>

      <div v-else class="sql-panel detail-panel">
        <div class="detail-body">
          <!-- Header -->
          <div class="detail-header">
            <div class="detail-meta">
              <span class="detail-id">#{{ store.selectedJob.id }}</span>
              <span class="detail-db">{{ store.databases.find(d => d.id === store.selectedJob!.dbId)?.name }}</span>
              <span class="detail-time">{{ new Date(store.selectedJob!.submittedAt).toLocaleString('zh-CN') }}</span>
              <span class="detail-status" :style="{ background: statusColor(store.selectedJob!.status) }">
                {{ store.selectedJob!.status.toUpperCase() }}
              </span>
              <span v-if="store.selectedJob!.reviewedAt" class="detail-review">
                Reviewed: {{ new Date(store.selectedJob!.reviewedAt).toLocaleString('zh-CN') }}
              </span>
            </div>
            <div class="detail-reason">📝 {{ store.selectedJob.reason }}</div>
            <div v-if="store.selectedJob.rejectReason" class="detail-reject">Reject: {{ store.selectedJob.rejectReason }}</div>
          </div>

          <!-- SQL Text -->
          <pre class="detail-sql">{{ store.selectedJob.sql }}</pre>

          <!-- Result -->
          <div v-if="store.selectedJob.result" class="detail-result-header">
            ⏱ {{ store.selectedJob.result.executionTime }}ms ·
            {{ store.selectedJob.result.rows !== undefined ? store.selectedJob.result.rows.length + ' rows' : store.selectedJob.result.affectedRows + ' affected' }}
          </div>
          <pre v-if="store.selectedJob.result" class="detail-result">{{ JSON.stringify(store.selectedJob.result.rows || store.selectedJob.result, null, 2) }}</pre>

          <!-- Error -->
          <pre v-if="store.selectedJob.error" class="detail-error">{{ store.selectedJob.error }}</pre>
        </div>

        <!-- Actions -->
        <div class="detail-actions">
          <template v-if="store.selectedJob.status === 'pending'">
            <button class="btn-approve" @click="handleApprove(store.selectedJob!.id)">✓ Approve</button>
            <button class="btn-reject" @click="store.openRejectModal(store.selectedJob!.id)">✗ Reject</button>
          </template>
          <button class="btn-ghost" @click="store.selectJob(null)">✕ Close</button>
        </div>
      </div>
    </main>

    <RejectModal />
  </div>
</template>

<style scoped>
.app { display: flex; height: 100vh; }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

/* DB selector */
.db-select-row {
  padding: 8px 12px;
  display: flex; gap: 6px; align-items: center;
}
.filter-label { font-size: 10px; color: var(--text-dim); }
.db-select {
  flex: 1; padding: 5px 8px;
  font-family: var(--font); font-size: 11px;
  background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius);
  outline: none; cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236b6b78' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 6px center;
}
.btn-refresh {
  font-family: var(--font); font-size: 10px; padding: 5px 8px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; white-space: nowrap;
}

/* Section tabs */
.section-tabs { display: flex; border-bottom: 1px solid var(--border); padding: 0 4px; }
.section-tab {
  flex: 1; text-align: center; padding: 10px 4px; font-size: 10px;
  color: var(--text-dim); cursor: pointer;
  border-bottom: 2px solid transparent; position: relative;
}
.section-tab:hover { color: var(--text); }
.section-tab.active { color: var(--text); border-bottom-color: var(--glow-dim); }
.section-tab .badge {
  position: absolute; top: 4px; right: 4px;
  font-size: 9px; padding: 1px 5px; border-radius: 8px;
  background: var(--glow-dim); color: var(--text);
}
.section-tab .badge.warn { background: var(--warn); color: #000; }

/* Job list */
.scroll-list { flex: 1; overflow-y: auto; padding: 4px; min-height: 25vh; }
.scroll-list::-webkit-scrollbar { width: 4px; }
.scroll-list::-webkit-scrollbar-track { background: transparent; }
.scroll-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.empty-jobs { padding: 20px; text-align: center; color: var(--text-dim); font-size: 11px; }

.sql-item {
  padding: 6px 8px; margin: 1px 4px;
  border-radius: var(--radius); cursor: pointer; font-size: 10px;
  border: 1px solid transparent;
}
.sql-item:hover { background: #1a1a22; border-color: var(--border); }
.sql-item.selected { background: #1a1a28; border-color: var(--glow-dim); }
.sql-item .sql-id { font-size: 9px; color: var(--text-dim); margin-bottom: 2px; }
.sql-item .sql-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.sql-item .sql-meta { font-size: 9px; color: var(--text-dim); margin-top: 2px; }

/* Toolbar */
.toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.toolbar button {
  font-family: var(--font); font-size: 10px;
  padding: 5px 12px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; letter-spacing: 0.04em;
  transition: all 0.15s;
}
.toolbar button:hover { color: var(--text); border-color: var(--glow-dim); background: rgba(34,238,102,0.04); }
.toolbar button.on { color: var(--glow); border-color: var(--glow-dim); background: rgba(34,238,102,0.06); }
.toolbar button.danger:hover { color: var(--danger); border-color: var(--danger); }
.token-display {
  font-size: 10px; color: var(--warn);
  padding: 4px 8px;
  background: rgba(240,160,48,0.1);
  border: 1px solid var(--warn);
  border-radius: var(--radius);
}

/* SQL panel */
.sql-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.empty-panel { align-items: center; justify-content: center; color: var(--text-dim); font-size: 12px; }

.detail-panel { }
.detail-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }

.detail-header { padding: 16px 20px; border-bottom: 1px solid var(--border); }
.detail-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.detail-id { font-size: 12px; color: var(--text); }
.detail-db, .detail-time, .detail-review { font-size: 10px; color: var(--text-dim); }
.detail-status { font-size: 10px; padding: 2px 8px; border-radius: 3px; color: #000; }
.detail-reason { font-size: 11px; color: var(--warn); }
.detail-reject { font-size: 10px; color: var(--danger); margin-top: 4px; }

.detail-sql {
  margin: 12px 20px; padding: 12px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: var(--font); font-size: 12px; line-height: 1.5;
  white-space: pre-wrap; word-break: break-all;
  font-variant-ligatures: none; color: var(--text);
}

.detail-result-header {
  padding: 8px 20px; font-size: 10px; color: var(--text-dim);
  border-top: 1px solid var(--border);
}
.detail-result {
  flex: 1; margin: 0 16px 12px; padding: 12px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: var(--font); font-size: 11px; line-height: 1.5;
  white-space: pre-wrap; overflow-y: auto; color: var(--text);
}
.detail-error {
  flex: 1; margin: 0 16px 12px; padding: 12px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: var(--font); font-size: 11px; color: var(--danger);
}

.detail-actions {
  display: flex; justify-content: flex-end; align-items: center; gap: 6px;
  padding: 8px 16px;
  background: var(--surface); border-top: 1px solid var(--border);
}
.detail-actions button {
  font-family: var(--font); font-size: 10px;
  padding: 4px 12px; border-radius: var(--radius);
  cursor: pointer; transition: all 0.15s;
}
.btn-approve {
  background: var(--glow-dim); color: var(--text);
  border: 1px solid var(--glow);
}
.btn-approve:hover { background: #1a9944; }
.btn-reject {
  background: transparent; color: var(--danger);
  border: 1px solid var(--danger);
}
.btn-reject:hover { background: rgba(244,71,71,0.1); }
.btn-ghost {
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border);
}
.btn-ghost:hover { color: var(--text); border-color: var(--text-dim); }
</style>
