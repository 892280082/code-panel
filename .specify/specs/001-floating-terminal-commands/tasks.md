# 任务：浮动终端命令抽屉

**输入**：来自 `.specify/specs/001-floating-terminal-commands/` 的设计文档  
**先决条件**：plan.md, spec.md

## 阶段 1：后端基础

**目的**：命令数据存储和 API

- [ ] T001 [US2] 创建 `src/terminal/command-store.ts` — 命令 CRUD + JSON 持久化 + 系统预设命令
- [ ] T002 [US2] 创建 `src/routes/terminal.ts` — 终端命令 REST API（GET/POST/PUT/DELETE + reorder）
- [ ] T003 [US2] 修改 `src/server.ts` — 注册终端路由

## 阶段 2：前端 Store

**目的**：前端状态管理

- [ ] T004 [US1] 创建 `frontend/src/stores/terminal.ts` — 终端会话 Pinia store

## 阶段 3：前端组件

**目的**：UI 组件

- [ ] T005 [US1] 创建 `frontend/src/components/FloatingTerminal.vue` — 浮动终端 FAB 按钮 + 面板
- [ ] T006 [US1] 创建 `frontend/src/components/TerminalPanel.vue` — 多会话终端面板
- [ ] T007 [US2] 创建 `frontend/src/components/CommandDrawer.vue` — 命令抽屉（增删改 + 排序 + 执行）

## 阶段 4：全局集成

**目的**：组件挂载到应用

- [ ] T008 [US1] 修改 `frontend/src/App.vue` — 挂载 CommandDrawer + TerminalPanel
- [ ] T009 [ALL] 修改 `frontend/src/style.css` — 添加滚动条样式
