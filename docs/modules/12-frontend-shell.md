# 12 · 前端骨架:路由 / Store / 组件

> 负责:Vue 3 SPA 的组织方式 —— 页面怎么注册、状态怎么共享、请求怎么发、样式怎么统一。
> 关键文件:`frontend/src/main.ts`、`App.vue`、`router.ts`、`style.css`、`stores/*`、`components/Sidebar.vue`、`utils/api-fetch.ts`。

## 1. 启动与路由

```ts
// main.ts
createApp(App).use(createPinia()).use(router).mount('#app')
```

`router.ts` 的约定:

- `/` → 重定向 `/log`
- 每个页面一条 `{ path, name, component: () => import(...), meta: { requiresAuth: true } }`
- `beforeEach` 用 `stores/auth` 的 `checkAuth()` 拦截未登录 → `/login`

新增页面三步:

```ts
// 1) router.ts 加路由
{ path: '/mine', name: 'mine', component: () => import('@/views/MineView.vue'), meta: { requiresAuth: true } }
```

```ts
// 2) components/Sidebar.vue 的 tabs 加导航
{ path: '/mine', label: '我的' }
```

```vue
<!-- 3) 新建 views/MineView.vue -->
```

## 2. App.vue 全局挂载

`App.vue` 是所有页面共享的外壳,常驻组件都挂这里:

- `CommandDrawer.vue`(右下 FAB / 命令抽屉)
- `TerminalPanel.vue`(终端窗口)
- `GlobalConfigModal.vue`(⚙ 配置)
- `ProjectSwitcher.vue`(项目切换)
- `CloudPanel.vue`(☁ 云文件)
- `RepoBrowserModal.vue`、`CapsuleToast.vue`、`CapsulePreviewModal.vue`

**判定法则**:跨页面可用的东西挂 `App.vue`;只属于某页的放该 `View`。

生命周期里做了:auth 校验、胶囊 SSE 初始化、快捷键监听、刷新后恢复终端窗口(`restorePersisted`)。

## 3. Store(Pinia)

`stores/` 一览:

| Store | 负责 |
|---|---|
| `auth` | token、登录态、角色 |
| `projects` | 项目列表、当前项目(切换器) |
| `logs` | 日志页签/内容/活动心跳 |
| `sql` | 连接、查询、审批队列 |
| `redis` | 连接、键浏览 |
| `git` | 仓库、diff、提交历史 |
| `repo-browser` | 文件树弹窗 |
| `terminal` | 终端窗口、attach、最小化、快捷键状态 |
| `cloud` | ☁ 云文件 |
| `env`/`llm`/`glm-plan` | 环境组 / 模型供应商 / 额度 |
| `capsule` | 胶囊列表、SSE、未读 |
| `ui` | 全局弹窗开关(⚙ 等) |

**规矩**:

- 跨视图共享 → Store;**组件内部状态 → 局部 ref**
- 需要持久化的键走统一封装(见 `utils/` 或各 store 内的 localStorage 键表),禁止散写
- Store 里不要直接操作 DOM

## 4. 请求封装

`utils/api-fetch.ts`:

```ts
apiFetch(url, options)  // 原生 Response,自动带 Authorization
apiJson<T>(url, options) // 解析 {ok,data} → 返回 data;失败抛错
errText(e, fallback)     // 人话错误
```

项目级请求统一带 `?project=`:

```ts
const list = await apiJson<Term[]>(`/api/logs?project=${projects.currentId}`)
```

**注意**:`apiJson` 不会自动加 `Content-Type`,POST/PUT 要自己写:

```ts
await apiJson('/api/xxx', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
```

## 5. 样式与主题

`style.css` 是唯一全局样式入口:

- CSS 变量:`--border` `--text` `--text-dim` `--glow` `--glow-dim` `--glow-rgb` 等;支持明暗主题
- 圆角/间距优先用现有变量,组件 `<style scoped>` 只写差异
- 滚动条基线在全局段,组件里只覆盖尺寸
- 字体:`--font`(等宽)与界面字体

## 6. 常见交互组件

| 组件 | 用途 |
|---|---|
| `DrawerPanel.vue` | 右侧抽屉容器 |
| `GlobalConfigModal.vue` | ⚙ 配置弹窗(内部各 Tab) |
| `RejectModal.vue` | 拒绝理由输入 |
| `FileTreeNode.vue` | 懒加载树 |
| `StatusDot.vue` | 状态圆点(端口存活) |
| `Starfield.vue` | 背景星空效 |
| `SystemResourceMonitor.vue` | 资源圆环 |

## 7. 扩展指南

### 加一个页面 + Store(最常用)

1. `views/MineView.vue`:页面骨架(建议用 `apiJson` 拉数据,`onMounted` 初始化)
2. `stores/mine.ts`:`defineStore('mine', () => { ... })`(组合式 API 写法)
3. `router.ts` 注册 + `Sidebar.vue` 加入口
4. 需要全局弹窗 → 挂到 `App.vue` 并加 `ui` store 开关

### 加一个全局弹窗

- `App.vue` 挂组件(用 `v-if` 包)
- `stores/ui.ts` 加 open/close 状态
- 快捷键可在 `utils/hotkeys.ts` 注册(⚙ → 快捷键可改键)

### 加一种 SSE 数据源

```ts
const es = new EventSource(`/api/mine/stream?project=${pid}&token=${token}`)
es.onmessage = (e) => { const msg = JSON.parse(e.data); ... }
onUnmounted(() => es.close())
```

> `EventSource` 不能带头,所以走 `?token=`(后端 authMiddleware 支持)。

## 8. 常见坑

- **忘了 `Content-Type`**:`apiJson` 不自动加,body 解析不到
- **SSE 断线**:`EventSource` 自动重连,但重连后要重新拉一次全量
- **项目切换**:`projects.currentId` 变了要重新拉数据(watch currentId)
- **内存泄漏**:`setInterval`/`EventSource` 要在 `onUnmounted` 清理
- **样式污染**:组件样式加 `scoped`;全局改动先确认影响面
- **`v-html`**:渲染 Markdown/日志时确保经过转义(用 `useAnsi.ts`/渲染器现成实现)
