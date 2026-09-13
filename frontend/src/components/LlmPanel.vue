<script setup lang="ts">
// ── 模型供应商管理(嵌入 ⚙ 配置「模型」Tab)────────────────
//   布局:上面一排供应商卡片(点哪张,下面的变量表整片换成哪家),下面逐行变量表单。
//   每行 = 变量名 + 输入框(可直接改);敏感键(TOKEN/KEY)默认密码态,点 👁 拉真值显示。
//   模板占位符 <你的Key>:未填时显示为空框 + 提示,导出时跳过(不会把字面量写进配置)。

import { ref, computed, onMounted } from 'vue'
import { errText } from '@/utils/api-fetch'
import { useLlmStore, type LlmProvider } from '@/stores/llm'
import { useGlmPlanStore, countdown, usageColor } from '@/stores/glm-plan'
import { useAuthStore } from '@/stores/auth'

const llm = useLlmStore()
const auth = useAuthStore()
const glm = useGlmPlanStore()
glm.init()   // 幂等:恢复开关,已开启则起轮询

/** 编辑区一行变量 */
interface Entry {
  key: string
  value: string
  sensitive: boolean
  /** 还是模板占位符(没填真值) */
  unfilled: boolean
  /** 占位符原文,未填时保存会还原它 */
  raw: string
  /** 密码态已切换为明文显示 */
  shown: boolean
}

const msg = ref('')
const err = ref('')
const busy = ref(false)

const editId = ref<string | null>(null)   // null = 没选中(新建时也为 null,靠 isNew 区分)
const isNew = ref(false)
const editName = ref('')
const editEnabled = ref(true)
const editEntries = ref<Entry[]>([])
const savedSnap = ref('')
const revealed = ref('')                  // 该供应商的明文 vars(点👁 后缓存)

const dirty = computed(() => snap() !== savedSnap.value)
function snap() {
  return JSON.stringify({
    name: editName.value,
    enabled: editEnabled.value,
    entries: editEntries.value.map(e => [e.key, e.value]),
  })
}

// ── 预设模板(前端常量;token 处留占位符,用户只填值)─────────
const PRESETS: { key: string; label: string; name: string; vars: string }[] = [
  {
    key: 'deepseek', label: 'DeepSeek', name: 'DeepSeek',
    vars: [
      'ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic',
      'ANTHROPIC_AUTH_TOKEN=<你的DeepSeek Key>',
      'ANTHROPIC_MODEL=deepseek-flash[1m]',
      'ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-flash[1m]',
      'ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-flash[1m]',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-flash',
      'CLAUDE_CODE_SUBAGENT_MODEL=deepseek-flash',
      'CLAUDE_CODE_EFFORT_LEVEL=max',
      'CLAUDE_CODE_AUTO_COMPACT_WINDOW=786432',
    ].join('\n'),
  },
  {
    key: 'glm', label: '智谱 GLM', name: '智谱 GLM',
    vars: [
      'ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic',
      'ANTHROPIC_AUTH_TOKEN=<你的智谱 Key>',
      'ANTHROPIC_MODEL=glm-5.3[1m]',
      'ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.3[1m]',
      'ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.3[1m]',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5.3-flash',
      'CLAUDE_CODE_SUBAGENT_MODEL=glm-5.3[1m]',
      'CLAUDE_CODE_EFFORT_LEVEL=max',
      'CLAUDE_CODE_AUTO_COMPACT_WINDOW=786432',
    ].join('\n'),
  },
  {
    key: 'kimi', label: 'Kimi', name: 'Kimi',
    vars: [
      'ANTHROPIC_BASE_URL=https://api.moonshot.cn/anthropic',
      'ANTHROPIC_AUTH_TOKEN=<你的Moonshot Key>',
      'ANTHROPIC_MODEL=kimi-k2.7-code',
      'ANTHROPIC_DEFAULT_OPUS_MODEL=kimi-k2.7-code',
      'ANTHROPIC_DEFAULT_SONNET_MODEL=kimi-k2.7-code',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL=kimi-k2.7-code',
      'CLAUDE_CODE_SUBAGENT_MODEL=kimi-k2.7-code',
      'CLAUDE_CODE_EFFORT_LEVEL=max',
      'CLAUDE_CODE_AUTO_COMPACT_WINDOW=262144',
    ].join('\n'),
  },
  {
    key: 'custom', label: '自定义/中转站', name: '',
    vars: [
      'ANTHROPIC_BASE_URL=<你的中转站地址>',
      'ANTHROPIC_AUTH_TOKEN=<你的 API Key>',
      'ANTHROPIC_MODEL=<模型名>',
    ].join('\n'),
  },
]

