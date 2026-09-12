# 归入 wiki(胶囊沉淀进个人 wiki 仓库)

> 入口:SKILL.md「指令路由表」· 触发:用户说「/code-panel 归入wiki <分类>:<名字>」或粘来面板复制的提示词

把胶囊沉淀进个人 wiki 仓库并推送。wiki 克隆在 `~/.code-panel/wiki/`(未配置 → 提示用户先在 ⚙ →「胶囊」Tab 配 SSH 地址,**不要自己 clone**)。

**步骤(顺序执行,任一步失败立即停止并保留胶囊):**

1. **解析参数**:`<分类>` 默认 `思维文档`;`<名字>` = 胶囊条目名。`cp get /api/capsule/config` 拿真实胶囊目录;条目不存在 → 报错并列出相近名字
2. **读胶囊内容** + `cp get /api/wiki/files` 看现有结构,选定目标位置(见下一步草稿)
3. **⭐ 出并入草稿,等用户确认 —— 没确认前一个字都不许写进 wiki**。草稿要**简短**(三五句话以内,不展开细节):

   ```
   📋 并入草稿:<胶囊名>
   目标:wiki/<分类>/<名字>.md(新建)| wiki/<已有页>.md(并入「<节名>」节)
   内容:<一两句话概括写什么、怎么提炼;已有页有无改动>
   ```

   贴出草稿后**停住**,问「确认吗?」:
   - 用户说「确认 / 执行 / 可以 / 并入吧」→ 继续第 4 步
   - 用户提出修改 → 按新要求重出草稿,再等确认
   - ⛔ 绝不跳过确认直接写入(哪怕是重复指令或用户催促)

4. **同步**:`git -C ~/.code-panel/wiki pull --ff-only`;冲突 → 停,让用户手动处理。
   ⚠ **空仓库**(还没首个提交,`git rev-parse HEAD` 报「有歧义的参数 'HEAD'」/「unknown revision」):跳过 pull,直接下一步 —— 首次 push 会自动建立远程分支
5. **写入并推送**:按已确认的草稿写目标文件(**提炼并入**,不要整篇硬拷;按 wiki 现有格式补索引链接,没有索引就不造)→
   `git -C ~/.code-panel/wiki add -A && git -C ~/.code-panel/wiki commit -m "docs(<分类>): <名字>" && git -C ~/.code-panel/wiki push`
   (SSH 公钥;空仓库首次 push 若被拒,用 `git push -u origin HEAD`)
6. **push 成功后**删除胶囊条目(`rm` 文件 / `rm -rf` 目录)并告知「已归档」;**push 失败 → 保留胶囊、贴出 stderr,绝不删源**

## wiki 原型约定

- 原型/架构图 HTML 放目标 md 同目录,md 里 `> 原型图：`相对wiki根的路径.html`` 内嵌(与 PRD 同一条渲染管线)
- HTML 样式统一走 wiki 根 `wiki-base.css`(`href="../../wiki-base.css"` 按目录深度),规范见 wiki 根 `样式规范.md`
