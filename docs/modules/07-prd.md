# 07 · PRD:文档目录 / 渲染 / 原型内嵌

> 负责:浏览 PRD 目录、Markdown 渲染、原型 HTML 内嵌 iframe、完成态标记、总看板生成、目录模板初始化。
> 关键文件:`src/prd/md-render.ts`、`view-pages.ts`、`file-serve.ts`、`board-gen.ts`、`src/routes/prd.ts`、`frontend/src/views/PrdView.vue`、`templates/prd/`、`references/prd-directory-format.md`。

## 1. 配置:`prd.yaml` + 目录

```yaml
dir: .code-panel/prd          # PRD 根(相对项目根)
folders:                       # 注册要展示的"中心/人名"目录
  - { name: alice, path: alice }
```

**目录结构模板**(复制即用,见 `templates/prd/`):

```
<项目根>/.code-panel/prd/
└── <人名>/
    ├── index.md               # 总看板(只讲要干什么 + 计划清单)
    └── plan/
        ├── plan-01-xxx.md     # 子计划:入口(步骤总览)
        └── plan-01-伪代码/     # 步骤文档 + 原型 html + 伪代码
```

详细规范:`references/prd-directory-format.md`(必读)。

## 2. 渲染管线

`md-render.ts`:

- Markdown → 暗色主题 HTML,支持 mermaid
- `> 原型图：`相对路径.html`` → **原地替换为 iframe**(`/api/prd/file/<路径>` 直读,MIME 正确)

`file-serve.ts`:

- 原型/图片直读:解析顺序 = md 所在目录 → `extraBases`;解析不到静默跳过
- 只允许 PRD 根内路径(防穿越)

`view-pages.ts`:

- 双栏页:左侧文件导航,右侧渲染(`/api/prd/view`)
- 伪代码高亮页(`/api/prd/code-file`)

## 3. 接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/prd/folders?project=` | 目录清单(文件数/完成态) |
| GET | `/api/prd/files` | 某目录的文件列表 |
| GET | `/api/prd/content` | 单文件渲染 HTML |
| GET | `/api/prd/view` | 双栏页(file 缺省=index.md) |
| GET | `/api/prd/file[/<path>]` | 原型/图片直读(MIME) |
| GET | `/api/prd/code-file[/<path>]` | 伪代码高亮 |
| POST | `/api/prd/done` | `{dir,done}` 完成态(存项目 data/) |
| POST | `/api/prd/gen-board` | 重绘总看板 `<prd>/<人名>/index.md` |
| POST | `/api/prd/init-skill` | 把 `templates/design-prd/` 拷进项目 `.claude/skills/`(幂等) |

## 4. 前端

| 组件 | 职责 |
|---|---|
| `views/PrdView.vue` | 计划视图:编号即路径,一个计划聚合其产物 |
| 内嵌 iframe | 原型页(同源,`/api/prd/file`) |
| 完成态 | 打勾 → `/api/prd/done` |

## 5. 扩展指南

### 加一种内嵌产物(例如视频/markdown 预览)

1. `md-render.ts` 的引用替换加标记(如 `> 视频：xxx.mp4`)
2. `file-serve.ts` 返回正确 MIME + Range(视频需要)
3. 前端 iframe 用 `<video>` 包装

### 改总看板生成规则

- `board-gen.ts` 是唯一生成器,**整份重写** `index.md`(不要增量)
- 生成前先读现有完成态,保留人工备注区(约定好的 section)

### 加"PRD 搜索"

- 服务端遍历 md 文本,限制返回条数
- 索引缓存放项目 `data/`,按 mtime 失效

## 6. 常见坑

- **相对引用是相对 md 文件**,不是相对项目根
- **路径必须限制在 PRD 根内**:`../` 穿越要拒绝
- **原地替换 iframe 只在渲染层**,不要改源文件
- **gen-board 会覆盖手改内容**:人工备注要放在约定保留区
- **文件名含中文/空格**:URL 编码要一致(前后端都 encode/decode 一次)

## 7. 相关速查

- 目录规范:`references/prd-directory-format.md`
- 使用流程:`references/prd.md`
- 接口清单:`references/api-reference.md` 的「PRD / 快捷方式 / 环境」节
