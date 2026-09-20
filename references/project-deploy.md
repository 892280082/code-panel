# 项目部署(本地构建直推 + 服务器部署仓)

> 部署范式定稿:**2026-09-20 demo-v2 → 241 全量落地实证**(plan-22)。任何项目上服务器照此复刻,不再逐机发明。
> 触发词:项目部署、部署到服务器、部署方案、上线部署、deploy 仓库、部署架构。

## 一、方案一句话

**开发机本地构建 → rsync 直推服务器(临时名+原子换名)→ 容器重启/静态直出 → 探活**。
不经过构建机/中转机;推送中断不伤线上;服务切换窗口只剩重启本身。code-panel 命令抽屉按钮 = 全链入口(进度+速率全程可见)。

## 二、服务器侧四件套(部署仓 = 单一事实源)

新建 git 仓 `deploy-<项目>`(私有;**配置一律在服务器上改+推**,开发机经主仓 submodule 只读跟进):

```
deploy-<项目>/
├── services/                          ═══ 一个 Java 服务一个目录(自包含)═══
│   ├── Dockerfile                     共享基础镜像(<app>-java:21;jar 不进镜像)
│   ├── <ctl>                          管理脚本 start|stop|restart|status|logs <p>|all(软链 /usr/local/bin)
│   └── {p}/                           每服务一份,同构(仅名/端口/库不同)
│       ├── docker-compose.yaml        name=<app>-{p} / host 网络 / restart 除非停
│       │                              / env_file /etc/<app>/app.env
│       │                              / entrypoint: java -jar … | tee /logs/{p}.log(stdout 落文件)
│       │                              / 挂载:./jars/{p}.jar→/app/app.jar + ../../logs→/logs + ./config→/app/config
│       ├── config/application.yml     线上配置(连服务器本机库/Redis/生产参数)→ 挂 /app/config
│       └── jars/                      🚫 gitignore(产物)
├── frontend/                          🚫 gitignore(前端集中区;nginx 同根好配,不进服务目录)
├── logs/                              🚫 gitignore(日志集中;stdout tee + 中间件容器卷)
├── infra/docker-compose.infra.yml     ═══ 中间件一个总 compose(MySQL/Redis/MQ;数据卷宿主 /data)═══
├── .code-panel/                       服务器侧面板配置 + nginx/<站点>.conf
│   └── nginx/<站点>.conf              宿主 nginx 实体配置(见 §二-2)
└── .gitignore                         产物区不入库:services/*/jars/、frontend/、logs/
```

**要点**:
1. **Java 服务各自独立 compose**(`services/{p}/docker-compose.yaml`)——单服务 restart 互不牵连;compose project name 隔离。
2. **nginx = 宿主实体**(systemd 自启),**不起容器**:配置软链 `sites-enabled/ ← 仓内 .code-panel/nginx/<站点>.conf`;`/{p}/` alias frontend/{p}/ + `/{p}-api/` 反代 `127.0.0.1:{端口}` + `gzip_static on`(直发 .gz)+ WS 透传。host 网络容器全 127.0.0.1,零 DNS 依赖。
3. **中间件一个总 compose**(infra):声明式事实源,`up -d` 可 1:1 重建;数据卷挂宿主目录持久。⚠ 连接参数写死进 command(如 MySQL `--max-connections=<N>`,按服务数×连接池+余量定,默认 151 九服务必爆)。
4. **线上配置不进代码仓**:config/application.yml 挂 `/app/config/`,Spring Boot 外部配置**覆盖 jar 内 resources 同名键 → 改配置 = 改文件 + restart,不重新打包**。⚠ 打包禁 prod profile(遗留 profile 专属文件优先级更高会反杀覆盖)。
5. **日志 = stdout tee**:dev 的日志本是 shell 重定向,容器对齐同语义(entrypoint `| tee /logs/{p}.log`)→ 面板 apps.yaml `file:` 直指,Apps 页尾日志即看。⚠ compose 配置变更要 `up -d` recreate,`restart` 不生效。

