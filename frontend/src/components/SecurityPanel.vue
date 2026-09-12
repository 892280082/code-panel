<script setup lang="ts">
// ── 安全模式面板(内容区;嵌入 ⚙ 配置「安全」Tab)────────────
//   开启后:未解锁访问(页面 + 全部 API)一律 404;只有秘密链接能种下
//   解锁 cookie(90 天)并跳转登录页。链接可自定义/重新生成,可吊销全部解锁。

import { apiFetch, errText } from '@/utils/api-fetch'
import { copyText } from '@/utils/clipboard'
import { useAuthStore } from '@/stores/auth'
import { ref, computed, onMounted } from 'vue'

const auth = useAuthStore()

const enabled = ref(false)
const secretPath = ref('')
const loading = ref(true)
const busy = ref(false)
const msg = ref('')
const errMsg = ref('')
const customPath = ref('')
const copied = ref(false)

// ── 服务看门狗(systemd 定时器,仅 Ubuntu/Linux 可用)──────
interface WatchdogInfo {
  supported: boolean
  installed: boolean
  timerActive: boolean
  panelActive: boolean
  scriptPath: string
  timerUnit: string
  graceSec: number
  intervalMin: number
}
const wd = ref<WatchdogInfo | null>(null)
const wdBusy = ref(false)
const wdMsg = ref('')
const wdErr = ref('')

// ── FRP 公网开关(首卡;🔗 快捷方式「公网开关」同效,走同一 API)──────
interface FrpPort { port: number; service: string }
interface FrpInfo { on: boolean; reachable: boolean; raw: string; ports: FrpPort[] }
const frp = ref<FrpInfo | null>(null)
const frpBusy = ref(false)
const frpMsg = ref('')
const frpErr = ref('')

async function loadFrp(): Promise<void> {
  try {
    const res = await apiFetch('/api/security/frp')
    const data = await res.json()
    if (data?.ok) frp.value = data.data
  } catch { /* 面板旧版本无此接口 → 保持 null,卡片隐藏 */ }
}

async function frpToggle(next: boolean): Promise<void> {
  if (frpBusy.value) return
  if (next && !window.confirm(
    '开启 FRP 公网暴露?\n\n' +
    '公网 203.0.113.10 的 60101/60111/60112/60113 将对所有人开放,\n' +
    '存在暴露风险 —— 仅在需要外网访问/演示时开启。')) return
  if (!next && !window.confirm('关闭 FRP 公网暴露?\n\n公网口全部下线;管理隧道(SSH/code-server/code-panel)不受影响。')) return
  frpBusy.value = true
  frpMsg.value = ''
  frpErr.value = ''
  try {
    const res = await apiFetch(`/api/security/frp/${next ? 'on' : 'off'}`)
    const data = await res.json()
    if (!data?.ok) throw new Error(data?.error || '操作失败')
    frpMsg.value = data.data?.raw || (next ? '公网已开' : '公网已关')
    await loadFrp()
  } catch (e) {
    frpErr.value = errText(e)
  } finally {
    frpBusy.value = false
  }
}
onMounted(loadFrp)

async function loadWatchdog(): Promise<void> {
  try {
    const res = await apiFetch('/api/security/watchdog')
    const data = await res.json()
    if (data?.ok) wd.value = data.data
  } catch { /* 面板旧版本无此接口 → 保持 null,卡片按不支持展示 */ }
}

async function watchdogAction(act: 'install' | 'uninstall'): Promise<void> {
  if (wdBusy.value) return
  if (act === 'install' && !window.confirm(
    '开启服务看门狗?\n\n' +
    `将部署 systemd 定时器:每 ${wd.value?.intervalMin ?? 1} 分钟检查,面板停机超过 ${wd.value?.graceSec ?? 30} 秒自动拉起` +
    '(停机不满缓冲时长不打扰,留给 systemd 自身重试)。',
  )) return
  if (act === 'uninstall' && !window.confirm('停用看门狗?\n\n面板服务本体(code-panel.service)保留,仅移除自动拉起。')) return
  wdBusy.value = true
  wdMsg.value = ''
  wdErr.value = ''
  try {
    const res = await apiFetch(`/api/security/watchdog/${act}`, { method: 'POST' })
    const data = await res.json()
    if (!data?.ok) throw new Error(data?.error || '操作失败')
    wd.value = data.data
    wdMsg.value = act === 'install' ? '✓ 看门狗已部署并启用(开机自启)' : '✓ 看门狗已停用并清理'
  } catch (e) {
    wdErr.value = errText(e, '操作失败')
  } finally {
    wdBusy.value = false
  }
}

