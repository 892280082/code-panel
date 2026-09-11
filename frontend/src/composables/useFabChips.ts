// ── FAB + 芯片簇 composable(命令抽屉右下角)────────────────────
//   几何:FAB 底边定位(right/top 锚定),默认右下角,位置存 localStorage;
//   左侧排 1..N 终端芯片,右侧贴 📂 仓库芯片,最外侧 ☁ 云芯片 ——
//   拖 FAB 时三者联动、位置一起持久化;窗口 resize 后钳回可视区。
//   交互:拖拽与点击分离(>3px 算拖);芯片点击切换 / 恢复对应浮窗。
//   markup 与样式留在 CommandDrawer.vue,本 composable 只管逻辑。

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '@/utils/api-fetch'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'
import { useRepoBrowserStore } from '@/stores/repo-browser'
import { useCloudStore } from '@/stores/cloud'
import { getLayout, onViewportChange, updateLast } from '@/utils/viewport-layout'

export function useFabChips() {
  const terminal = useTerminalStore()
  const projects = useProjectsStore()
  const browser = useRepoBrowserStore()
  const cloud = useCloudStore()
  const router = useRouter()

  const POS_KEY = 'cmd-drawer-trigger-pos'
  const BTN_SIZE = 44          // FAB 直径
  const CHIP_SIZE = 35         // 左右小圆片直径
  const GAP = 16               // FAB 与芯片间距
  const EDGE = 16              // 芯片簇最外侧距视口右/下边缘的距离
  /** FAB 距右边缘的最小值:保证右侧 📂 仓库 + ☁ 云 两个芯片始终留在可视区内 */
  const MIN_FAB_RIGHT = EDGE + 2 * (CHIP_SIZE + GAP)

  /** 屏幕分辨率变化后，上次记录的位置可能超出可视区域，越界则重置回屏幕内，避免图标丢失。
   *  ⭐ 任何情况都返回视口内的位置(永不 null):视口小到放不下完整芯片簇时,
   *  至少把 FAB 本体贴到右下可视区内 —— FAB 是全部终端功能的入口,
   *  它丢了用户就什么都打不开(用户铁律)。 */
  function clampBtnPos(v: { x: number; y: number } | null) {
    if (!v) return null
    const maxX = window.innerWidth - BTN_SIZE - EDGE
    const maxY = window.innerHeight - BTN_SIZE - EDGE
    if (maxX < MIN_FAB_RIGHT || maxY < EDGE) {
      return {
        x: Math.max(4, window.innerWidth - BTN_SIZE - 4),
        y: Math.max(4, Math.min(v.y, window.innerHeight - BTN_SIZE - 4)),
      }
    }
    return { x: Math.min(Math.max(v.x, MIN_FAB_RIGHT), maxX), y: Math.min(Math.max(v.y, EDGE), maxY) }
  }
  function readSavedPos() {
    try {
      const v = JSON.parse(localStorage.getItem(POS_KEY) || '')
      if (v && typeof v.x === 'number' && typeof v.y === 'number') return v
    } catch { /* ignore */ }
    return null
  }
  const raw = readSavedPos()
  const clamped = clampBtnPos(raw)
  // 默认：右下角 —— 右侧仓库芯片贴边 16px，FAB 再靠左 51px，底部贴边 16px
  const btnX = ref(clamped?.x ?? MIN_FAB_RIGHT)
  const btnY = ref(clamped?.y ?? Math.max(EDGE, window.innerHeight - BTN_SIZE - EDGE))
  // 上次记录已越界 → 用修正后的位置覆盖存储，下次打开直接是正常位置
  if (raw && clamped && (raw.x !== clamped.x || raw.y !== clamped.y)) {
    localStorage.setItem(POS_KEY, JSON.stringify(clamped))
  }
  let dragging = false
  let moved = false            // 拖动超过阈值才算拖拽，否则是普通点击
  let dragStartX = 0, dragStartY = 0, dragOrigX = 0, dragOrigY = 0

  // ── 芯片几何：与 FAB 位置联动 ───────────────────────────
  /** 浮动终端数字条只列 tmux 常驻会话(Apps 启停一次性会话 / 手动 cmd 终端不占 1/2/3) */
  const sessionList = computed(() =>
    Array.from(terminal.sessions.entries()).filter(([, s]) => s.kind === 'tmux'),
  )
  /** 左侧终端芯片条右缘 = FAB 右缘 + FAB 宽 + 间距 */
  const chipsBarRight = computed(() => btnX.value + BTN_SIZE + GAP)
  /** 右侧仓库芯片右缘 = FAB 右缘 − 芯片宽 − 间距 */
  const repoChipRight = computed(() => btnX.value - CHIP_SIZE - GAP)
  /** 最外侧 ☁ 云芯片右缘 = FAB 右缘 − 2×(芯片宽+间距) */
  const cloudChipRight = computed(() => btnX.value - 2 * (CHIP_SIZE + GAP))

  function onTriggerDragStart(e: MouseEvent) {
    if (terminal.drawerOpen) return
    dragging = true
    moved = false
    dragStartX = e.clientX; dragStartY = e.clientY
    dragOrigX = btnX.value; dragOrigY = btnY.value
    document.addEventListener('mousemove', onTriggerDragMove)
    document.addEventListener('mouseup', onTriggerDragEnd)
  }
  function onTriggerDragMove(e: MouseEvent) {
    if (!dragging) return
    const dx = e.clientX - dragStartX
    const dy = e.clientY - dragStartY
    if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return  // 3px 内视为点击
    moved = true
    e.preventDefault()
    btnX.value = dragOrigX - dx
    btnY.value = dragOrigY + dy
  }
  function onTriggerDragEnd() {
    if (!dragging) return
    dragging = false
    const c = clampBtnPos({ x: btnX.value, y: btnY.value })
    if (c) { btnX.value = c.x; btnY.value = c.y }
    localStorage.setItem(POS_KEY, JSON.stringify({ x: btnX.value, y: btnY.value }))
    updateLast({ fab: { x: btnX.value, y: btnY.value } })   // 记入「最新位置」暂存(定位存档来源)
    document.removeEventListener('mousemove', onTriggerDragMove)
    document.removeEventListener('mouseup', onTriggerDragEnd)
  }
  /** FAB 点击：拖拽过(>3px)则忽略，防止拖完误开抽屉 */
  function onTriggerClick() {
    if (moved) { moved = false; return }
    terminal.toggleDrawer()
  }

  // ── 终端芯片点击：最小化 → 恢复+置顶；活跃 → 置顶 ──────
  function onChipClick(port: number) {
    const s = terminal.sessions.get(port)
    if (!s) return
    if (s.minimized) terminal.restoreSession(port)
    else terminal.bringToFront(port)
  }

  // ── ☁ 云芯片：开云文件抽屉(同时收起命令抽屉) ────────────
  function onCloudChipClick() {
    if (terminal.drawerOpen) terminal.closeDrawer()
    cloud.toggle()
  }

  // ── 📂 仓库芯片：未开 → 打开当前项目第一个仓库；已开 → 最小化则恢复，否则关闭 ──
  const repoChipTitle = computed(() => {
    if (!browser.visible) return browser.repoId ? `打开：${browser.repoName}` : '去 Git 页面选择仓库'
    return browser.minimized ? '恢复：Repo Browser' : '关闭：Repo Browser'
  })

  async function onRepoChipClick() {
    if (browser.visible) {
      if (browser.minimized) browser.restore()
      else browser.closeModal()
      return
    }
    if (!projects.currentId) { router.push('/git'); return }
    try {
      const res = await apiFetch(`/api/git/repos?project=${encodeURIComponent(projects.currentId)}`)
      const data = await res.json()
      const repos = (data?.ok ? data.data : []) || []
      if (repos.length) browser.openModal(repos[0].id, repos[0].name, repos[0].path)
      else router.push('/git')
    } catch {
      router.push('/git')
    }
  }

  /** 视口尺寸变化:该尺寸记过位 → FAB 对齐到当时位置;没记过 → 钳回可视区 */
  function clampToViewport() {
    const c = clampBtnPos({ x: btnX.value, y: btnY.value })
    if (c) { btnX.value = c.x; btnY.value = c.y }
  }
  let offViewportChange: (() => void) | null = null
  onMounted(() => {
    // 双保险:① resize 即时钳回(保命,FAB 任何瞬间都不许出视窗)
    window.addEventListener('resize', clampToViewport)
    // ② 尺寸稳定后(debounce 300ms)按该尺寸的定位档案对齐(体验)
    offViewportChange = onViewportChange(() => {
      const L = getLayout()
      if (L.fab) {
        const c = clampBtnPos(L.fab)
        if (c) {
          btnX.value = c.x; btnY.value = c.y
          localStorage.setItem(POS_KEY, JSON.stringify(c))
          return
        }
      }
      clampToViewport() // 无档案/档案越界 → 原兜底:钳回可视区
    })
  })
  onUnmounted(() => {
    window.removeEventListener('resize', clampToViewport)
    offViewportChange?.()
  })

  return {
    btnX, btnY, sessionList,
    chipsBarRight, repoChipRight, cloudChipRight,
    onTriggerDragStart, onTriggerClick,
    onChipClick, onCloudChipClick,
    repoChipTitle, onRepoChipClick,
  }
}