const SENSITIVE_RE = /TOKEN|KEY|SECRET|PASSWORD/i
const isPlaceholder = (v: string) => /^\s*<[^<>]*>\s*$/.test(v || '')

/** 文本 → 编辑行 */
function parseEntries(text: string): Entry[] {
  const out: Entry[] = []
  for (const line of String(text || '').split('\n')) {
    let s = line.trim()
    if (!s || s.startsWith('#')) continue
    if (s.startsWith('export ')) s = s.slice(7).trim()
    const eq = s.indexOf('=')
    if (eq <= 0) continue
    const key = s.slice(0, eq).trim()
    let value = s.slice(eq + 1).trim()
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    const unfilled = isPlaceholder(value)
    out.push({
      key,
      value: unfilled ? '' : value,
      sensitive: SENSITIVE_RE.test(key),
      unfilled,
      raw: unfilled ? value : '',
      shown: false,
    })
  }
  return out
}

/** 编辑行 → vars 文本(未填的占位符原样还原,保证 unfilled 状态不丢) */
function buildVars(): string {
  return editEntries.value
    .filter(e => e.key.trim())
    .map(e => {
      const v = e.value.trim() ? e.value : (e.unfilled ? e.raw : '')
      return `${e.key.trim()}=${v}`
    })
    .join('\n')
}

// ── 卡片选择 / 载入 ─────────────────────────────────────
function confirmDiscard(): boolean {
  if (!dirty.value) return true
  return window.confirm('当前有未保存的修改,切换后丢失。继续?')
}

function loadProvider(p: LlmProvider) {
  editId.value = p.id
  isNew.value = false
  editName.value = p.name
  editEnabled.value = p.enabled
  editEntries.value = parseEntries(p.vars)
  revealed.value = ''
  msg.value = ''
  err.value = ''
  savedSnap.value = snap()
}

function selectCard(p: LlmProvider) {
  if (p.id === editId.value) return
  if (!confirmDiscard()) return
  loadProvider(p)
}

function startAdd() {
  if (!confirmDiscard()) return
  editId.value = null
  isNew.value = true
  editName.value = PRESETS[0].name
  editEnabled.value = true
  editEntries.value = parseEntries(PRESETS[0].vars)
  revealed.value = ''
  msg.value = ''
  err.value = ''
  savedSnap.value = ''
}

function applyPreset(key: string) {
  const p = PRESETS.find(x => x.key === key)
  if (!p) return
  editEntries.value = parseEntries(p.vars)
  if (p.name) editName.value = p.name
}

// ── 变量行操作 ──────────────────────────────────────────
function addRow() {
  editEntries.value.push({ key: '', value: '', sensitive: false, unfilled: false, raw: '', shown: false })
}

function removeRow(i: number) {
  editEntries.value.splice(i, 1)
}

/** 点👁:拉明文(仅超管)后把该行换成真实值;再点收回去 */
async function toggleEye(i: number) {
  const e = editEntries.value[i]
  if (e.shown) { e.shown = false; return }
  if (!editId.value) { e.shown = true; return }   // 新建未保存:没有明文可拉,直接显示所填内容
  busy.value = true
  err.value = ''
  try {
    if (!revealed.value) revealed.value = await llm.reveal(editId.value)
    const line = revealed.value.split('\n')
      .map(l => l.trim().replace(/^export\s+/, ''))
      .find(l => l.slice(0, l.indexOf('=')).trim() === e.key)
    if (line) {
      const v = line.slice(line.indexOf('=') + 1).trim()
      e.value = v.replace(/^"|"$/g, '').replace(/^'|'$/g, '')
      e.unfilled = false
    }
    e.shown = true
  } catch (ex: unknown) {
    err.value = errText(ex, '读取明文失败')
  } finally {
    busy.value = false
  }
}

