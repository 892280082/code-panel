# 实现计划：浮动终端命令抽屉

**分支**：`001-floating-terminal-commands` | **日期**：2026-07-30 | **规格**：[spec.md](spec.md)

## 概要

从 code-panel-demo 复刻浮动终端功能，包括：命令 CRUD + JSON 持久化、系统预设命令、浮动命令抽屉 UI、多终端会话面板。后端新增 command-store 和 API 路由，前端新增 Pinia store + 3 个组件，全局集成。

## 技术背景

**语言/版本**：TypeScript 5.5 (后端) + Vue 3.4 (前端)  
**主要依赖项**：Express 5 (后端), Vue 3 + Pinia + Vue Router (前端), Vite 5 (构建)  
**存储**：JSON 文件 (`data/terminal-commands.json`)  
**测试**：无（功能复刻，手动验证）  
**目标平台**：Web (桌面浏览器)  
**项目类型**：单体 Web 应用 (Express 后端 + Vue 前端)  

## 项目结构

### 文档（此功能）

```text
specs/001-floating-terminal-commands/
├── spec.md              # 功能规格
├── plan.md              # 本文件
├── checklists/
│   └── requirements.md  # 质量检查清单
└── tasks.md             # 任务列表
```

### 源代码变更

```text
src/
├── terminal/                      # [新增] 终端模块
│   └── command-store.ts           # 命令 CRUD + JSON 持久化
├── routes/
│   └── terminal.ts                # [新增] 终端 API 路由
└── server.ts                      # [修改] 注册终端路由

frontend/src/
├── stores/
│   └── terminal.ts                # [新增] 终端 Pinia store
├── components/
│   ├── CommandDrawer.vue          # [新增] 命令抽屉面板
│   ├── TerminalPanel.vue          # [新增] 终端会话面板
│   └── FloatingTerminal.vue       # [新增] 浮动终端 FAB
├── App.vue                        # [修改] 挂载全局终端组件
└── style.css                      # [修改] 添加滚动条样式
```

## 复杂度跟踪

无需 - 直接复刻参考项目，无额外复杂度。

## 实现策略

1. **后端优先**：先实现 command-store 和 API 路由，可独立测试
2. **前端紧随**：实现 Pinia store → CommandDrawer → TerminalPanel → FloatingTerminal → App.vue 集成
3. **增量验证**：每一步完成后手动验证
