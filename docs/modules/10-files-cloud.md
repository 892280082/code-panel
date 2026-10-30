# 10 · 文件 / 云上传下载

> 负责:用户给面板上传文件(☁ 收)、面板给用户交付文件(☁ 交)、剪贴板图片、目录浏览与下载。
> 关键文件:`src/routes/files.ts`、`frontend/src/components/CloudPanel.vue`、`ClipboardUploadBubble.vue`、`FilePreview.vue`、`stores/cloud.ts`。

## 1. 目录约定

```
<项目根>/.code-panel/
├── uploads/      # 用户 → AI(☁ 上传落这里;gitignore)
└── downloads/    # AI → 用户(交付产物;gitignore)
```

两个目录可在 ⚙ 里改(`/api/files/config`),**读写前先查配置**,不要写死。

## 2. 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/PUT | `/api/files/config?project=` | 两目录配置 |
| GET | `/api/files?project=&side=upload\|download` | 目录清单(新→旧,含大小/时间) |
| POST | `/api/files/upload` | 多文件上传(multer) |
| POST | `/api/files/paste-image` | 剪贴板图片(base64 → 文件) |
| GET | `/api/files/raw?project=&side=&name=` | 读文件(inline;`?token=` 供下载) |

实现要点(`src/routes/files.ts`):

- `multer` 落盘,文件名清洗(去路径分隔符),重名加后缀
- `raw` 必须校验 `name` 规范化后仍在目标目录内(`safe-resolve`)
- 大文件支持 Range(视频/PDF 预览)

## 3. 前端

| 组件 | 职责 |
|---|---|
| `CloudPanel.vue` | ☁ 面板:上传/下载两个 Tab、拖拽上传、删除 |
| `ClipboardUploadBubble.vue` | 粘贴图片气泡(编辑器/任意页) |
| `FilePreview.vue` | 图片/文本/PDF 预览 |
| `stores/cloud.ts` | 当前 Tab、列表、上传进度 |

交付约定(给 AI 用):

- 收文件:先 `GET /api/files?side=upload` 列目录再读
- 交文件:写 `downloads/` 并告知用户"☁ → ⬇ 下载"
- 规范见 `references/cloud-files.md`

## 4. 扩展指南

### 加"目录层级"浏览

- 现在是一层平铺;要支持子目录需改接口(`?path=`)与路径校验
- 前端 `FileTreeNode` 可复用

### 加"自动清理"

- 定时任务扫描 `uploads/`,超过 N 天移入 `.trash/`
- 规则写入全局 settings,别写死

### 加"下载打包(zip)"

- 用 `archiver` 流式打包,注意大目录内存与超时
- 打包时排除 `.trash/`

## 5. 常见坑

- **路径穿越**:文件名/相对路径必须 safe-resolve
- **上传大小**:`express.json({limit})` 只影响 JSON;文件走 multer 的 limits,别把面板打爆
- **中文文件名**:上传/下载两侧都要正确编码(Content-Disposition 用 RFC 5987)
- **`?token=` 泄露**:只用于本机/局域网面板,不要贴公网
- **uploads 不进 git**:确认项目 `.gitignore` 已覆盖

## 6. 相关速查

使用约定:`references/cloud-files.md`;接口清单:`references/api-reference.md` 的「终端 / 文件 / …」节。
