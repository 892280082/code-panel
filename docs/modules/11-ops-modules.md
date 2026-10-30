# 11 · 运维四件套:环境组 / 模型供应商 / nginx / 备份

> 这四个都是"改机器状态"的模块,共同点:**全局作用域 + 高风险 + 必须幂等**。
> 关键文件:`src/env/env-store.ts`、`src/llm/provider-store.ts`、`glm-quota.ts`、`src/nginx/nginx-manager.ts`、`src/backup/backup-manager.ts`、`src/utils/shell-rc.ts`、`src/routes/env.ts`、`llm.ts`、`nginx.ts`、`backup.ts`。

---

## 一、环境变量组

### 配置:`envs.yaml`(项目级)

```yaml
groups:
  - id: dev
    name: 开发环境
    default: true
    vars:
      DB_HOST: 127.0.0.1
      DB_PORT: "3306"
  - id: prod
    name: 生产
    vars: { DB_HOST: 10.0.0.12 }
```

### 机制

- 右上 🅰 切换 → **全量重写** `~/.code-panel/active-env.sh`(0600)
- `src/utils/shell-rc.ts`:在 shell rc 里维护一个**独立 managed 块**(source 该文件),不碰用户其他配置
- 面板终端/应用启停自动注入当前组
- 其它模块的 yaml 支持 `${VAR:默认}` 占位(sql.yaml/redis.yaml 的 host 等)

### 接口

`GET /api/env`、`POST /api/env/ensure|activate|reset|mount`

### 坑

- **yaml 占位符必须加引号**:flow mapping 里裸 `${a:b}` 会被 YAML 解析炸
- 切组是"全量重写",不是增量;写前先读原文件做 diff 校验
- 改完用 `/api/inspect` 看插值后的实际值

---

## 二、模型供应商(LLM)

### 存储

全局库 `llm_providers` 表(含 API Key,0600,不进 git)。

### 切换 = 三件事(缺一不可)

1. 重写 `~/.code-panel/active-llm.sh`
2. shell rc managed 块更新(同上)
3. **同步 `~/.claude/settings.json` 的 env 受管键**

> ⚠ `settings.json` 的 env **优先级高于** shell 导出。不同步这步,旧配置会静默压掉切换结果。

### 受管键原则

- 只动"所有供应商 vars 键的并集"
- 切走/删供应商 → 按 manifest 精确删键
- "不注入"档 = 清空受管键(恢复官方登录态)

### 安全

- 出参一律脱敏(`****尾4`);PUT 回传含 `****` 的值 = **保留旧 Key**
- `GET /api/llm/providers/:id/reveal` 才给明文(前端点 👁)
- 动手前备份 `~/.claude/settings.json`

### 接口

`GET/POST/PUT/DELETE /api/llm/providers[/:id]`、`POST /api/llm/activate|mount`、`GET /api/llm/glm-quota`

### 前端

右上「🤖 模型」切换器 + ⚙ →「模型」Tab(`LlmPanel.vue`、`ProviderSwitcher.vue`、`GlmPlanGauges.vue`)。

---

## 三、nginx(只读为主)

### 领域层 `nginx-manager.ts`

- `status`:进程/版本/配置测试
- `confs`:列出站点配置、软链关系
- `conf`:读单个配置
- `check`:`nginx -t`(不 reload)

### 接口

`GET /api/nginx/status|confs|conf`、`POST /api/nginx/check`、`GET/PUT /api/nginx/config`(面板侧配置)

### 坑

- **默认只读**:改配置/reload 不在这个模块里,避免误伤线上
- 读 `/etc/nginx` 需要权限:运行用户要有读权限,否则返回明确错误
- 软链路径要解析成真实路径再展示

---

## 四、备份

### 领域层 `backup-manager.ts`

- 备份内容:**全局库 + 各项目 `.code-panel/`**(不含 uploads/downloads/data 大目录,按配置)
- 产物:tar.gz 存 `settings.backup.path`,**保留最近 20 份**
- `runBackup()` 由启动任务/定时器触发;`GET /api/backup/list` 看历史

### 接口

`GET/PUT /api/backup/config`、`POST /api/backup/run`、`GET /api/backup/list`、`GET /api/backup/download/:name`

### 坑

- 备份过程不要阻塞事件循环(大目录用流式)
- 备份目录若在项目里,记得 gitignore
- 恢复流程**没有自动接口**:手动解包,避免误覆盖

---

## 扩展指南

### 加"环境组变量预览"

- 后端已有插值函数,加一个 `GET /api/env/preview?project=&group=`
- 前端在切换器里展示"生效后"的值(脱敏)

### 加"模型供应商连通性测试"

- 后端发一个最小请求(注意计费),返回延迟/错误
- 前端按钮 + 状态灯

### 加"nginx 配置编辑(受控)"

- 写前先 `nginx -t` 到临时文件校验
- 改完备份原文件,失败自动回滚
- 明确告知用户影响面

### 加"备份恢复"

- 恢复前强制二次确认 + 自动备份当前状态
- 只允许恢复到 `~/.code-panel` 与项目 `.code-panel`,不要动项目代码

## 相关速查

- 环境组:`references/env-groups.md`
- 模型供应商:`references/llm-providers.md`
- 接口清单:`references/api-reference.md`
