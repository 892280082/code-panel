<script setup lang="ts">
// ── Git History 面板(GitView 拆出:按天分组的 commit 列表,点击复制 hash)──
import { useGitStore, gitFormatLogTime } from '@/stores/git'
import { copyToClipboard } from '@/utils/clipboard'

const store = useGitStore()

function copyHash(hash: string) { copyToClipboard(hash) }
</script>

<template>
  <div class="log-scroll">
    <div v-if="store.logLoading" class="loading-text">加载中...</div>
    <template v-else-if="store.logResult && !store.logResult.error">
      <div class="log-header">
        <span class="log-branch">⎇ {{ store.logResult.branch }}</span>
        <span class="log-count">{{ store.logResult.totalCommits }} commits</span>
      </div>
      <div v-for="group in store.logResult.dayGroups" :key="group.date" class="log-day-group">
        <div class="log-day-header">{{ group.date }}</div>
        <div
          v-for="commit in group.commits" :key="commit.hash"
          class="log-commit"
          @click="copyHash(commit.hash)"
          :title="'点击复制: ' + commit.hash"
        >
          <span class="log-commit-hash">{{ commit.hash.slice(0, 7) }}</span>
          <span class="log-commit-subject">{{ commit.subject }}</span>
          <span class="log-commit-meta">
            <span class="log-commit-author">{{ commit.author }}</span>
            <span class="log-commit-time">{{ gitFormatLogTime(commit.date) }}</span>
          </span>
        </div>
      </div>
      <div v-if="!store.logResult.dayGroups.length" class="empty-state hint-state">
        <span>No commits found</span>
      </div>
    </template>
    <div v-else-if="store.logResult?.error" class="error-text pad">{{ store.logResult.error }}</div>
  </div>
</template>

<style scoped>
.log-scroll {
  flex: 1; overflow-y: auto;
}
.log-scroll::-webkit-scrollbar { width: 6px; }
.log-scroll::-webkit-scrollbar-track { background: transparent; }
.log-scroll::-webkit-scrollbar-thumb { background: #1a1a22; border-radius: 3px; }
.log-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 20px;
  background: var(--surface); border-bottom: 1px solid var(--border);
}
.log-branch { font-size: 12px; color: var(--text-dim); }
.log-count { font-size: 10px; color: var(--text-dim); }
.log-day-header {
  padding: 8px 20px; font-size: 10px; color: var(--text-dim);
  background: rgba(var(--line-rgb),0.3);
  border-bottom: 1px solid rgba(var(--line-rgb),0.5);
  font-family: var(--font); text-transform: uppercase; letter-spacing: 0.05em;
  position: sticky; top: 0; z-index: 2;
}
.log-commit {
  display: flex; align-items: baseline; gap: 12px;
  padding: 8px 20px; font-size: 12px;
  border-bottom: 1px solid rgba(var(--line-rgb),0.2);
  cursor: pointer; transition: background 0.1s;
}
.log-commit:hover { background: rgba(var(--glow-rgb),0.04); }
.log-commit-hash {
  font-family: var(--font); font-size: 10px;
  color: var(--glow-dim); flex-shrink: 0; width: 56px;
  user-select: all;
}
.log-commit-subject {
  flex: 1; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.log-commit-meta {
  display: flex; gap: 12px; flex-shrink: 0;
  font-size: 10px; color: var(--text-dim);
}
.log-commit-author { max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-commit-time { font-variant-numeric: tabular-nums; }
.error-text { padding: 8px 12px; font-size: 10px; color: var(--danger); }
.error-text.pad { padding: 20px; }
.loading-text { padding: 20px; font-size: 12px; color: var(--text-dim); text-align: center; }
.empty-state {
  color: var(--text-dim); font-size: 12px;
}
.hint-state { padding: 40px; }
</style>
