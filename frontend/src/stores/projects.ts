// ── 项目注册表 Store ──────────────────────────────────────
//   管理项目列表与「当前选中项目」。切换项目时所有视图/抽屉通过 watch currentId
//   重新加载数据。
//   选中项双层存储:sessionStorage(按标签页隔离 → 两个标签页可各开一个项目,
//   刷新互不影响)+ localStorage(全局「最近使用」,新标签页/新会话的兜底默认)。

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiJson } from '@/utils/api-fetch'
import type { ProjectInfo } from '@/types'

const KEY = 'panel-project'
const TAB_KEY = 'panel-project-tab'

/** 当前标签页锁定的项目(无则回落全局最近使用) */
function readSaved(): string | null {
  return sessionStorage.getItem(TAB_KEY) ?? localStorage.getItem(KEY)
}

function persist(id: string | null) {
  if (id) {
    sessionStorage.setItem(TAB_KEY, id)   // 本标签页锁定
    localStorage.setItem(KEY, id)         // 全局「最近使用」(新标签页的默认)
  } else {
    sessionStorage.removeItem(TAB_KEY)
    localStorage.removeItem(KEY)
  }
}

/** 拼 URL query:project=<id>;无当前项目时返回 '' */
export function projectQS(): string {
  const pid = useProjectsStore().currentId
  return pid ? `project=${encodeURIComponent(pid)}` : ''
}

/** 返回 { project: <id> } 对象(适合 fetch body/参数);无当前项目时返回 {} */
export function projectParam(): Record<string, string> {
  const pid = useProjectsStore().currentId
  return pid ? { project: pid } : {}
}

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<ProjectInfo[]>([])
  const currentId = ref<string | null>(null)
  const loaded = ref(false)

  const currentProject = computed(() =>
    projects.value.find(p => p.id === currentId.value) || null
  )

  /** 拉取项目列表,并按「本标签页记住的/全局最近使用/第一个」选中 */
  async function load() {
    const data = await apiJson<{ data: ProjectInfo[] }>('/api/projects')
    projects.value = data?.data || []
    loaded.value = true
    const saved = readSaved()
    if (saved && projects.value.some(p => p.id === saved)) {
      currentId.value = saved
    } else if (projects.value.length) {
      currentId.value = projects.value[0].id
    } else {
      currentId.value = null
    }
    persist(currentId.value)
  }

  function setProject(id: string) {
    if (!projects.value.some(p => p.id === id)) return
    currentId.value = id
    persist(id)
  }

  /** 添加项目:POST → 刷新列表 → 选中新项目。后端错误向上抛,由调用方提示 */
  async function addProject(input: { name: string; root: string; id?: string; note?: string }) {
    const data = await apiJson<{ data: { project: ProjectInfo } }>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.name, root: input.root, id: input.id, note: input.note }),
    })
    await load()
    const id = data?.data?.project?.id
    if (id) setProject(id)
  }

  /** 更新项目(name/root/note):PUT → 刷新列表(不切换选中) */
  async function updateProject(id: string, input: { name?: string; root?: string; note?: string }) {
    await apiJson(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    await load()
  }

  /** 移除项目注册(不删磁盘 .code-panel)。若删的是当前项则回退到第一个 */
  async function removeProject(id: string) {
    await apiJson(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
    const wasCurrent = currentId.value === id
    await load()
    if (wasCurrent && projects.value.length) setProject(projects.value[0].id)
  }

  return {
    projects, currentId, currentProject, loaded,
    load, setProject, addProject, updateProject, removeProject,
  }
})
