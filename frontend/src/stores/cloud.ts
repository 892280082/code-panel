// ── 云文件抽屉(上传/下载)开关 ───────────────────────
//   ☁ chip(CommandDrawer 右下角簇)与抽屉主体共用一个 isOpen 状态。

import { defineStore } from 'pinia'

export const useCloudStore = defineStore('cloud', {
  state: () => ({ isOpen: false }),
  actions: {
    open() { this.isOpen = true },
    close() { this.isOpen = false },
    toggle() { this.isOpen = !this.isOpen },
  },
})
