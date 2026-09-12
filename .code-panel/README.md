# .code-panel —— 本项目在 code-panel 面板里的配置

面板按本项目读取此目录;**修改即生效**,无需重启面板。

> 📐 **路径规则:一律写「相对项目根的相对路径」**(如 code/backend/apps/main/logs/a.log),
> 面板读取时自动转成绝对路径;这样本目录可随仓库换机器/换目录直接用。
> 仅当目标确在项目根之外时才用绝对路径(但那样的路径不随仓库迁移)。

## 文件说明
| 文件 | 作用 | 想加什么就编辑它 |
|------|------|------------------|
| `apps.yaml`      | 应用服务日志(面板 Apps,/log) | 加平台/应用:backend/frontend + 日志文件/端口/启停(旧 logs.yaml 兼容) |
| `sql.yaml`       | 数据库连接(面板 /sql) | 加连接:mysql/sqlite 均支持 |
| `prd.yaml`       | PRD 目录(面板 /prd)   | 加 PRD 文档目录 {name,dir} |
| `git.yaml`       | git 仓库(面板 /git)   | 加本机 git 仓库 {id,name,path} |
| `commands.yaml`  | 命令抽屉「自定义命令」 | 加启动/停止/单模块命令按钮(见下) |
| `links.yaml`     | 快捷方式(/log 顶栏 🔗) | 加分组 quick links:group→items→多 urls(标签/域名) |
| `uploads/`       | ☁ 上传目录:浏览器传上来的文件 | 面板 ☁ 上传;文件绝对路径发给终端/AI 用 |
| `downloads/`     | ☁ 下载目录:AI 产物交付区 | AI/命令写文档进这里,用户在面板 ☁ ⬇ 下载拿回 |
| `data/`          | 运行时数据(SQL 历史/队列、PRD 完成态、tmux 备注;cloud-config.json 存云目录覆盖) | 面板自动写,勿手改 |

每个 yaml 文件顶部注释就是完整字段说明 + 示例(把注释里的例子打开就能用)。

## 自定义命令 commands.yaml
提交式、随仓库走,仓库里的 AI 照 `commands.yaml` 顶部注释即可为这个项目加启动/停止按钮。
面板「命令终端」抽屉会读到它;新增 id 取唯一值即可。
