<script setup lang="ts">
// ── ⚙ 配置「胶囊」Tab ─────────────────────────────────
//   上段:胶囊目录(时空胶囊的落盘位置,空=恢复默认)
//   下段:Wiki 仓库 SSH 地址(仅公钥;保存即自动 clone)+ 同步状态。
//   写操作后端限超管,普通用户输入禁用只读展示。

import { ref, onMounted } from 'vue'
import type { WikiStatus } from '@/types'
import { apiJson } from '@/utils/api-fetch'
import { fmtTime } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const capDir = ref('')
const capInfo = ref<{ dir?: string; exists?: boolean; entryCount?: number }>({})
const capMsg = ref('')

const wikiUrl = ref('')
const wikiInfo = ref<Partial<WikiStatus>>({})
const wikiMsg = ref('')
const wikiBusy = ref(false)

async function loadAll(): Promise<void> {
  try {
    const cap = await apiJson('/api/capsule/config')
    capDir.value = cap.data?.dir || ''
    capInfo.value = cap.data || {}
  } catch { /* ignore */ }
  try {
    const w = await apiJson('/api/wiki/config')
    wikiUrl.value = w.data?.url || ''
    wikiInfo.value = w.data || {}
  } catch { /* ignore */ }
}

async function saveCapDir(): Promise<void> {
  capMsg.value = ''
  try {
    const res = await apiJson('/api/capsule/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: capDir.value.trim() }),
    })
    capDir.value = res.data?.dir || ''
    capInfo.value = res.data || {}
    capMsg.value = '✅ 已保存,监听已切换'
  } catch (e: unknown) {
    capMsg.value = (e as Error).message
  }
}

async function saveWiki(): Promise<void> {
  wikiMsg.value = ''
  wikiBusy.value = true
  try {
    const res = await apiJson('/api/wiki/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: wikiUrl.value.trim() }),
    })
    const sync = res.data?.sync
    wikiInfo.value = { ...res.data }
    delete (wikiInfo.value as Record<string, unknown>).sync
    wikiMsg.value = sync ? `同步:${sync.status} — ${sync.message || ''}` : '✅ 已保存(仓库已克隆,改动走「手动 Pull」)'
  } catch (e: unknown) {
    wikiMsg.value = (e as Error).message
  } finally {
    wikiBusy.value = false
  }
}

async function pullWiki(): Promise<void> {
  wikiMsg.value = ''
  wikiBusy.value = true
  try {
    const res = await apiJson('/api/wiki/pull', { method: 'POST' })
    wikiMsg.value = `${res.data?.status}:${res.data?.message || ''}`
    const w = await apiJson('/api/wiki/config')
    wikiInfo.value = w.data || {}
  } catch (e: unknown) {
    wikiMsg.value = (e as Error).message
  } finally {
    wikiBusy.value = false
  }
}

onMounted(loadAll)
</script>

<template>
  <div class="wp">
    <!-- 上段:胶囊目录 -->
    <section class="wp-sec">
      <h4>⏳ 时空胶囊目录</h4>
      <p class="wp-desc">AI「时空胶囊」文档的落盘位置,面板监听此目录并在新胶囊到达时弹卡。</p>
      <div class="wp-row">
        <input v-model="capDir" class="wp-input mono" :disabled="!auth.isSuper" placeholder="~/.code-panel-capsules(留空恢复默认)" @keyup.enter="saveCapDir" />
        <button v-if="auth.isSuper" class="wp-btn" :disabled="capDir === (capInfo.dir || '')" @click="saveCapDir">保存</button>
      </div>
      <p class="wp-state">
        {{ capInfo.exists ? `✅ 目录存在 · ${capInfo.entryCount ?? 0} 个条目` : '⚠ 目录不存在(保存时自动创建)' }}
      </p>
      <p v-if="capMsg" class="wp-msg">{{ capMsg }}</p>
    </section>

    <!-- 下段:Wiki 仓库 -->
    <section class="wp-sec">
      <h4>📖 Wiki 仓库</h4>
      <p class="wp-desc">个人文档仓库(git)。仅支持 SSH 公钥地址,面板不存任何账号密码;拉取后可在左上角 📖 浏览。<b>写入与 push 由终端里的 claude code 完成。</b></p>
      <div class="wp-row">
        <input v-model="wikiUrl" class="wp-input mono" :disabled="!auth.isSuper" placeholder="git@gitee.com:you/wiki.git" @keyup.enter="saveWiki" />
        <button v-if="auth.isSuper" class="wp-btn" :disabled="wikiBusy || !wikiUrl.trim()" @click="saveWiki">
          {{ wikiBusy ? '同步中…' : wikiInfo.cloned ? '保存' : '保存并克隆' }}
        </button>
      </div>
      <p class="wp-state">
        <template v-if="wikiInfo.cloned && wikiInfo.empty">
          ✅ 已克隆(空仓库,还没有首个提交)—— 归档第一篇文档后即正常
        </template>
        <template v-else-if="wikiInfo.cloned">
          ✅ 已克隆 · {{ wikiInfo.branch || '?' }} · {{ wikiInfo.commit || '' }}
          <template v-if="wikiInfo.dirty"> · ⚠ {{ wikiInfo.dirty }} 个未提交改动</template>
          · 上次拉取 {{ fmtTime(wikiInfo.lastPullAt) || '—' }}
        </template>
        <template v-else-if="wikiInfo.url">⚠ 地址已配置但未克隆(点「保存并克隆」)</template>
        <template v-else>未配置</template>
      </p>
      <p class="wp-state dim">克隆位置:{{ wikiInfo.clonePath || '~/.code-panel/wiki' }}</p>
      <div v-if="auth.isSuper && wikiInfo.cloned" class="wp-row">
        <button class="wp-btn ghost" :disabled="wikiBusy" @click="pullWiki">↻ 手动 Pull</button>
      </div>
      <p v-if="wikiMsg" class="wp-msg">{{ wikiMsg }}</p>
    </section>
  </div>
</template>

<style scoped>
.wp { display: flex; flex-direction: column; gap: 18px; }
.wp-sec h4 { margin: 0 0 4px; font-size: 13px; color: var(--text); }
.wp-desc { margin: 0 0 10px; font-size: 11px; color: var(--text-dim); line-height: 1.7; }
.wp-desc b { color: var(--glow); }
.wp-row { display: flex; gap: 8px; align-items: center; }
.wp-input {
  flex: 1; min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg, #09090b);
  color: var(--text);
  font-size: 12px; outline: none;
}
.wp-input:focus { border-color: var(--glow-dim); }
.wp-input:disabled { opacity: 0.5; }
.wp-input.mono { font-family: var(--font, monospace); }
.wp-btn {
  padding: 7px 18px; flex-shrink: 0;
  border: none; border-radius: 4px;
  background: var(--glow, #22ee66); color: #09090b;
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.wp-btn:disabled { opacity: 0.4; cursor: default; }
.wp-btn.ghost {
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border);
}
.wp-btn.ghost:hover:not(:disabled) { color: var(--glow); border-color: var(--glow-dim); }
.wp-state { margin: 8px 0 0; font-size: 11px; color: var(--text-dim); line-height: 1.7; }
.wp-state.dim { opacity: 0.7; font-family: var(--font, monospace); font-size: 10px; }
.wp-msg { margin: 6px 0 0; font-size: 11px; color: var(--glow); word-break: break-all; }
</style>
