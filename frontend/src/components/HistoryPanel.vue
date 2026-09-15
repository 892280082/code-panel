<script setup lang="ts">
import { computed } from 'vue'
import { useRepoBrowserStore } from '@/stores/repo-browser'

const store = useRepoBrowserStore()

// ── Status badge helpers ─────────────────────────────────

function statusBadge(status: string): string {
  return { added: '+', modified: '~', deleted: '−', renamed: '→' }[status] || '?'
}

const selectedCommitFilePath = computed(() => store.selectedCommitFilePath)
</script>

<template>
  <div class="history-panel">
    <!-- Loading -->
    <div v-if="store.historyLoading" class="loading-text">⏳ 加载提交历史...</div>
    <!-- Error -->
    <div v-else-if="store.historyError" class="history-error">{{ store.historyError }}</div>
    <!-- Commit diff view (when a commit is selected) -->
    <template v-else-if="store.selectedCommit">
      <!-- Commit header -->
      <div class="commit-header">
        <button class="back-btn" @click="store.selectedCommit = null">← 返回列表</button>
        <div class="commit-info">
          <span class="commit-hash">{{ (store.selectedCommit as string).slice(0, 7) }}</span>
          <span class="commit-subject">{{ store.commitSubject }}</span>
          <span class="commit-meta">
            <span class="commit-author">{{ store.commitAuthor }}</span>
            <span class="commit-date" v-if="store.commitDate">{{ store.commitDate.slice(0, 10) }}</span>
          </span>
        </div>
        <span class="commit-total-stat" v-if="store.commitFiles.length">
          <span class="commit-file-count">{{ store.commitFiles.length }} files</span>
          <span class="add">+{{ store.commitTotalAdditions }}</span>
          <span class="del">−{{ store.commitTotalDeletions }}</span>
        </span>
      </div>

      <!-- Loading file list -->
      <div v-if="store.commitFilesLoading" class="loading-text">⏳ 加载文件列表...</div>
      <div v-else-if="store.commitFilesError" class="history-error">{{ store.commitFilesError }}</div>

      <!-- File list + per-file diff -->
      <template v-else>
        <div class="commit-file-list">
          <div
            v-for="f in store.commitFiles" :key="f.path"
            class="commit-file-row"
            :class="{ selected: store.selectedCommitFilePath === f.path }"
            @click="store.selectCommitFile(f.path)"
          >
            <span class="cf-status" :class="'cfs-' + f.status">{{ statusBadge(f.status) }}</span>
            <span class="cf-path">{{ f.path }}</span>
            <span class="cf-stat">
              <span v-if="f.additions" class="add">+{{ f.additions }}</span>
              <span v-if="f.deletions" class="del">−{{ f.deletions }}</span>
            </span>
            <span v-if="store.selectedCommitFilePath === f.path" class="cf-arrow">◀</span>
          </div>
        </div>

        <!-- File diff area -->
        <div v-if="selectedCommitFilePath" class="commit-diff-area">
          <div v-if="store.commitFileDiffLoading" class="loading-text">⏳ 加载差异...</div>
          <div v-else-if="store.commitFileDiffError" class="history-error">{{ store.commitFileDiffError }}</div>
          <div v-else class="commit-diff-scroll">
            <div class="commit-file-diff-header">
              <span class="cfd-path">{{ store.selectedCommitFilePath }}</span>
              <span class="cfd-stat">
                <span class="add">+{{ store.commitFileDiffAdditions }}</span>
                <span class="del">−{{ store.commitFileDiffDeletions }}</span>
              </span>
            </div>
            <div
              v-for="(line, i) in store.commitFileDiffLines" :key="i"
              class="commit-diff-line"
              :class="'cl-' + line.type"
            >
              <span class="cl-sign">{{ line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ' }}</span>
              <span class="cl-text">{{ line.text }}</span>
            </div>
            <div v-if="!store.commitFileDiffLines.length" class="loading-text dim">暂无差异内容</div>
          </div>
        </div>

        <div v-else-if="!store.commitFiles.length" class="loading-text dim">暂无文件改动</div>
      </template>
    </template>
    <!-- Commit list (grouped by date) -->
    <template v-else>
      <div v-if="!store.fileHistoryDayGroups.length" class="loading-text dim">暂无提交记录</div>
      <div v-for="group in store.fileHistoryDayGroups" :key="group.date" class="hist-day-group">
        <div class="hist-day-header">{{ group.date }}</div>
        <div
          v-for="commit in group.commits" :key="commit.hash"
          class="hist-commit-row"
          @click="store.selectCommit(commit.hash)"
        >
          <span class="hist-hash">{{ commit.hash.slice(0, 7) }}</span>
          <span class="hist-subject">{{ commit.subject }}</span>
          <span class="hist-meta">
            <span class="hist-author">{{ commit.author }}</span>
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.history-panel {
  height: 100%; overflow-y: auto;
  display: flex; flex-direction: column;
}
.history-panel::-webkit-scrollbar { width: 6px; }
.history-panel::-webkit-scrollbar-track { background: transparent; }
.history-panel::-webkit-scrollbar-thumb { background: #1a1a22; border-radius: 3px; }
.history-error {
  padding: 16px; font-size: 11px; color: var(--danger); text-align: center;
}
.loading-text.dim { color: var(--text-dim); }

/* Day groups */
.hist-day-group { }
.hist-day-header {
  padding: 6px 16px; font-size: 10px; color: var(--text-dim);
  background: rgba(var(--line-rgb),0.25);
  border-bottom: 1px solid rgba(var(--line-rgb),0.3);
  text-transform: uppercase; letter-spacing: 0.05em;
  position: sticky; top: 0; z-index: 2;
}
.hist-commit-row {
  display: flex; align-items: baseline; gap: 10px;
  padding: 7px 16px; font-size: 11px;
  border-bottom: 1px solid rgba(var(--line-rgb),0.15);
  cursor: pointer; transition: background 0.1s;
}
.hist-commit-row:hover { background: rgba(var(--glow-rgb),0.04); }
.hist-hash {
  font-family: var(--font); font-size: 10px;
  color: var(--glow-dim); flex-shrink: 0; width: 52px;
}
.hist-subject {
  flex: 1; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hist-meta {
  display: flex; gap: 10px; flex-shrink: 0;
  font-size: 10px; color: var(--text-dim);
}
.hist-author { max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Commit diff view */
.commit-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(0,0,0,0.15);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.commit-info {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 1px;
}
.commit-hash {
  font-family: var(--font); font-size: 10px; color: var(--glow-dim);
}
.commit-subject {
  font-size: 11px; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.commit-meta {
  display: flex; gap: 10px;
  font-size: 9px; color: var(--text-dim);
}
.commit-date { font-variant-numeric: tabular-nums; }
.commit-total-stat {
  margin-left: auto; display: flex; gap: 8px; font-size: 10px;
  align-items: center;
}
.commit-file-count { color: var(--text-dim); }

/* File list */
.commit-file-list {
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  max-height: 40vh;
  overflow-y: auto;
}
.commit-file-list::-webkit-scrollbar { width: 4px; }
.commit-file-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.commit-file-row {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 16px; font-size: 11px;
  cursor: pointer; border-bottom: 1px solid rgba(var(--line-rgb),0.12);
  transition: background 0.1s;
  user-select: none;
}
.commit-file-row:hover { background: rgba(var(--glow-rgb),0.04); }
.commit-file-row.selected {
  background: rgba(var(--glow-rgb),0.08);
  border-left: 2px solid var(--glow-dim);
}
.cf-status { font-weight: 700; font-size: 11px; width: 16px; flex-shrink: 0; }
.cfs-added { color: var(--glow); }
.cfs-modified { color: var(--warn); }
.cfs-deleted { color: var(--danger); }
.cfs-renamed { color: var(--info); }
.cf-path {
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text);
}
.cf-stat {
  display: flex; gap: 6px; font-size: 10px;
  font-variant-numeric: tabular-nums; flex-shrink: 0;
}
.cf-arrow { color: var(--glow-dim); font-size: 8px; width: 12px; flex-shrink: 0; }

/* File diff inside commit */
.commit-diff-area {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.commit-file-diff-header {
  display: flex; align-items: center; gap: 10px;
  padding: 5px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(0,0,0,0.08);
  flex-shrink: 0;
}
.cfd-path {
  font-size: 10px; color: var(--text-dim);
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cfd-stat { display: flex; gap: 8px; font-size: 10px; flex-shrink: 0; }
.commit-diff-scroll {
  flex: 1; overflow-y: auto;
  font-family: var(--font); font-size: 11px; line-height: 1.5;
}
.commit-diff-scroll::-webkit-scrollbar { width: 6px; }
.commit-diff-scroll::-webkit-scrollbar-track { background: transparent; }
.commit-diff-scroll::-webkit-scrollbar-thumb { background: #1a1a22; border-radius: 3px; }
.commit-diff-line {
  display: flex; min-height: 21px;
  border-bottom: 1px solid rgba(var(--line-rgb),0.12);
}
.cl-sign {
  width: 24px; flex-shrink: 0; text-align: center;
  font-weight: 700; font-size: 11px;
  user-select: none;
}
.cl-text {
  flex: 1; padding: 1px 12px;
  white-space: pre; overflow-x: auto;
  font-variant-ligatures: none;
}
.cl-ctx { background: var(--bg); }
.cl-ctx .cl-sign { color: var(--text-dim); }
.cl-ctx .cl-text { color: var(--text); }
.cl-add { background: rgba(var(--glow-rgb),0.06); }
.cl-add .cl-sign { color: var(--glow); }
.cl-add .cl-text { color: #9aefb8; }
.cl-del { background: rgba(var(--danger-rgb),0.08); }
.cl-del .cl-sign { color: var(--danger); }
.cl-del .cl-text { color: #f09999; }

.back-btn {
  font-family: var(--font); font-size: 10px; padding: 3px 10px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; flex-shrink: 0;
}
.back-btn:hover { color: var(--text); border-color: var(--text-dim); }
</style>
