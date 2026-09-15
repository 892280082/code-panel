<script setup lang="ts">
// ── 全局配置弹窗(外壳:弹窗框架 + Tab 栏 + 面板装配)──────────
//   打开入口:每页左上角 ⚙(Sidebar)。项目切换/添加、账号改密/登出。
//   各 Tab 内容在对应 *Panel.vue(ProjectPanel/BackupPanel/FilesPanel/
//   NginxPanel/SecurityPanel/AppearancePanel/AccountPanel);日志/库/仓库/PRD 等不做
//   手配 UI,统一在项目 .code-panel/*.yaml 维护。

import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import { useUiStore } from '@/stores/ui'
import BackupPanel from '@/components/BackupPanel.vue'
import NginxPanel from '@/components/NginxPanel.vue'
import SecurityPanel from '@/components/SecurityPanel.vue'
import ProjectPanel from '@/components/ProjectPanel.vue'
import FilesPanel from '@/components/FilesPanel.vue'
import AccountPanel from '@/components/AccountPanel.vue'
import LlmPanel from '@/components/LlmPanel.vue'
import WikiPanel from '@/components/WikiPanel.vue'
import HotkeyPanel from '@/components/HotkeyPanel.vue'
import AppearancePanel from '@/components/AppearancePanel.vue'

const emit = defineEmits<{ (e: 'close'): void }>()

const projects = useProjectsStore()
const ui = useUiStore()

// Esc 关闭弹窗(2026-09-14 用户定,与 Ctrl+` 呼出配套)。
// ⭐ setTimeout 判 defaultPrevented:快捷键 Tab 录入新键位时 Esc = 取消录入
//   (HotkeyPanel 捕获阶段已 preventDefault),本监听虽先注册但延后一拍看标志,
//   录入中的 Esc 就不会误关整个弹窗。
function onEsc(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !ui.cfgOpen) return
  setTimeout(() => { if (!e.defaultPrevented) ui.closeConfig() }, 0)
}
onMounted(() => window.addEventListener('keydown', onEsc))
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))

type TabKey = 'project' | 'llm' | 'capsule' | 'backup' | 'files' | 'nginx' | 'security' | 'account' | 'hotkey' | 'appearance'
const activeTab = ref<TabKey>((ui.cfgTab as TabKey) || 'project')
const tabs: { key: TabKey; label: string }[] = [
  { key: 'project', label: '项目' },
  { key: 'llm', label: '模型' },
  { key: 'capsule', label: '胶囊' },
  { key: 'backup', label: '备份' },
  { key: 'files', label: '文件' },
  { key: 'nginx', label: 'nginx' },
  { key: 'security', label: '安全' },
  { key: 'account', label: '账号' },
  { key: 'hotkey', label: '快捷键' },
  { key: 'appearance', label: '装修' },
]
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal">
        <div class="modal-header">
          <span>⚙ 配置</span>
          <button class="close" title="关闭" @click="emit('close')">✕</button>
        </div>

        <div class="tabs">
          <button
            v-for="t in tabs" :key="t.key"
            class="tab" :class="{ on: activeTab === t.key }"
            @click="activeTab = t.key"
          >{{ t.label }}</button>
        </div>

        <div class="modal-body">
          <!-- ── 项目 ── -->
          <div v-if="activeTab === 'project'" class="tab-pane">
            <ProjectPanel @used="emit('close')" />
          </div>

          <!-- ── 模型(LLM 供应商切换;全局作用域)── -->
          <div v-else-if="activeTab === 'llm'" class="tab-pane">
            <LlmPanel />
          </div>

          <!-- ── 胶囊(时空胶囊目录 + Wiki 仓库,全局作用域)── -->
          <div v-else-if="activeTab === 'capsule'" class="tab-pane">
            <WikiPanel />
          </div>

          <!-- ── 备份 ── -->
          <div v-else-if="activeTab === 'backup'" class="tab-pane">
            <BackupPanel />
          </div>

          <!-- ── 文件(当前项目的云上传/下载目录)── -->
          <div v-else-if="activeTab === 'files'" class="tab-pane">
            <FilesPanel />
          </div>

          <!-- ── nginx(检测当前项目 .code-panel/nginx conf 是否被本机加载)── -->
          <div v-else-if="activeTab === 'nginx'" class="tab-pane">
            <NginxPanel />
          </div>

          <!-- ── 安全(安全模式:未解锁访问一律 404,秘密链接解锁)── -->
          <div v-else-if="activeTab === 'security'" class="tab-pane">
            <SecurityPanel />
          </div>

          <!-- ── 快捷键(全局热键;localStorage,改完即时生效)── -->
          <div v-else-if="activeTab === 'hotkey'" class="tab-pane">
            <HotkeyPanel />
          </div>

          <!-- ── 装修(favicon 换色;全局作用域,选完即时生效)── -->
          <div v-else-if="activeTab === 'appearance'" class="tab-pane">
            <AppearancePanel />
          </div>

          <!-- ── 账号 ── -->
          <div v-else class="tab-pane">
            <AccountPanel @close="emit('close')" />
          </div>
        </div>

        <div class="modal-footer">
          <span class="foot">当前项目:#{{ projects.currentProject?.id || '—' }} {{ projects.currentProject?.name || '' }}</span>
          <button class="ghost" @click="emit('close')">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.modal {
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  width: 960px; max-width: 96vw; height: 88vh; max-height: 88vh;
  display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  font-size: 13px; font-weight: 700; letter-spacing: 0.06em; color: var(--text);
}
.modal-header .close { background: transparent; border: none; color: var(--text-dim); font-size: 16px; cursor: pointer; }
.modal-header .close:hover { color: var(--danger); }

.tabs { display: flex; gap: 4px; padding: 8px 16px 0; border-bottom: 1px solid var(--border); }
.tab {
  padding: 7px 16px; font-size: 12px; color: var(--text-dim);
  background: transparent; border: 1px solid transparent; border-bottom: none;
  border-radius: 6px 6px 0 0; cursor: pointer;
}
.tab.on { color: var(--glow); background: var(--bg); border-color: var(--border); }

.modal-body { flex: 1; padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; }
.tab-pane { display: flex; flex-direction: column; gap: 8px; }

.modal-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding: 10px 16px; border-top: 1px solid var(--border);
}
.modal-footer .foot { margin-right: auto; font-size: 11px; color: var(--text-dim); }
</style>
