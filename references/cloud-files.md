# 云文件通道(给用户交付 / 收文件)

> 入口:SKILL.md「指令路由表」· 面板右下 ☁ 图标对应的能力

## 收文件(用户给 AI)

- 用户给你文件 → 面板 ☁ 上传,落在项目 `<项目根>/.code-panel/uploads/`
- 找文件先列目录:`bash ~/.claude/skills/code-panel/cp get "/api/files?project=<id>&side=upload"`

## 交文件(AI 给用户)

- 交付产物写入 `<项目根>/.code-panel/downloads/` 并告知用户「☁ → ⬇ 下载」
- 写入前先确认目录(用户可能改过):`bash ~/.claude/skills/code-panel/cp get "/api/files/config?project=<id>"`
