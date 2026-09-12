# 模型供应商(LLM 切换,给 Claude Code 换模型)

> 入口:SKILL.md「指令路由表」· 面板入口:右上「🤖 模型」+ ⚙ 配置 →「模型」Tab · 存储:全局库 `llm_providers` 表(仓库外、不进 git,含 API Key,0600)

场景:国内用 DeepSeek/GLM/Kimi 等跑 claude。**一套供应商 = 一段环境变量**(`vars`,每行 `KEY=VALUE`,Key 直接填在变量里)。

## 入口

- 右上「🤖 模型」切换器(只列**已启用**的供应商)
- ⚙ 配置 →「模型」Tab:增删改 / 启用开关 / 预设模板(DeepSeek · GLM · Kimi · 自定义)

## 切换 = 三件事(缺一不可)

1. 重写 `~/.code-panel/active-llm.sh`(0600)
2. shell rc 独立 managed 块更新
3. **同步 `~/.claude/settings.json` 的 env 受管键** —— ⚠ settings.json 的 env 优先级**高于** shell 导出,不同步这步,旧配置会静默压掉切换结果

### settings.json 同步细则

- 只动**受管的键**(所有供应商 vars 键的并集),其余键绝不碰
- 切走 / 删除供应商时按 manifest 精确删键
- 「不注入」档 = 清空受管键,恢复 claude 官方登录态

## 安全与自查

- API 出参一律脱敏(`****尾4`);PUT 回传含 `****` 的值 = **保留旧 Key**(防脱敏回显把真 Key 写没)
- ⚠ **动手前先备份 `~/.claude/settings.json`**:切换会真实改写它(尤其别拿假 Key 试)
- 改完自查:`cp get /api/llm/providers`(看 active / rc / settings 残留),或 `cp get "/api/inspect?project=<id>"` 的 `llm` 小节
