// ── 全局层级计数器 ────────────────────────────────────────
//   终端浮动窗口与所有弹窗（Modal/Confirm/Popup…）共用同一计数器：
//   谁最后被打开/点击，谁就在最上面，天然形成正确的层叠顺序。
//   起点 1000：高于页面常规内容，低于任务栏(9997)/抽屉(9998+)等常驻控件。

import { ref, watch, type Ref } from 'vue'

let counter = 1000

/** 取下一个层级值（调用一次 +1） */
export function raise(): number {
  return ++counter
}

/** 弹窗层级 hook：打开时置顶，点击弹窗任意位置时也置顶。
 *  visible 传显示状态：getter（props.show / store 状态）或 Ref，
 *  打开瞬间 raise 一次；不传则挂载时置顶一次（父级 v-if 挂载的弹窗）。 */
export function useOverlayLayer(visible?: Ref<boolean> | (() => boolean)) {
  const zIndex = ref(raise())
  if (visible) {
    const get = () => typeof visible === 'function'
      ? (visible as () => boolean)()
      : (visible as Ref<boolean>).value
    watch(get, (v) => { if (v) zIndex.value = raise() }, { immediate: true })
  }
  function onRaise() { zIndex.value = raise() }
  return { zIndex, onRaise }
}
