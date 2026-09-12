# SQL 铁律(ReviewMode)

> 入口:SKILL.md「指令路由表」· 触发场景:SQL 查询 / 审批 / 写库

| 操作 | ReviewMode ON | OFF |
|---|---|---|
| SELECT | ✅ `/api/sql/query` | ✅ 直接 |
| INSERT/UPDATE/DELETE/ALTER | ❌ 只能 `/api/sql/submit` 进队列,**明确告诉用户去 `http://localhost:3008/sql` 审批**(页面会响铃) | ✅ 直接 |
| approve / reject / review-mode 开关 | ⛔ **绝对禁止**(ai-token 通道已被后端 403 硬拦) | ⛔ 同左 |

**禁止(任何情况下):**
- 自行审批(approve / reject)
- 自行关闭 reviewMode
- 用 `connection` 内联绕审批队列

**话术**:提交写操作后告知「已进审批队列,请到 http://localhost:3008/sql 审批(页面会响铃)」,然后等用户批完再继续后续步骤。
