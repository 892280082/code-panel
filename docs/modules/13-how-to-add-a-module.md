# 13 · 新增一个模块(完整清单 + 示例)

> 目标:从零加一个"书签(bookmarks)"模块 —— 项目级配置 + 后端 CRUD + 前端页面 + 权限 + 自检。
> 照着这份清单换名字即可复刻到任何模块(日志、SQL、Git 都是同一套骨架)。

---

## 0. 先想清楚四件事

| 问题 | 答案决定 |
|---|---|
| 数据存哪? | 全局库(data.db)还是项目 `.code-panel/*.yaml` |
| 作用域? | 全局(登录即可)/ 项目级(带 `?project=`)/ 仅超管 |
| 只读还是可写? | 写操作要不要接入审批/二次确认 |
| 前端入口? | 新页面(router)还是现有页面加面板 |

> **默认建议**:项目级数据一律用 YAML(提交式、可手改、换机器即用);运行时数据放 `.code-panel/data/`。

---

## 1. 后端:领域层

新建 `src/bookmarks/store.ts`:

```ts
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface Bookmark { id: string; title: string; url: string }

export function fileOf(root: string): string {
  return path.join(root, '.code-panel', 'bookmarks.yaml');
}

export function readBookmarks(root: string): Bookmark[] {
  const file = fileOf(root);
  if (!fs.existsSync(file)) return [];
  const doc = yaml.load(fs.readFileSync(file, 'utf8')) as { items?: Bookmark[] } | null;
  return Array.isArray(doc?.items) ? doc.items : [];
}

export function writeBookmarks(root: string, items: Bookmark[]): void {
  const file = fileOf(root);
  const body = `# ── bookmarks.yaml —— 项目书签(面板 /bookmarks)──\nitems:\n`
    + items.map(i => `  - { id: ${i.id}, title: ${JSON.stringify(i.title)}, url: ${JSON.stringify(i.url)} }`).join('\n')
    + '\n';
  fs.writeFileSync(file, body, 'utf8');
}
```

要点:

- 路径永远从 `req.projectRoot` 拼,**不要用面板目录**
- 写文件用"临时文件 + rename"防止半截文件(大配置尤其重要)
- 输入校验(URL 协议、id 白名单)

## 2. 后端:YAML 类型与骨架

`src/projects/yaml.ts`:

```ts
export type ProjectModule =
  | 'apps' | 'sql' | 'prd' | 'git' | 'commands' | 'links' | 'redis' | 'envs'
  | 'bookmarks';                       // ← 1) 加模块名

export const DEFAULT_SKELETONS: Record<ProjectModule, string> = {
  // …
  bookmarks: `# ── bookmarks.yaml —— 项目书签 ──\nitems: []\n`,   // ← 2) 加默认骨架
};
```

再在 `ensureProjectSkeleton()` 里确认新项目会生成该文件。

## 3. 后端:路由

新建 `src/routes/bookmarks.ts`:

```ts
import { Router } from 'express';
import { route } from '../utils/route-utils';
import { requireProject } from '../projects/context';
import { readBookmarks, writeBookmarks } from '../bookmarks/store';

const router = Router();

router.get('/api/bookmarks', requireProject, route((req, res) => {
  res.json({ ok: true, data: { items: readBookmarks(req.projectRoot!) } });
}));

router.put('/api/bookmarks', requireProject, route((req, res) => {
  const items = (req.body?.items ?? []) as unknown;
  if (!Array.isArray(items)) return res.status(400).json({ ok: false, error: 'items 必须是数组' });
  writeBookmarks(req.projectRoot!, items as any);
  res.json({ ok: true });
}));

