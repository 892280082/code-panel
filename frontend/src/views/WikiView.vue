<script setup lang="ts">
// ── Wiki 页(/wiki)──────────────────────────────────────
//   浏览面板克隆的个人 wiki 仓库(~/.code-panel/wiki,⚙ → 胶囊 Tab 配置)。
//   左:文件树(useFileTree 压缩树);右:整屏 iframe = /api/wiki/view
//   双栏页(buildViewPage 渲染,md 内链走 wiki 自己的路由)。
//   写入与 push 由终端 claude code 做,本页只读 + Pull。

import { ref, computed, onMounted, watch } from 'vue'
import { apiJson } from '@/utils/api-fetch'
import Sidebar from '@/components/Sidebar.vue'
import TopRightTools from '@/components/TopRightTools.vue'
import { useFileTree, type FileTreeNode } from '@/composables/useFileTree'
import { useUiStore } from '@/stores/ui'
import { copyText } from '@/utils/clipboard'

interface WikiFile { path: string; name: string; size: number; mtime: number }

const ui = useUiStore()

const files = ref<WikiFile[]>([])
const cloned = ref(true)
const currentFile = ref('')
const frameKey = ref(0)

const { visibleRows, toggleDir } = useFileTree<WikiFile>(files)

const frameSrc = computed(() => {
  if (!cloned.value) return ''
  const f = currentFile.value ? `?file=${encodeURIComponent(currentFile.value)}` : ''
  return `/api/wiki/view${f}`
})

async function load(): Promise<void> {
  try {
    const res = await apiJson('/api/wiki/files')
    cloned.value = !!res.data?.cloned
    files.value = res.data?.files || []
    // 默认入口:README/index 优先(后端 view 也会兜底,这里选中侧栏高亮)
    if (!currentFile.value) {
      const hit = files.value.find(f => /^(readme|index)\.md$/i.test(f.name))
      if (hit) currentFile.value = hit.path
    }
  } catch {
    cloned.value = false
  }
}

function pick(f: WikiFile): void {
  currentFile.value = f.path
  frameKey.value++
}

function onRow(r: { type: 'dir' | 'file'; node: FileTreeNode<WikiFile> }): void {
  if (r.type === 'dir') toggleDir(r.node.key)
  else if (r.node.item) pick(r.node.item)
}

/** 复制当前打开文档的相对路径(带 wiki: 前缀,粘给 AI 一眼知道出处) */
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function onCopyPath(): Promise<void> {
  if (!currentFile.value) return
  if (!await copyText(`wiki:${currentFile.value}`)) return
  copied.value = true
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copied.value = false }, 1500)
}

onMounted(load)
watch(() => files.value.length, () => { /* 树自动响应(computed) */ })
</script>

<template>
  <div class="app">
    <Sidebar>
      <div class="scroll-list">
        <div v-if="!cloned" class="empty-hint">
          尚未配置 wiki 仓库<br>
          <button class="init-btn" @click="ui.openConfig('capsule')">⚙ 去配置(SSH 公钥地址)</button>
        </div>
        <template v-else>
          <div
            v-for="row in visibleRows" :key="row.node.key"
            class="tree-row"
            :class="{ file: !row.node.dir, on: !row.node.dir && row.node.path === currentFile }"
            :style="{ paddingLeft: 10 + row.depth * 14 + 'px' }"
            :title="row.node.fullName"
            @click="onRow(row)"
          >
            <span class="tw">{{ row.node.dir ? '▸' : '📄' }}</span>
            <span class="tn">{{ row.node.name }}</span>
          </div>
          <div v-if="!files.length" class="empty-hint">仓库里还没有可渲染文档(md)</div>
        </template>
      </div>
    </Sidebar>

    <main class="main">
      <div class="toolbar">
        <span class="status">📖 Wiki</span>
        <span v-if="currentFile" class="status live mono" :title="currentFile">{{ currentFile }}</span>
        <button
          v-if="currentFile"
          class="copy-btn"
          title="复制当前文件相对路径(粘到终端给 claude code 引用)"
          @click="onCopyPath"
        >{{ copied ? '✓ 已复制' : '⧉' }}</button>
        <span class="toolbar-right">
          <TopRightTools />
        </span>
      </div>

      <div class="content-area">
        <div v-if="!cloned" class="empty-state">
          <span class="icon">◈</span>
          <span>尚未配置 wiki 仓库 —— ⚙ →「胶囊」Tab 填 SSH 公钥地址,保存即自动克隆</span>
          <button class="init-btn" @click="ui.openConfig('capsule')">⚙ 去配置</button>
        </div>
        <iframe v-else :key="frameKey" :src="frameSrc" class="wv-full" />
      </div>
    </main>
  </div>
</template>

<style scoped>
.app { display: flex; height: 100vh; }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.scroll-list { flex: 1; overflow-y: auto; padding: 6px; }
.empty-hint { color: var(--text-dim); font-size: 11px; text-align: center; padding: 20px 8px; line-height: 1.8; }

.tree-row {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px; border-radius: 6px; cursor: pointer;
  font-size: 12px; color: var(--text-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tree-row:hover { background: rgba(34,238,102,0.05); color: var(--text); }
.tree-row.on { color: var(--glow); background: rgba(34,238,102,0.08); }
.tree-row .tw { font-size: 10px; width: 12px; flex-shrink: 0; text-align: center; }
.tree-row .tn { overflow: hidden; text-overflow: ellipsis; }

/* 顶部状态栏复制按钮(跟在当前文件名后面) */
.copy-btn {
  height: 20px; padding: 0 8px; flex-shrink: 0;
  font-family: var(--font); font-size: 10px; cursor: pointer;
  color: var(--text-dim); background: transparent;
  border: 1px solid var(--border); border-radius: var(--radius);
  transition: color 0.12s, border-color 0.12s;
}
.copy-btn:hover { color: var(--glow); border-color: var(--glow-dim); }

.toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 14px; border-bottom: 1px solid var(--border);
  background: var(--bg); flex-shrink: 0;
}
.toolbar button {
  height: 26px; padding: 0 12px; box-sizing: border-box;
  font-size: 11px; cursor: pointer;
  color: var(--text-dim); background: transparent;
  border: 1px solid var(--border); border-radius: var(--radius);
}
.toolbar button:hover:not(:disabled) { color: var(--glow); border-color: var(--glow-dim); }
.toolbar button:disabled { opacity: 0.5; cursor: default; }
.toolbar .status { font-size: 11px; color: var(--text-dim); }
.toolbar .status.live { color: var(--glow); }
.toolbar .status.live.mono {
  font-family: var(--font, monospace); font-size: 10px;
  max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.toolbar .toolbar-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }

.content-area { flex: 1; min-height: 0; display: flex; }
.wv-full { flex: 1; border: none; width: 100%; }
.empty-state {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; color: var(--text-dim); font-size: 12px; text-align: center; padding: 0 30px;
}
.empty-state .icon { font-size: 26px; opacity: 0.6; }
.init-btn {
  padding: 6px 18px; cursor: pointer;
  color: #09090b; background: var(--glow, #22ee66);
  border: none; border-radius: 12px; font-size: 12px; font-weight: 600;
}
.init-btn:hover { filter: brightness(1.1); }
</style>