const gateUrl = computed(() => (secretPath.value ? location.origin + secretPath.value : '')) // 当前浏览入口的完整地址(仅示例)

async function load() {
  loading.value = true
  try {
    const res = await apiFetch('/api/config')
    const data = await res.json()
    enabled.value = !!data?.security?.enabled
    secretPath.value = data?.security?.secretPath || ''
  } catch (e) {
    errMsg.value = errText(e, '读取失败')
  } finally {
    loading.value = false
  }
}

async function save(payload: Record<string, unknown>, okMsg: string) {
  if (busy.value) return
  busy.value = true
  msg.value = ''
  errMsg.value = ''
  try {
    const res = await apiFetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ security: payload }),
    })
    const data = await res.json()
    if (!data?.ok) throw new Error(data?.error || '保存失败')
    enabled.value = !!data.security?.enabled
    secretPath.value = data.security?.secretPath || ''
    msg.value = okMsg
  } catch (e) {
    errMsg.value = errText(e, '保存失败')
  } finally {
    busy.value = false
  }
}

function toggle() {
  if (enabled.value) {
    if (!window.confirm('关闭安全模式?\n\n关闭后登录页与全部 API 恢复对外可见。')) return
    save({ enabled: false }, '✓ 安全模式已关闭')
  } else {
    if (!window.confirm(
      '开启安全模式?\n\n' +
      '开启后:未解锁的访问(所有页面 + 全部 API,含登录口)一律 404,' +
      '只有通过秘密链接解锁过的浏览器才能看到登录页。\n\n' +
      '⚠ 请务必保存好秘密链接(下方开启后显示,也可现在先自定义);' +
      '忘记链接只能在本机查 ~/.code-panel/data.db 的 settings 表。',
    )) return
    save({ enabled: true }, '✓ 安全模式已开启,当前浏览器已自动解锁')
  }
}

function saveCustom() {
  const p = customPath.value.trim()
  if (!p) { errMsg.value = '请输入自定义路径'; return }
  customPath.value = ''
  save({ secretPath: p }, '✓ 秘密链接已更新(旧链接立即失效)')
}

function regenerate() {
  if (!window.confirm('重新生成秘密链接?\n\n旧链接立即失效;已解锁的浏览器不受影响(仍凭 cookie 访问)。')) return
  save({ regeneratePath: true }, '✓ 已生成新链接(旧链接立即失效)')
}

function revokeAll() {
  if (!window.confirm(
    '吊销所有已解锁浏览器?\n\n' +
    '所有设备上的解锁 cookie 立即失效(当前浏览器会自动重新解锁),' +
    '其他浏览器需重新访问秘密链接。',
  )) return
  save({ revokeCookies: true }, '✓ 已吊销全部解锁,当前浏览器已自动续上')
}

async function copyLink() {
  if (!secretPath.value) return
  if (await copyText(secretPath.value)) {
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }
}

onMounted(() => { load(); loadWatchdog() })
</script>

