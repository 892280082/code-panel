# 08 · Wiki · 时空胶囊

> 负责:个人 wiki 仓库(克隆/拉取/浏览)与"时空胶囊"(往目录写 md,面板监听并弹卡)。
> 关键文件:`src/capsule/capsule-store.ts`、`capsule-monitor.ts`、`wiki-manager.ts`、`src/routes/capsule.ts`、`wiki.ts`、`frontend/src/components/CapsuleEntry.vue`、`CapsuleToast.vue`、`CapsulePreviewModal.vue`、`views/WikiView.vue`、`stores/capsule.ts`。

## 1. 时空胶囊

### 目录与格式

- 目录默认 `~/.code-panel-capsules/`(独立于 `~/.code-panel`,不进备份)
- 条目 = 一个 md 或一个目录(目录必须有 `index.md`)
- 命名:`<主题slug>-YYYYMMDD-HHmm.md`(中文可用;禁 `/`、`..`、换行)

### 监听机制(`capsule-monitor.ts`)

- `fs.watch` 目录,条目**写入停止 3 秒**才判定完成 → 推 SSE `{type:'capsule',event:'new'|'update'}`
- 前端 `CapsuleToast` 收到就弹卡;`CapsulePreviewModal` 预览双栏渲染
- **一次性写完再落盘**:边写边改会一直推迟弹卡

### 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/PUT | `/api/capsule/config` | 目录(空=恢复默认;超管) |
| GET | `/api/capsule/list` | 顶层条目(mtime 倒序) |
| GET | `/api/capsule/stream` | SSE 新/改通知 |
| GET | `/api/capsule/files?id=` | 条目内可渲染文件 |
| GET | `/api/capsule/content?id=` | 单文件暗色渲染 |
| GET | `/api/capsule/view?id=&file=` | 双栏页(file 缺省 index.md) |
| POST | `/api/capsule/remove` | 删除 → `.trash/`(7 天清;超管) |
| POST | `/api/capsule/clear` | 清空(超管) |
| GET | `/api/capsule/trash` | 回收站 |
| POST | `/api/capsule/restore` | 恢复 |

## 2. Wiki

- 克隆固定 `~/.code-panel/wiki/`
- 配置 `{url,cloned,branch,commit,dirty,lastPullAt}`;PUT **只收 SSH 地址**(`git@` / `ssh://git@`)
- 保存即 clone;手动 `clone` / `pull --ff-only`
- 渲染与 PRD 同一条管线(md → HTML,`> 原型图：` 内嵌 iframe)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/PUT | `/api/wiki/config` | 地址/状态(写=超管) |
| POST | `/api/wiki/clone` `/api/wiki/pull` | 手动克隆/拉取 |
| GET | `/api/wiki/files` | 平铺文件列表 |
| GET | `/api/wiki/view?file=` | 双栏渲染页 |

## 3. 前端

| 组件 | 职责 |
|---|---|
| `components/CapsuleEntry.vue` | 右下胶囊入口(未读提示) |
| `components/CapsuleToast.vue` | 新胶囊弹卡 |
| `components/CapsulePreviewModal.vue` | 预览(双栏) |
| `views/WikiView.vue` | wiki 浏览 |
| `stores/capsule.ts` | 列表、SSE、未读状态 |

## 4. 扩展指南

### 胶囊加"归入 wiki"一键按钮

1. 后端:`POST /api/capsule/merge`(读胶囊 → 写 wiki → push)
2. 必须遵守确认流:先出草稿,人工确认后再写(见 `references/wiki-merge.md`)
3. 前端在预览弹窗加按钮,调接口后展示结果

### 胶囊支持更多文件类型

- 白名单在 `capsule-store.ts`(md/html/图片)
- 渲染层按 MIME 分支;未知类型给下载链接

### Wiki 支持多仓库

- 现在是单克隆目录;改造要引入 `wikiList` 配置与多目录管理
- 注意 pull 并发与磁盘占用

## 5. 常见坑

- **3 秒判定**:写完再落盘,别追加 touch
- **删除进 `.trash` 不立即清**:给误删留后路
- **wiki 只收 SSH**:HTTPS 带 token 容易泄露
- **push 失败绝不删胶囊**(删除只在成功之后)
- **SSE 断线重连**:前端重连后要重新拉一遍列表,补齐漏掉的事件

## 6. 相关速查

- 胶囊格式:`references/capsule.md`
- 归入 wiki 流程:`references/wiki-merge.md`