// ── 保存 / 切换 / 删除 ──────────────────────────────────
async function save(): Promise<boolean> {
  err.value = ''
  if (!editName.value.trim()) { err.value = '请填写供应商名称'; return false }
  if (!editEntries.value.some(e => e.key.trim())) { err.value = '至少配置一行变量'; return false }
  busy.value = true
  try {
    const payload = { name: editName.value.trim(), vars: buildVars(), enabled: editEnabled.value }
    const beforeIds = new Set(llm.providers.map(p => p.id))
    const wasNew = isNew.value
    const id = editId.value
    if (wasNew) {
      await llm.addProvider(payload)
    } else if (id) {
      await llm.updateProvider(id, payload)
    }
    // 保存后重新载入(新建 → 找快照里新出现的那个 id)
    const cur = wasNew
      ? llm.providers.find(p => !beforeIds.has(p.id))
      : llm.providers.find(p => p.id === id)
    if (cur) loadProvider(cur)
    msg.value = '✓ 已保存'
    return true
  } catch (e: unknown) {
    err.value = errText(e, '保存失败')
    return false
  } finally {
    busy.value = false
  }
}

async function setActive() {
  // 有未保存改动(含新建)先落盘,否则切上去的还是旧值
  if (dirty.value || isNew.value) {
    if (!(await save())) return
  }
  const id = editId.value
  if (!id) return
  busy.value = true
  err.value = ''
  try {
    await llm.activate(id)
    const p = llm.providers.find(x => x.id === id)
    if (p) loadProvider(p)
    msg.value = '✅ 已设为生效 → 新开终端 claude 即用'
  } catch (e: unknown) {
    err.value = errText(e, '切换失败')
  } finally {
    busy.value = false
  }
}

async function deactivate() {
  err.value = ''
  busy.value = true
  try {
    await llm.activate(null)
    msg.value = '↩ 已停用注入 → claude 走官方登录态'
  } catch (e: unknown) {
    err.value = errText(e, '操作失败')
  } finally {
    busy.value = false
  }
}

async function removeCard() {
  if (!editId.value) { startAddReset(); return }
  const p = llm.providers.find(x => x.id === editId.value)
  if (!p) return
  if (!window.confirm(`删除供应商「${p.name}」?(Key 一并从数据库移除)继续?`)) return
  busy.value = true
  err.value = ''
  try {
    await llm.removeProvider(p.id)
    msg.value = `已删除「${p.name}」`
    editId.value = null
    isNew.value = false
    editEntries.value = []
    savedSnap.value = ''
  } catch (e: unknown) {
    err.value = errText(e, '删除失败')
  } finally {
    busy.value = false
  }
}

function startAddReset() {
  editId.value = null
  isNew.value = false
  editEntries.value = []
  editName.value = ''
  savedSnap.value = ''
}

const editing = computed(() => isNew.value || !!editId.value)

onMounted(async () => {
  try {
    await llm.load()
    const first = llm.providers.find(p => p.id === llm.activeId) ?? llm.providers[0]
    if (first) loadProvider(first)
  } catch (e: unknown) {
    err.value = errText(e)
  }
})
</script>