## 三、本地侧(两件)

**① 免密通道(一次性)**:

```bash
sshpass -p '<密码>' ssh-copy-id -i ~/.ssh/id_ed25519.pub <user>@<服务器>   # 密码仅此一次
# ~/.ssh/config 追加别名,脚本与人工统一入口:
# Host <别名>
#     HostName <ip> / User <user> / IdentityFile ~/.ssh/id_ed25519
```

**② 部署脚本 + 面板按钮**(主仓 `.claude/skills/<deploy-skill>/deploy.sh` + `.code-panel/commands.yaml`):

- 后端链**原子替换三段式**(2026-09-20 用户拍板,写死):
  `mvn -pl <admin>-{p} -am clean package`(默认 dev)→ ① `rsync --info=progress2` 推 `services/{p}/jars/{p}-temp.jar`(**临时名,不碰容器正挂载文件**;中断=temp 残留线上零影响)→ ② 大小校验(本/远一致才继续)→ ③ `mv` 原子改名(rename 瞬间完成)→ `ctl start + restart`(首次建容器/日常重启)→ 端口探活(失败自动 tail 服务器日志)。
- 前端链对称:构建(注意个别 app 脚本名例外)→ 推 `frontend/{p}-temp/` → 目录原子交换(旧→old、temp→{p}、清 old)→ 静态直出免重启。
- **非交互 shell 兜底(面板按钮必踩,实证)**:`export LANG="${LANG:-C.UTF-8}"`(空 LANG → mvn clean 删中文文件名失败)+ 工具链 PATH(~/tools/jdk、maven、.local/bin;面板不读 bashrc)。
- mvn 输出过滤成进度流(`Building xxx [n/N]` + BUILD 结果,`exit ${PIPESTATUS[0]}` 保真)。
- commands.yaml 按钮分组:**左右两列交错排**(左后端右前端,行内同平台对照;面板按 yaml 顺序填 2 列 grid);全量可用 `fast-deploy` 式一次 reactor 打包(依赖链只编一遍)+ 前端**逐平台串行构建**(多 filter 并行 vite gzip 插件时序不稳)。
- ⚠ rsync 远端路径**写绝对路径**(rsync 3.x 默认 protect-args,`$HOME` 字面量不展开)。
- ⚠ env_file 指向的宿主文件(如 /etc/<app>/app.env)属主必须是跑 compose 的用户(root:600 时 compose 读不了,容器全起不来)。

## 四、新项目接入 checklist

1. 服务器:装 docker+compose / 宿主 nginx;`ssh-copy-id` 装本地公钥;建 deploy 仓并推送。
2. 部署仓:infra 总 compose 起中间件(数据卷宿主目录);`services/{p}/` 目录化生成(compose+config+jars);共享 Dockerfile 构建基础镜像;管理脚本软链;nginx conf 实挂 sites-enabled + reload。
3. 兜底:env_file 存在(属主正确);`chmod o+x <用户家目录>`(nginx worker 要能穿越 home 读静态文件)。
4. 本地:deploy skill 脚本 + commands.yaml 按钮;首次点按钮全链验收(浏览器开 `http://<服务器>/{p}/`,路径与开发域名同构)。
5. 数据:业务库迁移;**老数据兼容脚本若 SELECT 同实例老库,记得把老库也搬过去**(Flyway 回灌类脚本的数据源)。

## 五、实证参考

- **demo-v2 → 241**(2026-09-20):后端 9/9、前端 7/9 全量;deploy-demo 仓(目录化全套);踩坑实录见 wiki《某公司/线上服务器241.md》§变更记录(rsync protect-args / LANG 空 / hikari×9 爆连接数 / vite 并行 / nginx home 穿越权 / Flyway 老库回灌)。
- 部署书:`demo-v2/.code-panel/prd/owner/plan/plan-22-伪代码/`(四件套 + 6 份流程 HTML)。
