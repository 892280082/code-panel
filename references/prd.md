# PRD 指令(写 PRD / 原型 / 方案文档)

> 入口:SKILL.md「指令路由表」· 触发词:PRD / 写PRD / 原型 / 方案文档

写 PRD 前必读 [prd-directory-format.md](prd-directory-format.md)(目录结构与文档格式);模板在 `templates/prd/`(**复制即用,禁止自创结构**)。

## 一条龙流程

1. cp 模板起步(`templates/prd/` → 项目 `.code-panel/prd/` 对应人名/计划目录)
2. 填总看板 `index.md`
3. 子计划:入口 index + 步骤 md + 原型 html + 伪代码/
4. 在项目 `.code-panel/prd.yaml` 的 `folders` 注册
5. 验收:`bash ~/.claude/skills/code-panel/cp get "/api/prd/folders?project=<id>"`(不要开页面肉眼验证)

## 原型内嵌机制(渲染管线)

- md 里写 `> 原型图：`路径.html`` → 渲染页原地替换为内嵌 iframe(`/api/prd/file/<绝对路径>` 直读,html/css/js 均按正确 MIME 返回)
- 相对引用解析顺序:md 所在目录 → extraBases;解析不到的引用静默跳过
- iframe 页内可相对引用共享 css(如 `../shared/xx.css`)—— 这正是路径式路由设计的目的
