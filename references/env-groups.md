# 环境变量组(跨机器零改配置)

> 入口:SKILL.md「指令路由表」· 配置文件:项目 `.code-panel/envs.yaml` · 面板入口:右上 🅰

## 机制

- `envs.yaml` 定义组:`groups: [{id, name, default?, vars}]`
- 右上 🅰 切换 → **全量重写 `~/.code-panel/active-env.sh`**(shell rc source 后新终端生效)+ 面板终端/应用启停自动注入
- 应用侧配置写占位符读变量,如 `${CODE_PANEL_DB_HOST:默认值}` —— 同一份配置跨机器零修改切换

## 写 yaml 的规矩

- **占位符值必须加引号**:flow mapping 里裸 `${a:b}` 会把 YAML 解析炸
- 改完自检(插值后的实际 host + 生效 vars 一起回):`bash ~/.claude/skills/code-panel/cp get "/api/inspect?project=<id>"`,不要开页面肉眼验证

## 相关文件

- `sql.yaml` / `redis.yaml` 的 host 同样支持 `${VAR:默认}` 占位
- 物化产物:`~/.code-panel/active-env.sh`(当前组,rc source 生效)
