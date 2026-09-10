// ── 跨组件 UI 状态(极简)────────────────────────────────
//   配置弹窗本体在 Sidebar,但右上角切换器等处也要能「打开 ⚙ 并定位到某 Tab」,
//   故把 open/tab 提升到 store;Sidebar ⚙ 与 GlobalConfigModal 都读写这里。

import { defineStore } from 'pinia'

export const useUiStore = defineStore('ui', {
  state: () => ({
    cfgOpen: false,
    cfgTab: 'project',
  }),
  actions: {
    openConfig(tab?: string) {
      if (tab) this.cfgTab = tab
      this.cfgOpen = true
    },
    closeConfig() {
      this.cfgOpen = false
    },
  },
})
