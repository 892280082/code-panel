# 01 · 认证 / 账号 / 安全模式

> 负责:登录发 JWT、记住我、错误锁定、多账号与项目授权、本机免密 token、安全模式(隐身)。
> 关键文件:`src/auth/*`、`src/routes/auth.ts`、`src/routes/users.ts`、`src/security/stealth.ts`、`frontend/src/views/LoginView.vue`、`frontend/src/stores/auth.ts`。

## 1. 数据模型

- 全局库 `~/.code-panel/data.db` 的 `users` 表:`username / password(哈希) / role(superadmin|user) / projectIds`
- 首次启动 users 为空 → 用仓库 `config.json` 的 `credentials` 播种一个**超管**
- 角色只有两级:
  - `superadmin`:看全部项目;能管账号、项目注册表、模型供应商
  - `user`:只看被分配的项目;项目级接口未分配 → 403

> JWT 里的 `role` 只是 UI 快照;**每个请求都实时查库**。改分配/删号立即生效(被删用户 token 立即 401)。

## 2. 登录链路

```
POST /api/auth/login {username,password,remember?}
  → 校验锁定表(14 次失败锁账号)
  → 校验密码
  → 签发 JWT(HS256,密钥 ~/.code-panel/jwt.secret)
  → Set-Cookie: cp_auth=...; 响应 {ok, data:{token, username, role}}
```

前端 `stores/auth.ts`:

- 勾「记住我」→ `localStorage.cp_token`;不勾 → `sessionStorage.cp_token`(关标签即登出)
- `router.beforeEach` 检查 `checkAuth()`,未登录跳 `/login`

**令牌三种带法**(后端 `authMiddleware` 都认):

| 方式 | 场景 |
|---|---|
| `Authorization: Bearer <jwt>` | 普通 API(fetch 默认) |
| `?token=<jwt>` | SSE / iframe / 下载(浏览器原生请求带不了头) |
| `cp_auth` cookie | 页面内嵌资源、同源下载 |

## 3. 本机免密通道(ai-token)

- 启动时 `ensureAiToken()` 生成 `~/.code-panel/ai-token`(128bit,chmod 600,永不进 git)
- 语义:**能读这个文件 = 本机主人** → 以超管身份直通所有 API(含安全模式)
- 调用方一律用仓库根 `cp` 脚本封装,不要自己读 token
- ⛔ `denyAi` 中间件对 SQL 审批/评审模式端点强制 403:AI 通道不许碰审批

新建需要"人肉专属"的端点时,照抄这个模式:

```ts
function denyAi(req, res, next) { if (req.user?.via === 'ai-token') return res.status(403).json({ok:false,error:'该操作只允许人工'}); next(); }
router.post('/api/xxx/approve', requireProject, denyAi, route(...));
```

## 4. 安全模式(隐身 / 防探测)

配置存全局 settings `security`:`{enabled, secretPath, cookieSecret}`。

- 开启时:`stealthMiddleware` 在最外层,**没解锁的请求(页面/静态/API/登录口)一律返回与 Express 默认无差的 404**;WebSocket 升级直接断开
- 解锁:浏览器访问 `http://<入口>/<secretPath>` 一次 → 种 `cp_gate` HttpOnly cookie(90 天)→ 302 `/login`
- 例外:本机 ai-token 直通(`cp` 脚本不受影响)
- 管理页:⚙ →「安全」Tab:开关、查看/复制/重生成秘密路径、吊销已解锁浏览器
- 忘记路径:本机查 `~/.code-panel/data.db` 的 settings 表

**新增模块时的注意点**:安全模式开启后,任何绕过 `authMiddleware` 的公开端点也受 stealth 拦截(它在最外层),所以不需要额外适配。

## 5. 前端页面

| 组件 | 职责 |
|---|---|
| `views/LoginView.vue` | 登录表单、记住我 |
| `stores/auth.ts` | token 存取、`checkAuth()`、登出 |
| `components/AccountPanel.vue` | ⚙ → 账号:用户 CRUD、项目分配、重置密码(超管) |
| `components/SecurityPanel.vue` | ⚙ → 安全:安全模式开关/秘密路径/吊销 |
| `components/UsersPanel.vue` | 用户列表 |

## 6. 扩展指南

### 加一个"仅超管"的接口

```ts
import { requireSuperadmin } from '../auth/jwt';
router.get('/api/xxx', requireSuperadmin, route(async (req, res) => { ... }));
```

### 加一种权限粒度(例如"项目管理员")

1. `users` 表加字段 → 同步 `src/db/users.ts` 的 CRUD 与类型
2. `authMiddleware` 查询用户时带上新字段,挂到 `req.user`
3. 写一个 `requireProjectAdmin` 中间件(参考 `requireProject` 的可见性判断)
4. 前端 `stores/auth.ts` 暴露判断,面板按角色隐藏按钮

### 常见坑

- **ai-token 不能删了不重启**:删文件后要重启面板才会重新生成
- **密码哈希**:沿用 `src/auth/` 现有实现,不要自己发明
- **JWT 过期**:前端遇到 401 统一跳登录;不要在模块里各自处理
- **安全模式忘了秘密路径** = 本机也进不去,只能查库或临时改 settings

## 7. 相关速查

- API 清单:`references/api-reference.md` 的「认证 / 账号」节
- 多账号与授权细节:`references/accounts-security.md`
