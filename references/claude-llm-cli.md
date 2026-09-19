# 命令行按供应商跑 claude(claude-glm / claude-ds 包装器)

> 入口:SKILL.md「指令路由表」· 文件:`bin/claude-llm`(核心)+ `bin/claude-glm` `bin/claude-ds`(名字快捷方式)· 依赖:`cp`(ai-token 免密)、`jq`、`claude` 在 PATH

场景:**临时**用面板「⚙ 配置 → 模型」里某个供应商跑一次 claude,**不动全局激活态**。和面板切换(全局、影响所有会话)互补。

## 用法

```bash
bin/claude-glm                    # = 用「智谱 GLM」起交互式 claude
bin/claude-ds -p "总结这段日志"   # = 用「DeepSeek」跑单次
bin/claude-llm "Kimi"             # 任意供应商:传面板里的名字原样
```

- 供应商名必须和面板 ⚙ 配置 → 模型 里的名字**逐字一致**;不存在 → exit 1 并提示
- 面板 3008 没起会直接报错 → `bash ~/.claude/skills/code-panel/start.sh`

## 原理(为什么是 --settings)

`cp` 拉供应商清单 → 按名找 id → `/reveal` 取明文 vars → 多行 `KEY=VALUE` 组装成 `{"env":{…}}` → `exec claude --settings <json>`。

优先级:**`--settings`(命令行级)> `~/.claude/settings.json` 的 env > shell export**。全局激活的模型写死在 settings.json,export 压不掉它,只有 `--settings` 能赢——所以包装器对全局态**零改动**。

vars 解析容忍:`export ` 前缀 / 单双引号包裹 / 空行 / `#` 注释;值是 `<占位符>` = 未填,跳过不写坏配置。

## ⚠ 铁律:会话内永远不要调全局激活

- **AI 会话内禁止调 `/api/llm/activate` 或手改 `~/.claude/settings.json` 的模型 env**——面板激活会重写 settings.json,而当前会话自己就跑在这个文件上,下一个请求直接 400,会话当场死(2026-09-18 会话 fe9a74ce 实测:切 DeepSeek 验证包装器,自己被自己的测试杀死)
- 要验「全局为干扰项、包装器仍走对」这类场景:让**用户**在面板点切换,测完提醒切回;或会话外 shell 做
- 包装器本身用 `--settings`,天然隔离,随便测,不需要碰全局
- 全局激活态排查只读:`bash cp get /api/llm/providers | jq .active`;恢复让用户在面板操作

## 加新快捷方式

两行 shim,`exec` 转发 + 名字对应面板(面板里改名要同步这行):

```bash
#!/usr/bin/env bash
# claude-xx — <备注> → claude(名字对应面板 ⚙ 配置 → 模型;面板里改名要同步这行)
exec bash "$(dirname "$(readlink -f "$0")")/claude-llm" "<面板供应商名>" "$@"
```

## 已验证(2026-09-18)

`claude-glm --version` / `claude-ds --version` 通;错误路径(无此名 / 不传名)exit 1/2 报错清晰;全局激活 DeepSeek 干扰下 `claude-glm` 仍走 GLM(模型自报「Z.ai 智谱」)——`--settings` 压制 settings.json 成立。
