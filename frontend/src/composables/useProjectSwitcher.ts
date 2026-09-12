// ── 项目切换器(Alt+Tab 风格;Ctrl+2 呼出,左右选,回车切)────
//   单例 composable:热键(App.vue getMap)与 ProjectSwitcher.vue 共享同一份
//   开合/选中态。Ctrl+2 再按一次 = 高亮下一个(经典 Alt+Tab 手感)。

import { ref, computed } from 'vue'
import { useProjectsStore } from '@/stores/projects'

const open = ref(false)
const selIdx = ref(0)

export function useProjectSwitcher() {
  const projects = useProjectsStore()
  const list = computed(() => projects.projects)

  /** 打开:当前项目默认选中(置顶高亮) */
  function show(): void {
    if (!list.value.length) return
    const cur = list.value.findIndex(p => p.id === projects.currentId)
    selIdx.value = cur >= 0 ? cur : 0
    open.value = true
  }

  /** 热键入口:开着则高亮下一个(Alt+Tab 手感),没开则打开 */
  function hotkeyTap(): void {
    if (open.value) step(1)
    else show()
  }

  /** 左右移动(delta ±1,循环) */
  function step(delta: number): void {
    const n = list.value.length
    if (!n) return
    selIdx.value = (selIdx.value + delta + n) % n
  }

  /** 回车/点击:切换并关闭 */
  function confirm(idx = selIdx.value): void {
    const p = list.value[idx]
    if (p) projects.setProject(p.id)
    close()
  }

  function close(): void {
    open.value = false
  }

  const curId = computed(() => projects.currentId)
  return { open, selIdx, list, curId, show, hotkeyTap, step, confirm, close }
}
