---
name: code-panel
description: 运维面板(端口 3008):应用日志/启停、SQL 查询审批、Redis、Git diff、PRD 文档、终端、备份、nginx。配置即项目内 .code-panel/*.yaml。AI 用仓库根 cp 脚本本机免密调用全部 API。
---

# code-panel(运维面板)

单机运维面板:管你机器上所有项目的 **应用日志与启停 / SQL 查询与审批 / Redis / Git diff / PRD 文档 / 终端 / 备份 / nginx**。一切项目配置 = 项目里 `.code-panel/*.yaml`(提交式,改完即生效);面板运行时数据在 `~/.code-panel/`(gitignore)。

## 启动与访问

```bash
bash ~/.claude/skills/code-panel/start.sh    # 端口 3008;开发:npx tsx src/server.ts
```

| 路径 | 用途 |
|---|---|
| `http://localhost:3008/login` | 登录页(默认账号:仓库 `config.json` 的 `credentials`,首次启动播种为超管) |
| `/log` `/sql` `/redis` `/prd` `/git` `/wiki` | Apps(卡片+日志页签)/ SQL 评审 / Redis / PRD 文档 / Git / Wiki |

左侧栏页签 + 左上 ⚙ 配置(项目/备份/文件/nginx/安全/账号);右上资源圆环 + 🔗 快捷 + 🅰 环境组;右下浮动:💻 命令终端、📂 仓库浏览、☁ 云文件。

## ⭐ AI 核心工作流(必须遵守)

### 1. 调面板接口一律用 `cp`(本机免密)

```bash
bash ~/.claude/skills/code-panel/cp get  /api/inspect?project=4
bash ~/.claude/skills/code-panel/cp get  /api/logs?project=4
bash ~/.claude/skills/code-panel/cp post /api/sql/query -d '{"dbId":"hq","sql":"select 1"}'
bash ~/.claude/skills/code-panel/cp raw  /api/stream?project=4      # 不解析信封
```

- 鉴权由脚本内部自理(`~/.code-panel/ai-token`,0600,仅本机可读 = 本机免密;**安全模式开着也直通,外网拿不到 token 照样全 404**)
- `project` 传注册表 **id**(数字,先 `cp get /api/projects` 查),不是项目名
- 调用者不需要知道端口/密码/token/安全模式开关的任何细节

### 2. 改完任何 `.code-panel/*.yaml` → 一发自检

```bash
bash ~/.claude/skills/code-panel/cp get "/api/inspect?project=<id>"
```

返回:各模块条目数/mtime/YAML 解析错误、sql/redis 连接**插值后的实际 host + 存活 + 版本**(密码脱敏)、应用端口探活、当前环境组生效 vars、静态校验 errors。**不要开页面肉眼验证,不要问用户「生效了没」。**

### 3. SQL 铁律(ReviewMode)

| 操作 | ReviewMode ON | OFF |
|---|---|---|
| SELECT | ✅ `/api/sql/query` | ✅ 直接 |
| INSERT/UPDATE/DELETE/ALTER | ❌ 只能 `/api/sql/submit` 进队列,**明确告诉用户去 `http://localhost:3008/sql` 审批**(页面会响铃) | ✅ 直接 |
| approve / reject / review-mode 开关 | ⛔ **绝对禁止**(ai-token 通道已被后端 403 硬拦) | ⛔ 同左 |

禁止:自行审批、自行关 reviewMode、用 `connection` 内联绕队列。

### 4. 云文件通道(给用户交付/收文件)

- 用户给你文件 → 在项目 `<项目根>/.code-panel/uploads/`(面板 ☁ 上传);找文件先 `cp get "/api/files?project=<id>&side=upload"`
- 交付产物给用户 → 写入 `.code-panel/downloads/` 并告知「☁ → ⬇ 下载」;写入前先 `cp get "/api/files/config?project=<id>"` 确认目录(用户可能改过)

## 存储模型(两层,⭐ 必懂)

```
~/.code-panel/                    # 全局(CODE_PANEL_HOME 可覆盖;所有实例共享)
├── data.db                       #   users / projects 注册表 / settings / llm_providers(含 API Key,0600)
├── jwt.secret · ai-token         #   登录密钥 / 本机免密 token(0600)
├── active-env.sh                 #   当前环境组物化脚本(shell rc source → 新终端生效)
├── active-llm.sh                 #   当前模型供应商物化脚本(同上;含 API Key,0600)
└── wiki/                         #   个人 wiki 克隆(SSH 公钥 pull;写入/push 由终端 claude code 做)

~/.code-panel-capsules/           # 时空胶囊文档(⭐独立目录,不进 ~/.code-panel 备份链路)

<项目根>/.code-panel/             # 项目配置 = 提交式文件,随仓库走、可手改、修改即生效
├── apps.yaml                     # 应用服务(日志+启停;⚠ start 脚本保活铁律见 references/apps-lifecycle.md)
├── sql.yaml / redis.yaml         # 连接清单(host 支持 "${VAR:默认}" 环境变量占位,跨机器切换)
├── envs.yaml                     # 环境变量组(右上 🅰;切换=全量重写 active-env.sh 并注入终端)
├── prd.yaml / git.yaml / links.yaml / commands.yaml
├── nginx/                        # 项目 nginx conf 副本(检测本机是否加载)
├── uploads/ downloads/           # ☁ 云文件(用户可改,见 /api/files/config)
└── data/                         # 运行时(gitignore:sql 历史/审批队列/PRD 完成态/tmux 备注)
```

- **加配置 = 改文件**:每个 yaml 顶部注释就是字段说明书 + 示例,面板实时读取
- 项目级接口必须带 `?project=<id>`;普通用户(非超管)仅可见被分配的项目

## 环境变量组(跨机器零改配置)

`envs.yaml` 定义组(`groups: [{id,name,default?,vars}]`);右上 🅰 切换 → 全量重写 `~/.code-panel/active-env.sh`(shell rc source 生效)+ 面板终端/启停自动注入。应用侧 yml 写 `${CODE_PANEL_DB_HOST:默认}` 占位读;**写 yaml 时占位符值必须加引号**(flow mapping 里裸 `${a:b}` 会 YAML 解析炸)。

## 模型供应商(LLM 切换,给 Claude Code 换模型)

国内用 DeepSeek/GLM 等跑 claude 的场景:**一套供应商 = 一段环境变量**(`vars`,每行 `KEY=VALUE`,Key 直接填在变量里),存**全局库** `llm_providers` 表(仓库外、不进 git)。

- 入口:右上「🤖 模型」切换器(只列**已启用**的)+ ⚙ 配置 → **「模型」Tab**(增删改/启用开关/预设模板 DeepSeek·GLM·Kimi·自定义)
- 切换 = 三件事:重写 `~/.code-panel/active-llm.sh`(0600)+ shell rc 独立 managed 块 + **同步 `~/.claude/settings.json` 的 env 受管键**
- ⚠ **settings.json 的 env 优先级高于 shell 导出** —— 不同步这步,旧的 settings.json 配置会静默压掉切换结果。同步只动受管的键(所有供应商 vars 键的并集),其余键绝不碰;切走/删除时按 manifest 精确删键
- 「不注入」档 = 清空受管键,恢复 claude 官方登录态
- API 出参一律脱敏(`****尾4`);PUT 回传含 `****` 的值 = 保留旧 Key(防脱敏回显把真 Key 写没)
- 改完自查:`cp get /api/llm/providers`(看 active/rc/settings 残留),或 `cp get "/api/inspect?project=<id>"` 的 `llm` 小节
- ⚠ **动手前先备份 `~/.claude/settings.json`**:切换会真实改写它(尤其别拿假 Key 试)

## PRD 指令(用户说「PRD/写PRD/原型/方案文档」时)

写 PRD 前必读 `references/prd-directory-format.md`;模板在 `templates/prd/`(**复制即用,禁止自创结构**)。一条龙:cp 模板 → 填总看板 index.md → 子计划(入口 index + 步骤 md + 原型 html + 伪代码/)→ 在项目 `.code-panel/prd.yaml` 的 folders 注册 → `cp get /api/prd/folders?project=<id>` 验收。

## 时空胶囊(用户说「时空胶囊/记个想法/胶囊」时)

胶囊 = 写进全局目录的一篇 MD(或小目录),面板监听并**主动弹卡**通知用户;适合速记突发的思路。面板只负责监听/渲染,写文档完全由你完成。

**步骤(必须全做):**
1. 查胶囊目录(用户可能改过,别写死):`bash ~/.claude/skills/code-panel/cp get /api/capsule/config` → `data.dir`(默认 `~/.code-panel-capsules/`)
2. 按 `references/capsule-format.md` 生成:命名 `<主题slug>-YYYYMMDD-HHmm.md`(目录形态=同名文件夹+index.md);名字里禁止 `/`、`..`、换行
3. **一次性写完整再落盘,写完不再碰**—— 面板以「3 秒无变化」判定完成,持续写入会推迟弹卡
4. 自查:`cp get /api/capsule/list` 确认条目出现(约 3~4 秒后)

## 归入 wiki(用户说「/code-panel 归入wiki <分类>:<名字>」或粘来面板复制的提示词时)

把胶囊沉淀进个人 wiki 仓库并推送。wiki 克隆在 `~/.code-panel/wiki/`(未配置 → 提示用户先在 ⚙ →「胶囊」Tab 配 SSH 地址,**不要自己 clone**)。

**步骤(顺序执行,任一步失败立即停止并保留胶囊):**
1. 解析参数:`<分类>` 默认 `思维文档`;`<名字>` = 胶囊条目名。`cp get /api/capsule/config` 拿真实胶囊目录;条目不存在 → 报错并列出相近名字
2. 读胶囊内容 + `cp get /api/wiki/files` 看现有结构,选定目标位置(见下一步草稿)
3. **⭐ 出并入草稿,等用户确认 —— 没确认前一个字都不许写进 wiki**。草稿固定格式:

   ```
   📋 并入草稿:<胶囊名>
   ── 并入到哪 ──
   目标:wiki/<分类>/<名字>.md        ← 新建页
         (或:wiki/<已有页>.md        ← 并入已有页,注明第几节)
   ── 怎么并 ──
   新建整页 / 并入 <已有页> 的「<节名>」节 / 与 <已有页> 合并去重
   ── 并入哪些信息 ──
   · 写入:<胶囊里的要点 1>(原文/提炼)
   · 写入:<要点 2> …
   · 丢弃:<明显过时/重复的内容>(说明为什么)
   · 已有页改动:在「<节名>」后追加 N 段 / 补索引链接
   ── commit ──
   docs(<分类>): <名字>
   ```

   贴出草稿后**停住**,明确问「确认这样并入吗?」:
   - 用户说「确认/执行/可以/并入吧」→ 继续第 4 步
   - 用户提出修改 → 按新要求重出草稿,再等确认
   - ⛔ 绝不跳过确认直接写入(哪怕是重复指令或用户催促)
4. `git -C ~/.code-panel/wiki pull --ff-only` 先同步;冲突 → 停,让用户手动处理。
   ⚠ **空仓库**(还没首个提交,`git rev-parse HEAD` 报「有歧义的参数 'HEAD'」/「unknown revision」):跳过 pull,直接下一步 —— 首次 push 会自动建立远程分支
5. 按已确认的草稿写入目标文件(**提炼并入**,不要整篇硬拷;按 wiki 现有格式补索引链接,没有索引就不造)→ `git -C ~/.code-panel/wiki add -A && git -C ~/.code-panel/wiki commit -m "docs(<分类>): <名字>" && git -C ~/.code-panel/wiki push`(SSH 公钥;空仓库首次 push 若被拒,用 `git push -u origin HEAD`)
6. **push 成功后**删除胶囊条目(`rm` 文件 / `rm -rf` 目录)并告知「已归档」;push 失败 → 保留胶囊、贴出 stderr,**绝不删源**

## 子文档索引(按需读)

| 文档 | 内容 |
|---|---|
| [references/api-reference.md](references/api-reference.md) | 全部 API 按模块速查表 |
| [references/apps-lifecycle.md](references/apps-lifecycle.md) | apps.yaml 字段 + 启停 oneshot 语义 + **start 脚本保活三大坑(AI 写 apps.yaml 前必读)** |
| [references/accounts-security.md](references/accounts-security.md) | 多账号/项目授权/安全模式/ai-token 机制 |
| [references/prd-directory-format.md](references/prd-directory-format.md) | PRD 目录结构与文档格式 |
| [references/capsule-format.md](references/capsule-format.md) | 时空胶囊文档规范(命名/形态/写入纪律) |