<template>
  <div class="sec-panel">
    <!-- FRP 公网开关(首卡;🔗 快捷方式「公网开关」同效) -->
    <div v-if="frp" class="cfg-card">
      <div class="cfg-head">
        <div class="cfg-title">
          🌐 FRP 公网暴露
          <span class="badge" :class="frp.on ? 'on' : 'off'">
            {{ !frp.reachable ? 'frpc 不可达' : frp.on ? '已开启' : '已关闭' }}
          </span>
        </div>
        <button
          class="toggle-btn"
          :class="frp.on ? 'off' : 'on'"
          :disabled="frpBusy || !frp.reachable"
          @click="frpToggle(!frp.on)"
        >
          {{ frpBusy ? '处理中…' : frp.on ? '关闭公网' : '开启公网' }}
        </button>
      </div>
      <div class="cfg-hint">公网口 → 服务:</div>
      <div v-for="p in frp.ports" :key="p.port" class="cfg-hint mono-ex">{{ p.port }} → {{ p.service }}</div>
      <div class="cfg-hint warn">
        ⚠️ 开启后别人也可以访问,存在暴露风险 —— 只有在开发/演示需要外网时才启用,平时保持关闭。
      </div>
      <div v-if="frp.raw" class="cfg-hint mono-ex">{{ frp.raw }}</div>
      <div v-if="frpMsg" class="ok">{{ frpMsg }}</div>
      <div v-if="frpErr" class="form-error">{{ frpErr }}</div>
    </div>

    <!-- 状态卡 + 开关 -->
    <div class="cfg-card">
      <div class="cfg-head">
        <div class="cfg-title">
          🛡 安全模式(隐身)
          <span class="badge" :class="enabled ? 'on' : 'off'">{{ enabled ? '已开启' : '未开启' }}</span>
        </div>
        <button class="toggle-btn" :class="enabled ? 'off' : 'on'" :disabled="busy || loading" @click="toggle">
          {{ busy ? '处理中…' : enabled ? '关闭安全模式' : '开启安全模式' }}
        </button>
      </div>
      <div class="cfg-hint">
        开启后,未解锁的访问 —— 所有页面、静态资源、全部 API(连登录口 /api/auth/login)—— 一律返回 404,
        与真实 404 无差别,扫描器探测不到本服务的存在。只有访问过秘密链接的浏览器(种下 90 天解锁 cookie)才能看到登录页。
      </div>
      <div v-if="msg" class="ok">{{ msg }}</div>
      <div v-if="errMsg" class="form-error">{{ errMsg }}</div>
    </div>

    <!-- 秘密链接 -->
    <div v-if="secretPath" class="cfg-card">
      <div class="cfg-label">🔑 秘密路径(唯一入口,请妥善保存)</div>
      <div class="cfg-row">
        <input class="form-input mono path" :value="secretPath" readonly @click="($event.target as HTMLInputElement).select()" />
        <button class="save-btn" @click="copyLink">{{ copied ? '✓ 已复制' : '⧉ 复制' }}</button>
      </div>
      <div class="cfg-hint">
        任意访问入口(本机 / nginx 域名 / FRP)后面拼上此路径即解锁,例如:
        <span class="mono-ex">{{ gateUrl }}</span> 或 <span class="mono-ex">https://你的域名{{ secretPath }}</span>;
        访问一次 → 种下解锁 cookie(90 天,HttpOnly)→ 自动跳转登录页。
        <template v-if="enabled"><b>当前安全模式已开启,此路径不要泄露。</b></template>
      </div>

      <div class="cfg-divider" />

      <div class="cfg-label">自定义路径(如 /my-door-2026,改完旧链接立即失效)</div>
      <div class="cfg-row">
        <input
          v-model="customPath" class="form-input mono" placeholder="/gate-my-secret-door"
          @keyup.enter="saveCustom"
        />
        <button class="save-btn" :disabled="busy" @click="saveCustom">保存</button>
        <button class="ghost-btn" :disabled="busy" title="随机生成 128bit 不可猜路径" @click="regenerate">⟳ 重新生成</button>
      </div>

      <div class="cfg-divider" />

      <div class="cfg-row">
        <button class="danger-btn" :disabled="busy" @click="revokeAll">🚪 吊销所有已解锁浏览器</button>
        <span class="cfg-hint inline">换新解锁密钥:其他设备全部 404,需重新访问秘密链接(当前浏览器自动续上)</span>
      </div>
    </div>

    <div v-else-if="!loading" class="section-hint">
      尚未生成秘密链接 —— 开启安全模式会自动随机生成,也可在开启前先自定义一个路径。
    </div>

    <!-- 服务看门狗 -->
    <div class="cfg-card">
      <div class="cfg-head">
        <div class="cfg-title">
          🐕 服务看门狗(自动重启)
          <span class="badge" :class="wd?.timerActive ? 'on' : 'off'">
            {{ wd?.supported === false ? '不支持' : wd?.timerActive ? '已启用' : '未启用' }}
          </span>
        </div>
        <button
          v-if="auth.isSuper"
          class="toggle-btn"
          :class="wd?.timerActive ? 'off' : 'on'"
          :disabled="wdBusy || !wd?.supported"
          @click="watchdogAction(wd?.timerActive ? 'uninstall' : 'install')"
        >
          {{ wdBusy ? '处理中…' : wd?.timerActive ? '停用看门狗' : '启动自动重启' }}
        </button>
      </div>
      <div class="cfg-hint">
        面板服务停机超过 {{ wd?.graceSec ?? 30 }} 秒 → 自动拉起(每 {{ wd?.intervalMin ?? 1 }} 分钟检查一次)。
        停机不满缓冲时长不打扰 —— 留给 systemd 自身重试,避免两边同时启动互相打架。
      </div>
      <div class="cfg-hint warn">
        ⚠️ 仅乌班图(Ubuntu)/Linux(systemd)环境可用,Mac 与容器不支持。
        <template v-if="wd && !wd.supported">当前环境不满足,无法开启。</template>
      </div>
      <div v-if="wd?.timerActive" class="cfg-hint mono-ex">
        脚本 {{ wd.scriptPath }} · 定时器 {{ wd.timerUnit }} · 面板服务:{{ wd.panelActive ? '运行中' : '未运行' }}
      </div>
      <div v-if="wdMsg" class="ok">{{ wdMsg }}</div>
      <div v-if="wdErr" class="form-error">{{ wdErr }}</div>
    </div>
  </div>