export default router;
```

**必须**:

- 用 `route()` 包 handler(异常 → `{ok:false,error}`)
- 项目级接口挂 `requireProject`
- 超管专属再加 `requireSuperadmin`
- 写操作要校验入参,返回人话错误

## 4. 后端:挂载

`src/server.ts`:

```ts
import bookmarksRouter from './routes/bookmarks';
// …
app.use(bookmarksRouter);
```

位置在 `authMiddleware` 之后(自动获得登录保护)。

## 5. 前端:Store

`frontend/src/stores/bookmarks.ts`:

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiJson } from '@/utils/api-fetch'
import { useProjectsStore } from './projects'

export const useBookmarksStore = defineStore('bookmarks', () => {
  const projects = useProjectsStore()
  const items = ref<{ id: string; title: string; url: string }[]>([])
  async function load(): Promise<void> {
    const pid = projects.currentId
    if (!pid) return
    const d = await apiJson<{ items: typeof items.value }>(`/api/bookmarks?project=${pid}`)
    items.value = d.items ?? []
  }
  async function save(next: typeof items.value): Promise<void> {
    await apiJson('/api/bookmarks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },   // ⚠ apiJson 不自动带
      body: JSON.stringify({ items: next, project: projects.currentId }),
    })
    items.value = next
  }
  return { items, load, save }
})
```

## 6. 前端:页面与入口

`frontend/src/views/BookmarksView.vue`(骨架):

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useBookmarksStore } from '@/stores/bookmarks'
const store = useBookmarksStore()
onMounted(() => { void store.load() })
</script>

<template>
  <div class="page">
    <h2>🔖 书签</h2>
    <ul>
      <li v-for="b in store.items" :key="b.id">
        <a :href="b.url" target="_blank" rel="noopener">{{ b.title }}</a>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.page { padding: 16px; color: var(--text); }
a { color: var(--glow); }
</style>
```

注册:

```ts
// router.ts
{ path: '/bookmarks', name: 'bookmarks', component: () => import('@/views/BookmarksView.vue'), meta: { requiresAuth: true } }
```

```ts
// components/Sidebar.vue 的 tabs
{ path: '/bookmarks', label: '书签' }
```

## 7. 自检(交付前必做)

1. **接口**:`bash cp get "/api/bookmarks?project=<id>"`(本机免密)
2. **写入**:`cp put /api/bookmarks -d '{"items":[...]}'`
3. **聚合体检**:`cp get "/api/inspect?project=<id>"`,确认无 yaml 解析错误
4. **页面**:打开 `/bookmarks`,切换项目 → 数据跟着变
5. **权限**:用普通账号(未分配项目)访问 → 403
6. **安全模式**:开启后未解锁访问 → 404(全局中间件已覆盖,不用额外写)

## 8. 文档

- 在本目录补 `xx-bookmarks.md`(照现有模块文档的结构:配置/接口/前端/扩展/坑)
- 更新 [index.md](index.md) 的模块表
- 如果是面向用户的功能,README 的「功能入口」也要加一行

## 9. 常见错误对照表

| 现象 | 原因 |
|---|---|
| 401 | 请求没带 JWT;iframe/SSE 忘了 `?token=` |
| 403(项目) | 没挂 `requireProject` 或用户未分配该项目 |
| `{ok:false, error:'...'}` 但不明白 | handler 抛错被 `route()` 兜住;看后端日志 |
| body 是 undefined | 没加 `Content-Type: application/json` |
| yaml 读不到 | 路径写错(相对项目根)或文件不存在(用骨架生成) |
| 切换项目数据不更新 | store 没 `watch(projects.currentId)` 重新加载 |
| 面板重启后数据丢 | 写进了内存/临时目录,没落到 yaml 或 data/ |

## 10. 什么时候该拆独立模块

- 数据模型独立、页面独立、有专属后台任务 → 独立模块(像 SQL/Redis)
- 只是某个页面的一块 UI → 做成组件,挂现有 View
- 只是配置项 → 加到现有 yaml + 面板 Tab,不要为了一个开关新建模块

---

## 附:最小模块清单(复制用)

```
[ ] src/<module>/*.ts            领域逻辑
[ ] src/routes/<module>.ts       路由(route + requireProject)
[ ] src/server.ts                挂载
[ ] src/projects/yaml.ts         类型 + 默认骨架(项目级配置)
[ ] src/routes/inspect.ts        体检项(可选但推荐)
[ ] frontend/src/stores/<x>.ts   Pinia store
[ ] frontend/src/views/<X>View.vue 页面
[ ] frontend/src/router.ts       路由
[ ] frontend/src/components/Sidebar.vue 入口
[ ] docs/modules/xx-<module>.md  模块文档 + index 表
[ ] cp 自检:/api/<module> 与 /api/inspect
```
