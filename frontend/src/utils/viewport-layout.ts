// ── 按视口尺寸记忆布局(终端窗口 + 命令终端 FAB)──────────
//   每个「可视宽x高」一套档案:切屏后该尺寸记过位 → 自动对齐;
//   没记过 → 维持现状(出界由各组件兜底重置)。
//   「定位」= 把拖动后的最新位置(last 暂存)存进当前尺寸档案。
//
//   localStorage 两处:
//     cp-term-layouts      { "1512x982": { win?:{x,y}, fab?:{x,y} }, … }
//     cp-term-layout-last  { win?, fab? }   拖动后的最新位置(定位存档来源)

const MAP_KEY = 'cp-term-layouts'
const LAST_KEY = 'cp-term-layout-last'

export interface TermLayout {
  /** 终端窗口槽位(从左到右有序):第 i 个打开的窗口对齐 wins[i] */
  wins?: { x: number; y: number }[]
  fab?: { x: number; y: number }   // 命令终端 FAB(useFabChips 的 btnX/btnY)
}

/** 当前视口尺寸 key(可视宽x高) */
function layoutKey(): string {
  return `${window.innerWidth}x${window.innerHeight}`
}

function readMap(): Record<string, TermLayout> {
  try { return JSON.parse(localStorage.getItem(MAP_KEY) || '{}') } catch { return {} }
}

export function getLayout(key?: string): TermLayout {
  return readMap()[key || layoutKey()] || {}
}

function readLast(): TermLayout {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || '{}') } catch { return {} }
}

/** 拖动结束更新「最新位置」暂存(定位按钮存档的来源) */
export function updateLast(patch: TermLayout): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ ...readLast(), ...patch }))
  } catch { /* ignore */ }
}

/** 定位:把 last 暂存存进当前尺寸档案;返回尺寸 key(供提示) */
export function pinLayout(): string {
  const key = layoutKey()
  const map = readMap()
  map[key] = { ...map[key], ...readLast() }
  try { localStorage.setItem(MAP_KEY, JSON.stringify(map)) } catch { /* ignore */ }
  return key
}

/** 重置:清掉当前尺寸的定位档案(该尺寸回到「未记过」状态;
 *  窗口居中由调用方做 —— 重置按钮:全窗口 x=y=0 + 本函数) */
export function resetLayout(): string {
  const key = layoutKey()
  const map = readMap()
  delete map[key]
  try { localStorage.setItem(MAP_KEY, JSON.stringify(map)) } catch { /* ignore */ }
  return key
}

/** 终端窗口的落位(新建窗口用):当前尺寸记过 → 第一个**空槽**
 *  (未被现有窗口占用的档案槽位);全占满 → 叠到最后一个槽。
 *  没记过 → 向右阶梯错开(经典 cascade,每个右移 240 下移 28)。 */
export function slotPos(index: number, taken: { x: number; y: number }[] = []): { x: number; y: number } {
  const wins = getLayout().wins
  if (wins?.length) {
    const free = wins.find(w => !taken.some(t => t.x === w.x && t.y === w.y))
    if (free) return { x: free.x, y: free.y }
    const last = wins[wins.length - 1]
    return { x: last.x, y: last.y }
  }
  return { x: index * 240, y: index * 28 }
}

/** 视口尺寸变化回调(debounce 300ms;只有 key 真变了才触发 ——
 *  拖浏览器边缘过程中的连续 resize 不会逐帧误触)。
 *  返回注销函数。 */
export function onViewportChange(cb: (key: string) => void): () => void {
  let lastKey = layoutKey()
  let timer: ReturnType<typeof setTimeout> | null = null
  const onResize = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const k = layoutKey()
      if (k !== lastKey) { lastKey = k; cb(k) }
    }, 300)
  }
  window.addEventListener('resize', onResize)
  return () => {
    window.removeEventListener('resize', onResize)
    if (timer) clearTimeout(timer)
  }
}