<template>
  <div class="llm-root">
    <!-- ── Plan 额度(智谱 Coding Plan;Key 用下方智谱供应商的,后端代查不出服务端)── -->
    <div class="plan-card">
      <div class="plan-head">
        <span class="plan-title">⚡ Plan 额度</span>
        <span v-if="glm.quota" class="plan-sub">{{ glm.quota.providerName }} · {{ glm.quota.level || '—' }}</span>
        <span class="spacer" />
        <label class="en-switch" title="开启后每 2 分钟查询智谱 Coding Plan 剩余额度">
          <input type="checkbox" :checked="glm.enabled" @change="glm.setEnabled(($event.target as HTMLInputElement).checked)" />Plan 查询
        </label>
        <label class="en-switch" title="右上角(CPU/内存圆环旁)显示两个迷你仪表盘">
          <input type="checkbox" :checked="glm.topbar" :disabled="!glm.enabled" @change="glm.setTopbar(($event.target as HTMLInputElement).checked)" />top-bar 提醒
        </label>
        <button class="ghost sm" :disabled="!glm.enabled || glm.loading" @click="glm.refresh()">
          {{ glm.loading ? '查询中…' : '↻ 刷新' }}
        </button>
      </div>
      <template v-if="glm.enabled">
        <div v-for="p in glm.quota?.pools ?? []" :key="p.key" class="pool">
          <span class="pool-name">{{ p.label }}</span>
          <div class="pool-bar"><div class="pool-fill" :style="{ width: p.percent + '%', background: usageColor(p.percent) }" /></div>
          <span class="pool-pct" :style="{ color: usageColor(p.percent) }">{{ Math.round(p.percent) }}%</span>
          <span class="pool-detail">剩余 {{ p.remaining.toLocaleString() }} / {{ p.total.toLocaleString() }} · {{ countdown(p.resetAt) }}</span>
        </div>
        <div v-if="!glm.quota && glm.loading" class="plan-hint">查询中…</div>
        <div v-else-if="!glm.quota && glm.err" class="plan-err">✗ {{ glm.err }}</div>
        <div v-if="glm.quota && glm.err" class="plan-err soft">最近一次查询失败:{{ glm.err }}(以上为旧数据)</div>
      </template>
      <div v-else class="plan-hint">开启后自动查询智谱 Coding Plan 剩余额度(Key 用下方智谱供应商的,后端代查、每 2 分钟刷新,不经过浏览器)</div>
    </div>

    <!-- ── 顶部:供应商卡片(点哪张,下面换成哪家)── -->
    <div class="cards">
      <button
        v-for="p in llm.providers" :key="p.id"
        class="card" :class="{ on: p.id === editId, live: p.id === llm.activeId, off: !p.enabled }"
        :title="p.baseUrl || p.name"
        @click="selectCard(p)"
      >
        <span class="c-name">{{ p.name }}</span>
        <span v-if="p.id === llm.activeId" class="c-badge live">● 生效中</span>
        <span v-else-if="!p.enabled" class="c-badge off">已停用</span>
        <span v-else-if="p.unfilledKeys.length" class="c-badge warn">待填</span>
      </button>
      <button v-if="auth.isSuper" class="card add" :class="{ on: isNew }" @click="startAdd">＋ 添加</button>
    </div>

    <!-- ── 中部:变量表单 ── -->
    <div v-if="!editing" class="hint">
      <template v-if="llm.providers.length">点上面的卡片编辑,或「＋ 添加」新建一套供应商。</template>
      <template v-else>还没有供应商,点「＋ 添加」用预设模板建一个(DeepSeek / GLM / Kimi)。</template>
    </div>

    <div v-else class="form">
      <div class="form-head">
        <input v-model="editName" class="f-name" placeholder="供应商名称(如 DeepSeek)" />
        <select v-if="isNew" class="f-preset" @change="applyPreset(($event.target as HTMLSelectElement).value)">
          <option v-for="x in PRESETS" :key="x.key" :value="x.key">预设:{{ x.label }}</option>
        </select>
        <span class="spacer" />
        <span class="badge" :class="editId === llm.activeId ? 'live' : ''">
          {{ editId === llm.activeId ? '● 当前生效' : '未生效' }}
        </span>
      </div>

      <div class="rows">
        <div v-for="(e, i) in editEntries" :key="i" class="row">
          <input v-model="e.key" class="k" placeholder="变量名" spellcheck="false" :disabled="!auth.isSuper" />
          <div class="v-wrap">
            <input
              v-model="e.value"
              class="v"
              spellcheck="false"
              :type="e.sensitive && !e.shown ? 'password' : 'text'"
              :placeholder="e.unfilled ? `填写${e.raw.replace(/^<|>$/g, '')}` : ''"
              :disabled="!auth.isSuper"
              @keyup.enter="save"
            />
            <button
              v-if="e.sensitive" class="eye" :disabled="busy"
              :title="e.shown ? '隐藏' : '显示明文(仅超管)'" @click="toggleEye(i)"
            >{{ e.shown ? '🙈' : '👁' }}</button>
          </div>
          <button v-if="auth.isSuper" class="del" title="删除这一行" @click="removeRow(i)">✕</button>
          <span v-else class="del-ph" />
        </div>
      </div>

      <div v-if="auth.isSuper" class="row-add">
        <button class="ghost sm" @click="addRow">＋ 加一行变量</button>
      </div>

    </div>

    <div v-if="msg" class="ok">{{ msg }}</div>
    <div v-if="err" class="err">{{ err }}</div>

    <!-- ── 底部:全局状态 ── -->
    <div class="stat">
      <span>
        当前生效:<b>{{ llm.activeName || '不注入(官方登录态)' }}</b>
        <button v-if="llm.activeId && auth.isSuper" class="link" :disabled="busy" @click="deactivate">↩ 停用注入</button>
      </span>
      <span class="stat-right" :class="{ ok: llm.rcMounted }">rc {{ llm.rcMounted ? '✓ 已挂载' : '✗ 未挂载' }}</span>
    </div>
    <div class="path">{{ llm.envFile || '~/.code-panel/active-llm.sh' }} · 切换会同步 {{ llm.settingsFile || '~/.claude/settings.json' }}</div>
    <div v-if="llm.foreignKeys.length" class="warn">
      ⚠ {{ llm.settingsFile }} 里还有不受面板管的第三方配置:{{ llm.foreignKeys.join(', ') }}
      (settings.json 优先级高于环境变量,可能压过面板配置;建议并入某套供应商后由面板统一管理)
    </div>

    <!-- ── 吸底操作条(变量多时按钮不会被滚出视野)── -->
    <div v-if="editing && auth.isSuper" class="actionbar">
      <button class="ghost danger" @click="removeCard">{{ isNew ? '取消' : '删除' }}</button>
      <span class="spacer" />
      <label class="en-switch" title="停用后不出现在右上角切换器">
        <input type="checkbox" v-model="editEnabled" />启用
      </label>
      <button class="ghost" :disabled="busy" @click="save">保存</button>
      <button
        class="primary" :disabled="busy || editId === llm.activeId"
        :title="editId === llm.activeId ? '已是当前生效项' : '全局切换到此供应商'"
        @click="setActive"
      >{{ editId === llm.activeId ? '✓ 生效中' : '设为生效' }}</button>
    </div>
  </div>
