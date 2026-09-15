<script setup lang="ts">
// ── Redis 管理页:概览卡 + key 浏览(SCAN)+ 操作区(危险操作带确认/审批) ──
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRedisStore } from '@/stores/redis'
import { useProjectsStore } from '@/stores/projects'
import Sidebar from '@/components/Sidebar.vue'
import TopRightTools from '@/components/TopRightTools.vue'

const store = useRedisStore()
const projects = useProjectsStore()
const hasProject = computed(() => !!projects.currentProject)

// 刷新定时(30s 概览)
let infoTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  store.init()
  infoTimer = setInterval(() => { void store.loadInfo() }, 30_000)
})
onUnmounted(() => { if (infoTimer) clearInterval(infoTimer) })

// ── 交互状态 ──
const ttlInput = ref('')                       // 详情面板 TTL 输入(秒;勾永久→-1)
const ttlPermanent = ref(false)
const showFlush = ref<'db' | 'all' | null>(null)
const flushConfirmText = ref('')
const matchDeleteInput = ref('')
const showHistoryDrawer = ref(false)

const dbs = computed(() => store.info?.keyspace ?? [])
const currentConn = computed(() => store.connections.find(c => c.id === store.selectedId))
const dbJumper = ref('')                        // 手输 db 号跳转
const fmtSize = (n: number | null): string => n == null ? '—' : n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(1)}K` : n < 1073741824 ? `${(n / 1048576).toFixed(1)}M` : `${(n / 1073741824).toFixed(2)}G`
const fmtTtl = (ms: number): string => ms === -1 ? '永久' : ms === -2 ? '已消失' : ms < 60000 ? `${Math.ceil(ms / 1000)}s` : ms < 3600000 ? `${Math.ceil(ms / 60000)}m` : `${Math.ceil(ms / 3600000)}h`
const typeBadge = (t: string): string => ({ string: 'S', hash: 'H', list: 'L', set: 'S', zset: 'Z', stream: '≈' }[t] || '?')

async function applyTtl(): Promise<void> {
  if (!store.detail) return
  const ttl = ttlPermanent.value ? -1 : parseInt(ttlInput.value, 10)
  if (Number.isNaN(ttl)) return
  await store.setTtl(store.detail.key, ttl)
  ttlInput.value = ''
}

// ── 操作通知(替代 alert:4s 自动消失的顶部消息条)──
const notice = ref('')
let noticeTimer: number | undefined
function notify(text: string): void {
  notice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => { notice.value = '' }, 4000)
}

async function doFlush(): Promise<void> {
  if (!showFlush.value) return
  const want = showFlush.value === 'db' ? 'FLUSHDB' : 'FLUSHALL'
  if (flushConfirmText.value !== want) return
  const r = showFlush.value === 'db' ? await store.flushdb() : await store.flushall()
  showFlush.value = null; flushConfirmText.value = ''
  notify(r.queued ? `已提交审批(任务 ${r.jobId}),去 SQL 页审批后执行` : '已执行')
}

async function doMatchDelete(): Promise<void> {
  const m = matchDeleteInput.value.trim()
  if (!m || m === '*') { notify('模式不能为空或 *(全删请用 FLUSHDB)'); return }
  if (!confirm(`按模式删除「${m}」?危险操作${' — '}reviewMode 开启时会进审批队列`)) return
  const r = await store.deleteByMatch(m)
  matchDeleteInput.value = ''
  notify(r.queued ? `已提交审批(任务 ${r.jobId})` : `已删除 ${r.matched ?? 0} 个 key`)
}

async function doCheckedDelete(): Promise<void> {
  const n = store.checked.size
  if (!n) return
  if (!confirm(`删除勾选的 ${n} 个 key?`)) return
  const r = await store.deleteChecked()
  notify(r.queued ? `已提交审批(任务 ${r.jobId})` : `已删除 ${r.affected ?? 0} 个 key`)
}

function toggleCheck(key: string): void {
  const next = new Set(store.checked)
  if (next.has(key)) next.delete(key); else next.add(key)
  store.checked = next
}

function fmtValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

/** 模板里的确认弹窗(裸 confirm() 在 vue-tsc 模板作用域解析不到,包一层) */
const ask = (msg: string): boolean => window.confirm(msg)

const histActionLabel: Record<string, string> = {
  ttl: '改TTL', 'delete-key': '删key', 'delete-keys': '批量删', flushdb: 'FLUSHDB', flushall: 'FLUSHALL',
}
</script>

<template>
  <!-- 操作通知条(flush/批量删除等结果,4s 自动消失) -->
  <Teleport to="body">
    <div v-if="notice" class="redis-notice">{{ notice }}</div>
  </Teleport>
  <div class="app">
  <Sidebar>
    <!-- 侧栏:Redis 连接列表(存活点 + 版本) -->
    <div class="conn-list">
      <div v-for="c in store.connections" :key="c.id"
           class="conn-item" :class="{ active: c.id === store.selectedId }"
           @click="store.select(c.id)">
        <span class="dot" :class="c.alive ? 'on' : 'off'" />
        <div class="conn-text">
          <span class="conn-name">{{ c.name }}</span>
          <span class="conn-sub">{{ c.version || (c.alive ? '' : c.healthError || '未检测') }}</span>
        </div>
      </div>
      <div v-if="!store.connections.length" class="conn-empty">本项目无 redis.yaml 连接<br><small>编辑 .code-panel/redis.yaml 添加</small></div>
    </div>
  </Sidebar>

  <main class="redis-main">
    <div class="top-bar"><TopRightTools /></div>
    <template v-if="hasProject && store.selectedId">
      <!-- ── 顶栏概览卡 ── -->
      <section class="cards">
        <div class="card">
          <h4>服务器</h4>
          <div class="kv"><span>版本</span><b>{{ store.info?.version || '—' }}</b></div>
          <div class="kv"><span>角色</span><b>{{ store.info?.role || '—' }}</b></div>
          <div class="kv"><span>运行</span><b>{{ store.info ? `${store.info.uptimeDays} 天` : '—' }}</b></div>
          <div class="kv"><span>连接</span><b>{{ store.info ? `${store.info.clients.connected}${store.info.clients.max ? ' / ' + store.info.clients.max : ''}` : '—' }}</b></div>
        </div>
        <div class="card">
          <h4>内存</h4>
          <div class="membar"><div class="membar-fill" :style="{ width: store.info && store.info.memory.maxBytes > 0 ? Math.min(100, store.info.memory.usedBytes / store.info.memory.maxBytes * 100) + '%' : '42%' }" /></div>
          <div class="kv"><span>已用</span><b>{{ store.info?.memory.usedHuman || '—' }}</b></div>
          <div class="kv"><span>上限</span><b>{{ store.info?.memory.maxHuman || '—' }}</b></div>
          <div class="kv"><span>碎片率</span><b>{{ store.info?.memory.fragmentationRatio || '—' }}</b></div>
        </div>
        <div class="card">
          <h4>命中率</h4>
          <div class="big-num">{{ store.info ? store.info.hitRate.rate + '%' : '—' }}</div>
          <div class="kv"><span>hits</span><b>{{ store.info?.hitRate.hits ?? '—' }}</b></div>
          <div class="kv"><span>misses</span><b>{{ store.info?.hitRate.misses ?? '—' }}</b></div>
          <div class="kv"><span>OPS/s</span><b>{{ store.info?.opsPerSec ?? '—' }}</b></div>
        </div>
        <div class="card">
          <h4>Key 空间 <button class="mini-btn" title="刷新概览" @click="store.loadInfo()">⟳</button></h4>
          <div v-for="ks in dbs" :key="ks.db" class="kv">
            <span>db{{ ks.db }}</span><b>{{ ks.keys }} keys{{ ks.expires ? ` (${ks.expires} 有TTL)` : '' }}</b>
          </div>
          <div v-if="!dbs.length" class="muted">(无数据)</div>
        </div>
      </section>

      <!-- ── db 选择条 + key 工具条 ── -->
      <section class="toolbar">
        <div class="db-chips">
          <span class="db-chip" :class="{ active: store.currentDb === null }" @click="store.selectDb(null)">默认(db{{ currentConn?.db ?? 0 }})</span>
          <span v-for="ks in dbs" :key="ks.db" class="db-chip" :class="{ active: store.currentDb === ks.db }" @click="store.selectDb(ks.db)">
            db{{ ks.db }}<em>{{ ks.keys }}</em>
          </span>
          <input v-model="dbJumper" class="db-jump" placeholder="db号↵" @keydown.enter="store.selectDb(parseInt(dbJumper, 10))">
        </div>
        <div class="key-tools">
          <input v-model="store.match" class="match-input" placeholder="MATCH 模式,如 cache:*" @keydown.enter="store.loadKeys(true)">
          <button class="mini-btn" @click="store.loadKeys(true)">🔍 搜索</button>
          <button class="mini-btn" :disabled="!store.checked.size" @click="doCheckedDelete">🗑 删勾选({{ store.checked.size }})</button>
          <input v-model="matchDeleteInput" class="match-input" placeholder="按模式删,如 cache:*" @keydown.enter="doMatchDelete">
          <button class="mini-btn danger" @click="doMatchDelete">删</button>
          <button class="mini-btn danger" @click="showFlush = 'db'">FLUSHDB</button>
          <button class="mini-btn danger" @click="showFlush = 'all'">FLUSHALL</button>
          <button class="mini-btn" @click="showHistoryDrawer = true">🕘 记录</button>
        </div>
      </section>

      <!-- ── key 列表 + 详情 ── -->
      <section class="keys-area">
        <div class="keys-table">
          <div class="keys-head">
            <span class="h-check"></span><span class="h-key">KEY</span><span class="h-type">类型</span><span class="h-ttl">TTL</span><span class="h-size">大小</span>
          </div>
          <div v-if="store.keysLoading" class="muted pad">扫描中…</div>
          <div v-else-if="!store.keys.length" class="muted pad">无 key(MATCH={{ store.match }})</div>
          <div v-for="k in store.keys" :key="k.key" class="key-row" :class="{ sel: store.detail?.key === k.key }" @click="store.loadDetail(k.key)">
            <span class="h-check" @click.stop="toggleCheck(k.key)"><input type="checkbox" :checked="store.checked.has(k.key)" @change="toggleCheck(k.key)"></span>
            <span class="h-key" :title="k.key">{{ k.key }}</span>
            <span class="h-type"><i class="badge">{{ typeBadge(k.type) }}</i>{{ k.type }}</span>
            <span class="h-ttl">{{ fmtTtl(k.ttlMs) }}</span>
            <span class="h-size">{{ fmtSize(k.sizeBytes) }}</span>
            <button class="row-del" title="删除" @click.stop="ask(`删除 ${k.key}?`) && store.deleteKey(k.key)">✕</button>
          </div>
          <div class="keys-foot">
            <span class="muted">cursor={{ store.nextCursor }}</span>
            <button v-if="store.nextCursor !== '0'" class="mini-btn" :disabled="store.keysLoading" @click="store.cursor = store.nextCursor; store.loadKeys()">下一页 →</button>
            <button v-else class="mini-btn" :disabled="store.keysLoading" @click="store.loadKeys(true)">⟳ 刷新</button>
          </div>
        </div>

        <!-- key 详情 -->
        <div class="key-detail">
          <div v-if="store.detailLoading" class="muted pad">加载中…</div>
          <div v-else-if="!store.detail" class="muted pad">点击左侧 key 查看详情</div>
          <template v-else>
            <div class="detail-head">
              <b class="detail-key">{{ store.detail.key }}</b>
              <span class="badge">{{ store.detail.type }}</span>
              <span class="muted">{{ store.detail.encoding }} · {{ fmtSize(store.detail.sizeBytes) }} · TTL {{ fmtTtl(store.detail.ttlMs) }}</span>
            </div>
            <div class="ttl-row">
              <input v-model="ttlInput" class="match-input" placeholder="TTL 秒数" @keydown.enter="applyTtl">
              <label class="muted"><input v-model="ttlPermanent" type="checkbox"> 永久</label>
              <button class="mini-btn" @click="applyTtl">应用 TTL</button>
              <button class="mini-btn danger" @click="ask(`删除 ${store.detail.key}?`) && store.deleteKey(store.detail.key)">删除</button>
            </div>
            <pre class="detail-value">{{ fmtValue(store.detail.value) }}<template v-if="store.detail.truncated">
…(已截断,总长 {{ store.detail.length }})</template></pre>
          </template>
        </div>
      </section>

      <!-- ── FLUSH 确认弹窗 ── -->
      <div v-if="showFlush" class="mask" @click.self="showFlush = null">
        <div class="modal danger-modal">
          <h3>{{ showFlush === 'db' ? '⚠ 清空当前 db(FLUSHDB)' : '☠ 清空整个实例(FLUSHALL)' }}</h3>
          <p class="muted">目标:{{ currentConn?.name }} · db{{ store.currentDb ?? currentConn?.db ?? 0 }}。此操作不可逆{{ showFlush === 'all' ? ',影响所有 db!' : '' }}。reviewMode 开启时将进入审批队列。</p>
          <p>输入 <b>{{ showFlush === 'db' ? 'FLUSHDB' : 'FLUSHALL' }}</b> 确认:</p>
          <input v-model="flushConfirmText" class="match-input" @keydown.enter="doFlush">
          <div class="modal-btns">
            <button class="mini-btn" @click="showFlush = null">取消</button>
            <button class="mini-btn danger" :disabled="flushConfirmText !== (showFlush === 'db' ? 'FLUSHDB' : 'FLUSHALL')" @click="doFlush">执行</button>
          </div>
        </div>
      </div>

      <!-- ── 操作历史抽屉 ── -->
      <div v-if="showHistoryDrawer" class="mask" @click.self="showHistoryDrawer = false">
        <div class="modal">
          <h3>🕘 操作记录(近 50 条)</h3>
          <div class="hist-list">
            <div v-for="h in store.history" :key="h.id" class="hist-item">
              <span class="badge">{{ histActionLabel[h.action] || h.action }}</span>
              <span class="hist-target">{{ h.target || `db${h.db ?? '?'}` }}</span>
              <span class="muted">{{ new Date(h.executedAt).toLocaleString('zh-CN', { hour12: false }) }}</span>
            </div>
            <div v-if="!store.history.length" class="muted pad">(暂无)</div>
          </div>
          <div class="modal-btns"><button class="mini-btn" @click="showHistoryDrawer = false">关闭</button></div>
        </div>
      </div>
    </template>

    <div v-else class="empty-hint">
      <template v-if="!hasProject">⚙ 选择项目后查看 Redis</template>
      <template v-else>本项目无 Redis 连接 · 编辑 <code>.code-panel/redis.yaml</code></template>
    </div>
  </main>
  </div>
</template>

<style scoped>
.conn-list { padding: 8px 10px; overflow-y: auto; }
.conn-item { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 6px; cursor: pointer; }
.conn-item:hover { background: rgba(255,255,255,.05); }
.conn-item.active { background: rgba(var(--glow-rgb),.12); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dot.on { background: var(--glow, #22ee66); box-shadow: 0 0 6px var(--glow, #22ee66); }
.dot.off { background: #555; }
.conn-text { display: flex; flex-direction: column; min-width: 0; }
.conn-name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conn-sub { font-size: 10px; color: var(--t2, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conn-empty { padding: 16px 8px; font-size: 12px; color: var(--t2, #888); text-align: center; line-height: 1.8; }

.app { display: flex; height: 100vh; }
.top-bar { display: flex; justify-content: flex-end; margin-bottom: -6px; }
.redis-main { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.card { background: var(--card, #131316); border: 1px solid var(--border, #23232a); border-radius: 8px; padding: 10px 12px; }
.card h4 { margin: 0 0 8px; font-size: 12px; color: var(--t2, #888); display: flex; justify-content: space-between; align-items: center; }
.kv { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
.kv span { color: var(--t2, #888); }
.kv b { font-weight: 500; font-family: ui-monospace, monospace; }
.membar { height: 6px; border-radius: 3px; background: #222; overflow: hidden; margin-bottom: 8px; }
.membar-fill { height: 100%; background: linear-gradient(90deg, var(--glow, #22ee66), #e0a030); }
.big-num { font-size: 22px; font-family: ui-monospace, monospace; color: var(--glow, #22ee66); margin-bottom: 6px; }

.toolbar { display: flex; flex-direction: column; gap: 8px; }
.db-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.db-chip { font-size: 11px; padding: 3px 9px; border-radius: 10px; border: 1px solid var(--border, #23232a); cursor: pointer; color: var(--t2, #888); }
.db-chip em { font-style: normal; margin-left: 4px; color: var(--glow, #22ee66); font-size: 10px; }
.db-chip.active { border-color: var(--glow, #22ee66); color: var(--text, #ccc); background: rgba(var(--glow-rgb),.08); }
.key-tools { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.match-input, .db-jump { background: var(--card, #131316); border: 1px solid var(--border, #23232a); color: var(--text, #ccc); border-radius: 6px; padding: 5px 9px; font-size: 12px; font-family: ui-monospace, monospace; }
.db-jump { width: 70px; }
.match-input { width: 190px; }
.mini-btn { background: var(--card, #131316); border: 1px solid var(--border, #23232a); color: var(--text, #ccc); border-radius: 6px; padding: 4px 10px; font-size: 11px; cursor: pointer; }
.mini-btn:hover { border-color: var(--glow, #22ee66); }
.mini-btn.danger { color: var(--danger); border-color: rgba(255,107,107,.4); }
.mini-btn:disabled { opacity: .4; cursor: not-allowed; }

.keys-area { display: grid; grid-template-columns: minmax(380px, 1.4fr) 1fr; gap: 10px; flex: 1; min-height: 0; }
.keys-table { background: var(--card, #131316); border: 1px solid var(--border, #23232a); border-radius: 8px; overflow-y: auto; }
.keys-head, .key-row { display: grid; grid-template-columns: 26px 1fr 70px 64px 60px 26px; gap: 6px; align-items: center; padding: 5px 10px; font-size: 11px; }
.keys-head { color: var(--t2, #888); position: sticky; top: 0; background: var(--card, #131316); border-bottom: 1px solid var(--border, #23232a); }
.key-row { border-bottom: 1px solid rgba(255,255,255,.03); cursor: pointer; font-family: ui-monospace, monospace; }
.key-row:hover { background: rgba(255,255,255,.04); }
.key-row.sel { background: rgba(var(--glow-rgb),.08); }
.h-key { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge { display: inline-block; font-size: 9px; padding: 1px 4px; border-radius: 4px; background: rgba(139,92,246,.2); color: #b39ddb; margin-right: 4px; font-style: normal; }
.keys-foot { display: flex; justify-content: space-between; padding: 8px 10px; position: sticky; bottom: 0; background: var(--card, #131316); }
.row-del { background: none; border: none; color: var(--danger); cursor: pointer; opacity: 0; font-size: 11px; }
.key-row:hover .row-del { opacity: 1; }
.muted { color: var(--t2, #888); font-size: 11px; }
.pad { padding: 16px; }
.empty-hint { margin: auto; color: var(--t2, #888); font-size: 13px; }

.key-detail { background: var(--card, #131316); border: 1px solid var(--border, #23232a); border-radius: 8px; padding: 10px 12px; overflow-y: auto; }
.detail-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.detail-key { font-size: 12px; font-family: ui-monospace, monospace; word-break: break-all; }
.ttl-row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.detail-value { margin: 0; background: #0a0a0c; border: 1px solid var(--border, #23232a); border-radius: 6px; padding: 10px; font-size: 11px; font-family: ui-monospace, monospace; white-space: pre-wrap; word-break: break-all; max-height: calc(100vh - 320px); overflow-y: auto; color: #b8d8b8; }

.mask { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 100; display: flex; align-items: center; justify-content: center; }
.modal { background: var(--card, #131316); border: 1px solid var(--border, #23232a); border-radius: 10px; padding: 18px; width: 420px; }
.modal h3 { margin: 0 0 10px; font-size: 14px; }
.danger-modal h3 { color: var(--danger); }
.modal-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.hist-list { max-height: 50vh; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.hist-item { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.hist-target { flex: 1; font-family: ui-monospace, monospace; word-break: break-all; }
.redis-notice {
  position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
  z-index: 1000; padding: 8px 18px; font-size: 12px;
  color: var(--glow); background: var(--surface, #101014);
  border: 1px solid var(--glow-dim); border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.5);
}
</style>
