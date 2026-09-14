# BidOx UI · 前端服务

**BidOx（数牛智标）** 是面向招投标场景的 AI 写标书 SaaS 平台，业务主链路为：

> 招标文件理解 → 评分点拆解 → 企业知识匹配 → AI 标书生成 → 评分点审核

`bidox-ui` 是平台的三端之一，承担 **前端（Web 端管理后台）** 职责，基于 [vue-vben-admin](https://github.com/vbenjs/vue-vben-admin) v5.7.0 二次开发。

> **当前阶段：前端框架就绪，BidOx 业务页面尚未开发。** 详见 [当前进展](#当前进展)。

## 技术栈

| 框架 | 说明 | 版本 |
| --- | --- | --- |
| [Vue](https://cn.vuejs.org/) | 前端框架 | 3.5.40 |
| [Vite](https://cn.vitejs.dev/) | 开发与构建工具 | 8.2.2 |
| [TypeScript](https://www.typescriptlang.org/) | JavaScript 超集 | 6.0.3 |
| [Ant Design Vue](https://www.antdv.com/) | UI 组件库（**主应用**） | 4.2.6 |
| [Element Plus](https://element-plus.org/zh-CN/) | UI 组件库（备选） | 2.14.3 |
| [Naive UI](https://www.naiveui.com/) | UI 组件库（备选） | 2.44.1 |
| [TDesign](https://tdesign.tencent.com/) | UI 组件库（备选） | 1.20.3 |
| [Pinia](https://pinia.vuejs.org/) | 状态管理 | 4.0.2 |
| [Vue Router](https://router.vuejs.org/) | 路由 | 5.2.0 |
| [Vue I18n](https://vue-i18n.intlify.dev/) | 国际化 | 11.4.7 |
| [Tailwind CSS](https://tailwindcss.com/) | 原子化 CSS | 4.3.3 |
| [Iconify](https://icon-sets.iconify.design/) | 图标 | 5.0.1 |
| [pnpm](https://pnpm.io/) + [Turborepo](https://turbo.build/) | 包管理 / 任务编排 | pnpm 11.16.0 |

**环境要求**：Node `^22.18.0 || ^24.12.0`、pnpm `>= 11.0.0`。

## 仓库结构

```
bidox-ui/                       # pnpm workspace + turbo monorepo
├── apps/                       # 各 UI 技术栈的应用（每个都能独立启动）
│   ├── web-antd/               # ★ 主应用（Ant Design Vue）
│   ├── web-antdv-next/         # Ant Design Vue Next 版本
│   ├── web-ele/                # Element Plus 版本
│   ├── web-naive/              # Naive UI 版本
│   └── web-tdesign/            # TDesign 版本
├── packages/                   # 共享包
│   ├── @core/                  # 核心：base / ui-kit / forward
│   ├── effects/                # 业务组件（layouts / common-ui / plugins）
│   ├── constants/  icons/  locales/  preferences/  stores/  styles/  types/  utils/
├── internal/                   # 内部工具与 lint 配置
├── docs/                       # VitePress 文档站
├── scripts/                    # 构建 / 发布脚本（vsh、turbo-run 等）
├── playground/                 # 组件调试场
└── pnpm-workspace.yaml         # workspace 与依赖 catalog
```

## 应用清单

| 应用 | UI 库 | 开发端口 | 说明 |
| --- | --- | --- | --- |
| **`web-antd`** | Ant Design Vue | **5666** | ★ 主应用，实际使用 |
| `web-ele` | Element Plus | 5777 | 备选 |
| `web-naive` | Naive UI | 5888 | 备选 |
| `web-antdv-next` | Ant Design Vue Next | 5999 | 备选 |
| `web-tdesign` | TDesign | 5999 | 备选 |

所有应用标题均为「数牛智标」。**当前只有 `web-antd` 在维护和使用**，其余为上游保留的备选模板（已按同一标准收敛：`web-antd` / `web-ele` / `web-antdv-next` 三个完整克隆体均清掉遗留页面，`web-naive` / `web-tdesign` 本身就很干净，未做删改）。

## 快速开始

```bash
# 1. 安装依赖（仓库根目录执行）
pnpm install

# 2. 启动主应用
pnpm dev:antd          # 等价于 pnpm -F @vben/web-antd run dev
```

启动后访问 **http://localhost:5666/**，默认账号 **admin / admin123**。

> ⚠️ **不要用根目录的 `pnpm dev`**：它走 `turbo-run dev` 交互式选择器，在非交互终端（脚本 / CI）里会一直等待输入。指定应用请用 `pnpm dev:antd` 或 `pnpm -F @vben/web-antd run dev`。

### 后端对接

主应用的接口配置在 `apps/web-antd/.env.development`，代理规则在 `apps/web-antd/vite.config.ts`：

| 配置项 | 值 |
| --- | --- |
| `VITE_PORT` | `5666` |
| `VITE_BASE_URL` | `http://127.0.0.1:48080` |
| `VITE_GLOB_API_URL` | `/admin-api` |
| 代理规则 | `/admin-api` → `http://localhost:48080/admin-api`（`changeOrigin: true`，`ws: true`） |

因此启动前端前，需要先启动后端 `bidox-service`（端口 48080）。

### 菜单与路由机制（重要）

前端 **不自带菜单**。`apps/web-antd/src/preferences.ts` 中 `accessMode: 'backend'`，菜单与路由由后端 `system_menu` 表下发：

```
后端 GET /admin-api/system/auth/get-permission-info
        │
        ▼
accessStore.accessMenus  ──►  src/router/access.ts
        │                      convertServerMenuToRouteRecordStringComponent()
        ▼
按 component 路径在 src/views/**/*.vue 中匹配页面组件
```

**含义**：后端菜单里有什么，侧边栏就显示什么。目前后端 `system_menu` 已精简至 198 条（仅「系统管理」+「基础设施」）。

`src/views/` 已按此收敛，只保留菜单可达的目录：

```
src/views/
├── _core/          # 登录 / 认证等无 Layout 页面
├── dashboard/      # 首页（概览 / 分析页 / 工作台）
├── infra/          # 基础设施
└── system/         # 系统管理
```

`src/router/routes/modules/` 下同样只保留 `dashboard.ts` / `infra.ts` / `system.ts`，在当前 `backend` 模式下不参与菜单生成（菜单以后端下发为准）。

## 当前进展

### ✅ 已完成

- **框架搭建**：基于 vben-admin v5.7.0，pnpm workspace + turbo monorepo 结构完整，依赖可正常安装与启动
- **主应用确定**：以 `web-antd`（Ant Design Vue）为唯一主应用，应用标题改为「数牛智标」
- **后端对接**：接口前缀 `/admin-api` 代理至 `bidox-service`(48080)，登录链路已打通（登录 + `get-permission-info` 均正常）
- **登录页精简**：`packages/effects/common-ui/src/ui/authentication/login.vue` 中移除未启用的第三方登录入口与死代码
- **存量残留清理**：按后端菜单（系统管理 + 基础设施）收敛前端代码，删除 16 个不可达模块的存量页面
  - `web-antd` 的 `src/views/` 从 **2358 → 216** 个文件，仅保留 `_core` / `dashboard` / `infra` / `system`；`web-ele`、`web-antdv-next` 同构处理（各 2357 / 2358 → 216）
  - 同步清理 `src/router/routes/modules/` 下 13 个静态路由模块 + `routes/external/pms.ts`
  - 同步清理 `src/api/` 下 15 个业务接口目录（保留 `core` / `infra` / `system`）
  - 删除 `src/store/mall/`（客服会话，`#/api/mall` 已随 api 目录移除）
  - 修复 `src/layouts/basic.vue` 对 `#/views/fms/...`（账套切换组件）的 import 与模板引用
  - 移除 `locales/langs/{zh-CN,en-US}/page.json` 中已无引用的 `mp` 文案块
- **修复 3 类遗留运行时 bug**（在 `系统管理` 在用页面中，均为上游 API 变更未跟进所致）：
  - `views/system/area/data.ts`：Zod 4 已移除 `z.string().ip()`，原写法运行时直接抛 `TypeError: z.string(...).ip is not a function`；改为 `z.union([z.ipv4(), z.ipv6()], { message })`
  - `views/system/dict/data.ts`：vben 5.7 起 `componentProps` 回调改传**上下文对象**（表单值在 `rootValues`），旧写法 `values.id` 恒为 `undefined`，导致「编辑时禁用字典类型」失效；改为 `({ rootValues }) => ...`
  - 3 个 Modal（`dept` / `user` 的 `select-modal`、`social/user` 的 `detail`）：`useVbenModal` 未传 data 泛型，`modalApi.getData()` 被推断为 `{}`；补上 `useVbenModal<{...}>()` 泛型

  上述 3 类 bug 在 `web-antd` / `web-ele` / `web-antdv-next` 中同构存在，均已修复。
- **清理用户可见的上游品牌与导流入口**：
  - `views/dashboard/workspace`：首页「项目」卡片原展示 6 个上游 GitHub 仓库，改为 BidOx 三端；
    「快捷入口」原指向 `/mall` `/ai` `/erp` `/crm` `/iot` —— **这些模块已随清理删除，全是死链**，
    改为系统管理 / 基础设施的真实路由（`/system/user`、`/infra/job` 等，路径取自后端 `system_menu`）；
    待办文案改为 BidOx 业务主链路
  - `packages/effects/layouts/src/widgets/help/help.vue`：移除「软件外包」广告位（含 `wx-xingyu.png` 二维码
    与 `shuduokeji.com` 外链），项目地址 / issues 改为 BidOx 仓库，文档改为 Vben 官方文档
  - 删除 `packages/effects/common-ui/src/ui/authentication/doc-link.vue`（登录页「萌新必读」，
    4 个入口全部指向 `iocoder.cn` 教程与外包咨询；该组件此前已被注释、未渲染）
  - 5 个 app 的 `preferences.ts` 页脚 `companySiteLink`、`.env` 的 `VITE_APP_NAMESPACE`
    由 `yudao-*` 改为 `bidox-*` / BidOx 仓库
  - `packages/@core/base/shared/src/constants/vben.ts`、`internal/vite-config` 的框架级
    `VBEN_GITHUB_URL` / `VBEN_DOC_URL` / 控制台 Docs 链接，由 yudao / iocoder 改回 Vben 官方地址
  - 删除 5 个 app `public/wx-xingyu.png` 与上游 Gitee 遗留目录 `.gitee/`
- **代码注释署名统一**：**67 处** `add by 芋艿` / `TODO @芋艿` 改为 `bidox`（与上一轮 `@author 芋道源码 → @author bidox` 口径一致）；
  另把注释正文中 18 处 `yudao` 改为中性表述（「yudao-vue-pro 标准返回」→「后端标准返回」、
  「由于 yudao 是 fetchUserInfo…」→「由于后端是…」、`yudao-ui-admin-vben issue` → `upstream vben issue`）

  修复后 **`pnpm check:type` 全仓通过（5 个 app 全部 0 错误）**，提交钩子不再需要 `--no-verify`。

### ⬜ 未开始

- **BidOx 业务页面**：当前无任何招投标业务页面（招标项目、评分点、标书生成、审核等均未开发），`src/api/` 与 `src/views/` 下无 BidOx 业务代码
- **知识库 / 项目库页面**：企业知识匹配相关界面待建
- **AI 交互界面**：与 `bixox-ai` 服务对接的解析进度、生成结果、证据溯源等界面待建

### ⚠️ 待处理

- **业务页面的上游文档外链仍未处理**：`views/infra`、`views/system` 等业务页面里还有 **242 处 / 168 个文件**的 `<DocAlert url="https://doc.iocoder.cn/...">`（系统日志、代码生成等功能说明）。BidOx 目前没有文档站，改成什么是产品决策，暂未动。
- **`web-ele` 的商城死配置**：`apps/web-ele/.env.development` / `.env.production` 中 `VITE_MALL_H5_DOMAIN='http://mall.yudao.iocoder.cn'` 已无任何代码引用（商城模块已删），可删未删。
- **`helpers.ts` 里的上游 PR 链接**：`components/form-create/helpers.ts` 保留了一条 `gitee.com/yudaocode/.../pulls/834` 的技术溯源链接，属外部公开 PR、不影响产品，暂未动。
- **⚠️ 依赖安装的坑**：若 `apps/*/node_modules` 缺失，会出现 `vue-tsc` 报 `TS2688: Cannot find type definition file for '@vben/types/global'`、`vite build` 报 `[sass] Can't find stylesheet to import @vben/styles/global`。**根 `pnpm install --frozen-lockfile` 会误报 "Already up to date" 且不补齐**，须用 `pnpm install --filter @vben/web-antd` 这类带 filter 的命令才会真正生成 app 级 `node_modules`。
- **改 `internal/vite-config/src` 后必须重建**：应用消费的是 `dist/index.mjs`，源码改动后需 `pnpm --filter @vben/vite-config run stub` 才会生效。
- **pre-commit 钩子较重**：`oxlint` / `oxfmt` / `eslint` / `stylelint` + 全量 `pnpm check:type`，需 `NODE_OPTIONS=--max-old-space-size=8192` 避免 OOM。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm dev:antd` | 启动主应用（5666） |
| `pnpm dev:ele` / `dev:naive` / `dev:tdesign` | 启动其他备选应用 |
| `pnpm build:antd` | 构建主应用 |
| `pnpm build` | 构建全部（turbo） |
| `pnpm lint` | 代码检查（vsh） |
| `pnpm format` | 代码格式化 |
| `pnpm check:type` | 类型检查（turbo typecheck） |
| `pnpm test:unit` | 单元测试（vitest） |
| `pnpm dev:docs` | 启动文档站 |

## 相关项目

| 项目 | 路径 | 职责 | 端口 |
| --- | --- | --- | --- |
| **bidox-ui** | `frontend/bidox-ui` | 前端管理后台（本仓库） | 5666 |
| **bidox-service** | `backend/bidox-service` | Web 端管理后台服务（Java / Spring Boot） | 48080 |
| **bixox-ai** | `ai-service/bixox-ai` | AI 服务（FastAPI，解析 / 向量化 / RAG / 生成） | 8000 |

## 开源协议

基于 [vue-vben-admin](https://github.com/vbenjs/vue-vben-admin)（MIT License）二次开发。