</template>

<style scoped>
.llm-root { display: flex; flex-direction: column; gap: 10px; }
.hint { font-size: 12px; color: var(--text-dim); text-align: center; padding: 20px 0; line-height: 1.8; }

/* ── Plan 额度卡 ── */
.plan-card { display: flex; flex-direction: column; gap: 7px; border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; background: var(--bg); }
.plan-head { display: flex; align-items: center; gap: 8px; }
.plan-head .en-switch { white-space: nowrap; }
.plan-title { font-size: 12px; font-weight: 700; color: var(--text); }
.plan-sub { font-size: 10px; color: var(--text-dim); }
.pool { display: flex; align-items: center; gap: 8px; }
.pool-name { flex: 0 0 34px; font-size: 11px; font-weight: 600; color: var(--text); }
.pool-bar { flex: 0 0 220px; height: 10px; border-radius: 5px; background: rgba(255,255,255,0.06); overflow: hidden; }
.pool-fill { height: 100%; border-radius: 5px; transition: width 0.8s ease, background 0.4s ease; }
.pool-pct { flex: 0 0 38px; font-size: 12px; font-weight: 700; font-family: var(--font, monospace); text-align: right; }
.pool-detail { font-size: 10px; color: var(--text-dim); font-family: var(--font, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-hint { font-size: 11px; color: var(--text-dim); line-height: 1.6; }
.plan-err { font-size: 11px; color: #f44747; }
.plan-err.soft { color: #e5c07b; }
.ok { font-size: 11px; color: var(--glow); }
.err { font-size: 11px; color: #f44747; }
.spacer { flex: 1; }

/* ── 顶部卡片 ── */
.cards { display: flex; flex-wrap: wrap; gap: 8px; }
.card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
  min-width: 132px; padding: 9px 14px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text-dim); cursor: pointer; transition: all .15s; text-align: left;
}
.card:hover { border-color: var(--text-dim); color: var(--text); }
.card.on { border-color: var(--glow-dim); background: rgba(34,238,102,0.06); color: var(--text); box-shadow: 0 0 0 1px var(--glow-dim) inset; }
.card.off { opacity: .5; }
.card.add { min-width: 78px; align-items: center; justify-content: center; border-style: dashed; font-size: 12px; }
.c-name { font-size: 13px; font-weight: 700; }
.card.live .c-name { color: var(--glow); }
.c-badge { font-size: 9px; padding: 1px 7px; border-radius: 8px; }
.c-badge.live { color: var(--glow); border: 1px solid var(--glow-dim); }
.c-badge.off { color: var(--text-dim); border: 1px solid var(--border); }
.c-badge.warn { color: #e5c07b; border: 1px solid rgba(229,192,123,0.4); }

/* ── 变量表单 ── */
.form { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; background: var(--bg); }
.form-head { display: flex; align-items: center; gap: 8px; }
.f-name { flex: 0 0 240px; padding: 7px 10px; font-size: 13px; font-weight: 600; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 4px; outline: none; }
.f-name:focus { border-color: var(--glow-dim); }
.f-preset { padding: 7px 10px; font-size: 12px; background: var(--surface); color: var(--text-dim); border: 1px solid var(--border); border-radius: 4px; outline: none; cursor: pointer; }
.badge { font-size: 10px; padding: 2px 9px; border-radius: 8px; color: var(--text-dim); border: 1px solid var(--border); }
.badge.live { color: var(--glow); border-color: var(--glow-dim); }

.rows { display: flex; flex-direction: column; gap: 5px; margin-top: 2px; }
.row { display: flex; align-items: center; gap: 8px; }
.row .k {
  flex: 0 0 296px; padding: 6px 9px; font-size: 11px; font-family: var(--font);
  background: var(--surface); color: var(--glow); border: 1px solid var(--border); border-radius: 4px; outline: none;
}
.v-wrap { flex: 1; display: flex; align-items: center; gap: 0; position: relative; min-width: 0; }
.row .v {
  flex: 1; width: 100%; padding: 6px 9px; font-size: 11px; font-family: var(--font);
  background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 4px; outline: none; min-width: 0;
}
.row .k:focus, .row .v:focus { border-color: var(--glow-dim); }
.row .k:disabled, .row .v:disabled { opacity: .65; }
.row .v::placeholder { color: var(--text-dim); opacity: .7; font-style: italic; }
.eye { margin-left: -30px; margin-right: 4px; z-index: 1; background: transparent; border: none; cursor: pointer; font-size: 12px; padding: 2px 4px; opacity: .75; }
.eye:hover { opacity: 1; }
.del, .del-ph { flex: 0 0 24px; text-align: center; background: transparent; border: 1px solid transparent; color: var(--text-dim); border-radius: 4px; font-size: 11px; padding: 3px 0; cursor: pointer; }
.del:hover { color: #f44747; border-color: #f44747; }

.row-add { margin-top: 2px; }
button.ghost.sm { padding: 4px 12px; font-size: 11px; border-style: dashed; }

/* 吸底操作条:变量行多时(如 GLM 13 行)按钮仍常驻可见 */
.actionbar {
  position: sticky; bottom: -14px;   /* 抵掉 .modal-body 的 14px 下内边距,贴到弹窗底边 */
  z-index: 3;
  display: flex; align-items: center; gap: 8px;
  margin: 4px -16px -14px;           /* 左右拉满,盖住滚动内容 */
  padding: 10px 16px 14px;
  background: var(--surface);
  border-top: 1px solid var(--border);
}
.en-switch { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-dim); cursor: pointer; }
.en-switch input { accent-color: var(--glow); cursor: pointer; }

/* ── 底部状态 ── */
.stat { display: flex; align-items: center; font-size: 11px; color: var(--text-dim); }
.stat b { color: var(--glow); font-weight: 600; }
.stat-right { margin-left: auto; }
.stat-right.ok { color: var(--glow); }
.link { background: transparent; border: none; color: var(--text-dim); font-size: 11px; cursor: pointer; text-decoration: underline; margin-left: 8px; }
.link:hover { color: var(--danger, #f44747); }
.path { font-family: var(--font, monospace); font-size: 9px; color: var(--text-dim); opacity: .7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.warn { font-size: 11px; color: #e5c07b; background: rgba(229,192,123,0.08); border: 1px solid rgba(229,192,123,0.3); border-radius: 6px; padding: 6px 10px; line-height: 1.7; }

button.ghost:hover { color: var(--text); }
button.ghost.danger:hover { color: #f44747; border-color: #f44747; }
button.ghost:disabled { opacity: .5; cursor: default; }
</style>
