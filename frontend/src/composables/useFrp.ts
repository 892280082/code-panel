// ── FRP 公网暴露开关(单一状态源)──────────────────────────
//   FrpSwitch(🔗 快捷方式弹窗)与 SecurityPanel(⚙ 安全 Tab 首卡)共同消费:
//   模块级单例 ref,一处切换另一处即时同步;confirm 文案/端口列表只此一份。

import { ref } from 'vue'
import { apiJson, errText } from '@/utils/api-fetch'

export interface FrpPort { port: number; service: string }
export interface FrpInfo { on: boolean; reachable: boolean; raw: string; ports: FrpPort[] }

const info = ref<FrpInfo | null>(null)
const busy = ref(false)
let inited = false

async function load(): Promise<void> {
  try {
    const res = await apiJson<{ data: FrpInfo }>('/api/security/frp')
    info.value = res.data
  } catch { /* 面板旧版本无此接口 → 保持 null,卡片隐藏 */ }
}

/** 切换公网暴露;含二次确认。返回 {ok} + error/raw 供调用方选择展示方式 */
async function toggle(next: boolean): Promise<{ ok: boolean; error?: string; raw?: string }> {
  if (busy.value) return { ok: false }
  if (next && !window.confirm(
    '开启 FRP 公网暴露?\n\n' +
    '公网 203.0.113.10 的 60101/60111/60112/60113 将对所有人开放,\n' +
    '存在暴露风险 —— 仅在需要外网访问/演示时开启。')) return { ok: false }
  if (!next && !window.confirm('关闭 FRP 公网暴露?\n\n公网口全部下线;管理隧道(SSH/code-server/code-panel)不受影响。')) return { ok: false }
  busy.value = true
  const prev = info.value
  if (info.value) info.value = { ...info.value, on: next } // 乐观更新,失败回滚
  try {
    const res = await apiJson<{ data: FrpInfo & { raw?: string } }>(`/api/security/frp/${next ? 'on' : 'off'}`)
    info.value = res.data
    return { ok: true, raw: res.data.raw }
  } catch (e) {
    if (prev) info.value = prev
    return { ok: false, error: errText(e, '操作失败') }
  } finally {
    busy.value = false
  }
}

export function useFrp() {
  if (!inited) { inited = true; load() }
  return { info, busy, load, toggle }
}