</template>

<style scoped>
.sec-panel { display: flex; flex-direction: column; gap: 10px; }
.cfg-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a); border-radius: 8px;
}
.cfg-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cfg-title { font-size: 13px; color: var(--text, #c8c8d0); font-weight: 600; display: flex; align-items: center; gap: 8px; }
.badge {
  font-size: 10px; font-weight: 400; padding: 1px 8px; border-radius: 8px;
  border: 1px solid var(--border, #23232a); color: var(--text-dim, #6b6b78);
}
.badge.on { color: var(--glow, #22ee66); border-color: var(--glow-dim, rgba(34,238,102,0.3)); background: rgba(34,238,102,0.08); }
.badge.off { color: var(--text-dim, #6b6b78); }
.cfg-row { display: flex; gap: 6px; align-items: center; }
.cfg-hint.inline { flex: 1; }
.form-input.path { font-size: 13px; font-weight: 600; }
.mono-ex { font-family: var(--font, monospace); color: var(--text, #c8c8d0); }
.cfg-divider { border-top: 1px dashed var(--border, #23232a); margin: 2px 0; }
.form-input[readonly] { cursor: text; }
.ok { color: var(--glow, #22ee66); font-size: 11px; }
.cfg-hint.warn { color: #e8b339; }
.save-btn {
  padding: 8px 14px; border: 1px solid var(--glow-dim, rgba(34,238,102,0.3));
  border-radius: 4px; background: transparent; color: var(--glow, #22ee66);
  font-size: 12px; cursor: pointer; white-space: nowrap;
}
.save-btn:hover:not(:disabled) { background: rgba(34,238,102,0.08); }
.save-btn:disabled { opacity: 0.5; cursor: default; }
.ghost-btn {
  padding: 8px 14px; border: 1px solid var(--border, #23232a); border-radius: 4px;
  background: transparent; color: var(--text-dim, #6b6b78); font-size: 12px; cursor: pointer; white-space: nowrap;
}
.ghost-btn:hover:not(:disabled) { color: var(--text, #c8c8d0); border-color: var(--text-dim, #6b6b78); }
.ghost-btn:disabled { opacity: 0.5; cursor: default; }
.toggle-btn { padding: 8px 18px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.toggle-btn.on { background: var(--glow, #22ee66); border: none; color: #09090b; }
.toggle-btn.on:hover:not(:disabled) { opacity: 0.85; }
.toggle-btn.off { background: transparent; border: 1px solid #f44747; color: #f44747; }
.toggle-btn.off:hover:not(:disabled) { background: rgba(244,71,71,0.1); }
.toggle-btn:disabled { opacity: 0.5; cursor: default; }
.danger-btn {
  padding: 8px 14px; border: 1px solid #f44747; border-radius: 4px;
  background: transparent; color: #f44747; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.danger-btn:hover:not(:disabled) { background: rgba(244,71,71,0.1); }
.danger-btn:disabled { opacity: 0.5; cursor: default; }
.section-hint { color: var(--text-dim, #6b6b78); font-size: 12px; text-align: center; padding: 14px 0; }
</style>
