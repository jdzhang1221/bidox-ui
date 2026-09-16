# BidOx UI · 前端管理后台

**BidOx（数牛智标）** 是面向招投标场景的 AI 写标书 SaaS 平台，业务主链路为：

> 招标文件理解 → 评分点拆解 → 企业知识匹配 → AI 标书生成 → 评分点审核

`bidox-ui` 是平台三端之一，承担 **Web 端管理后台** 职责，基于 [vue-vben-admin](https://github.com/vbenjs/vue-vben-admin) v5.7.0 二次开发。

> **当前阶段：平台底座 + 首批 BidOx 业务页面已上线**（企业知识库、文档解析、企业知识问答）。详见 [当前进展](#当前进展)。

## 技术栈

| 框架 | 说明 | 版本 |
| --- | --- | --- |
| [Vue](https://cn.vuejs.org/) | 前端框架 | 3.5.40 |
| [Vite](https://cn.vitejs.dev/) | 开发与构建工具 | 8.2.2 |
| [TypeScript](https://www.typescriptlang.org/) | JavaScript 超集 | 6.0.3 |
| [antdv-next](https://github.com/antdv-next/antdv-next) | UI 组件库（Ant Design Vue 的 Vue 3 重写版） | 1.5.2 |
| [Pinia](https://pinia.vuejs.org/) | 状态管理 | 4.0.2 |
| [Vue Router](https://router.vuejs.org/) | 路由 | 5.2.0 |
| [Vue I18n](https://vue-i18n.intlify.dev/) | 国际化 | 11.4.7 |
| [Tailwind CSS](https://tailwindcss.com/) | 原子化 CSS | 4.3.3 |
| [Iconify](https://icon-sets.iconify.design/) | 图标 | 5.0.1 |
| [Zod](https://zod.dev/) | 运行时校验 | 4.4.3 |
| [Vitest](https://vitest.dev/) | 单元测试 | - |
| [pnpm](https://pnpm.io/) + [Turborepo](https://turbo.build/) | 包管理 / 任务编排 | pnpm 11.16.0 / turbo 2.10.11 |

**环境要求**：Node `^22.18.0 || ^24.12.0`、pnpm `>= 11.0.0`。

## 目录结构

```
bidox-ui/                       # pnpm workspace + turbo monorepo
├── apps/                       # 应用目录
│   └── web-antdv-next/         # ★ 唯一应用（antdv-next UI 库）
├── packages/                   # 共享包
│   ├── @core/                  # 核心：base / composables / preferences / ui-kit
│   ├── effects/                # 业务组件（layouts / common-ui / plugins）
│   ├── constants/  icons/  locales/  preferences/  stores/  styles/  types/  utils/
├── internal/                   # 内部工具与 lint 配置（vite-config / lint-configs/* / tsconfig / ...）
├── docs/                       # VitePress 文档站（Vben 框架文档）
├── scripts/                    # 构建 / 发布脚本（vsh、turbo-run、deploy）
└── pnpm-workspace.yaml         # workspace 与依赖 catalog
```

`apps/web-antdv-next/src/` 下的业务代码：

```
src/
├── api/
│   ├── bid/                    # ★ BidOx 业务接口
│   │   ├── document/           #   文档管理（上传 / 解析 / 解析日志）
│   │   ├── knowledge-base/     #   知识库管理
│   │   └── knowledge-qa/       #   企业知识问答（含 SSE 流式）
│   ├── core/  infra/  system/  # 框架层接口
│   └── auth-session.ts         # ★ SSE 场景的登录态协调器
├── components/
│   └── markdown-view/          # ★ Markdown 渲染组件（问答回答展示）
├── router/routes/modules/      # dashboard.ts / infra.ts / system.ts
├── views/
│   ├── _core/                  # 登录 / 认证等无 Layout 页面
│   ├── bid/                    # ★ BidOx 业务页面
│   ├── dashboard/              # 首页
│   ├── infra/                  # 基础设施
│   └── system/                 # 系统管理
└── preferences.ts              # 应用级偏好覆盖（accessMode: 'backend' 等）
```

## 快速开始

### 1. 安装依赖

```bash
# 仓库根目录执行
pnpm install
```

> ⚠️ **若 `apps/*/node_modules` 缺失**，会出现 `vue-tsc` 报 `TS2688: Cannot find type definition file for '@vben/types/global'`、`vite build` 报 `[sass] Can't find stylesheet to import @vben/styles/global`。
> 此时根 `pnpm install --frozen-lockfile` 会**误报 "Already up to date" 且不补齐**，须用带 filter 的命令：
> ```bash
> pnpm install --filter @vben/web-antdv-next
> ```

### 2. 启动应用

```bash
pnpm dev:antdv-next    # 等价于 pnpm -F @vben/web-antdv-next run dev
```

访问 **http://localhost:5999/**，默认账号 **admin / admin123**。

> ⚠️ **不要用根目录的 `pnpm dev`**：它走 `turbo-run dev` 交互式选择器，在非交互终端（脚本 / CI）里会一直等待输入。请用 `pnpm dev:antdv-next`。

### 3. 后端对接

接口配置在 `apps/web-antdv-next/.env.development`，代理规则在 `apps/web-antdv-next/vite.config.ts`：

| 配置项 | 值 |
| --- | --- |
| `VITE_PORT` | `5999` |
| `VITE_BASE_URL` | `http://127.0.0.1:48080` |
| `VITE_GLOB_API_URL` | `/admin-api` |
| 代理规则 | `/admin-api` → `http://localhost:48080/admin-api`（`changeOrigin: true`，`ws: true`） |

因此启动前端前，需先启动后端 [`bidox-service`](../../backend/bidox-service)（端口 48080）；后端再调 AI 服务 [`bixox-ai`](../../ai-service/bixox-ai)（端口 8000）。

### 4. 验证链路

登录后访问 **企业知识 → 知识库管理**，能正常分页查询即表示 `登录 → 权限 → 业务接口` 三层全通。

## 应用清单

| 应用 | UI 库 | 开发端口 | views 文件数 | api 文件数 |
| --- | --- | --- | --- | --- |
| **`web-antdv-next`** | [antdv-next](https://github.com/antdv-next/antdv-next) 1.5.2 | **5999** | 235 | 51 |

应用标题为「数牛智标」。**这是当前唯一的应用**，业务模块（`views/bid`、`api/bid`）与框架页面全部集中于此。

> 历史上仓库内有 5 个并行实现的应用（`web-antd` / `web-antdv-next` / `web-ele` / `web-naive` / `web-tdesign`），分别是同一批页面针对不同 UI 库的克隆体。
> 现已收敛为 `web-antdv-next` 单应用，其余 4 个已删除（可从 git 历史找回）。

## 核心模块与接口

### BidOx 业务页面（`views/bid/`）

| 模块 | 路径 | 说明 |
| --- | --- | --- |
| 知识库管理 | `views/bid/knowledge-base/` | 知识库增删改查（`index.vue` + `data.ts` + `modules/form.vue`） |
| 文档管理 | `views/bid/document/` | 文档列表、上传、触发解析、查看解析日志（`modules/upload-modal.vue`、`modules/parse-log-drawer.vue`） |
| 企业知识问答 | `views/bid/knowledge-qa/` | 会话列表 + 消息流 + 引用溯源，SSE 流式输出（`components/*` 4 个、`composables/*` 3 个） |

### 后端接口对照（前缀 `/admin-api`）

| 前端 API 目录 | 后端接口 | 说明 |
| --- | --- | --- |
| `api/bid/knowledge-base` | `/bid/knowledge-base/*` | 知识库 CRUD + `simple-list` |
| `api/bid/document` | `/bid/document/*` | 上传 / 删除 / 分页 / `parse` 触发解析 / `parse-log/*` |
| `api/bid/knowledge-qa` | `/bid/knowledge-qa/*` | 会话与消息管理 + `POST /chat-stream`（SSE） |

### 两个容易踩的机制

1. **SSE 不走 axios**。`POST /bid/knowledge-qa/chat-stream` 用原生 `fetch` 发起（见 `api/bid/knowledge-qa/index.ts` 注释），因此**不会经过请求拦截器**；登录态由 `src/api/auth-session.ts` 单独协调。
2. **菜单与路由由后端下发**。`src/preferences.ts` 中 `accessMode: 'backend'`，菜单来自后端 `system_menu` 表：

   ```
   后端 GET /admin-api/system/auth/get-permission-info
           │
           ▼
   accessStore.accessMenus ──► src/router/access.ts
           │                    convertServerMenuToRouteRecordStringComponent()
           ▼
   按 component 路径在 src/views/**/*.vue 中匹配（componentKeys，见 router/routes/index.ts）
   ```

   **含义**：后端菜单里有什么，侧边栏就显示什么。`router/routes/modules/*.ts` 只被 eager 加载、**不参与菜单生成**。
   `bid` 页面因此**没有** route module，完全靠后端菜单的 component 路径匹配到 `views/bid/**`。

   目前后端菜单 = 系统管理 + 基础设施（198 条基线，见 `menu-cleanup-keep-system-base.sql`）+ BidOx 智能（15 条，id 5000-5303，见 `bidox-bid-menu.sql`）。

### 通用组件与测试

- `src/components/markdown-view/`：Markdown 渲染（`render.ts` + `markdown-view.vue`），用于问答回答展示。**注意其样式为非 scoped**（`v-html` 注入的节点拿不到 scoped 属性），修改时必须用主题变量而非硬编码色值。
- 单元测试 3 个文件：`views/bid/knowledge-qa/composables/__tests__/sse-stream.test.ts`、`views/bid/knowledge-qa/__tests__/citation.test.ts`、`components/markdown-view/__tests__/render.test.ts`。运行 `pnpm test:unit`（Vitest + happy-dom）。

## 当前进展

### ✅ 已完成

**1. 框架搭建与品牌本地化**

- 基于 vben-admin v5.7.0，pnpm workspace + turbo monorepo 结构完整，依赖可正常安装与启动
- 以 `web-antdv-next`（antdv-next）为唯一应用，应用标题改为「数牛智标」
- 后端对接：接口前缀 `/admin-api` 代理至 `bidox-service`(48080)，登录 + `get-permission-info` 链路已打通
- 清理用户可见的上游品牌与导流入口：
  - 首页「项目」卡片改为 BidOx 三端；「快捷入口」改为真实 `/system/*`、`/infra/*` 路由（原 `/mall` `/ai` `/erp` `/crm` `/iot` 全是死链）
  - `packages/effects/layouts/.../help/help.vue` 移除「软件外包」广告位与二维码
  - 删除 `packages/effects/common-ui/.../doc-link.vue`（登录页「萌新必读」，4 个入口全指向 `iocoder.cn`）
  - 当时 5 个 app 的 `preferences.ts` 页脚 `companySiteLink`、`.env` 的 `VITE_APP_NAMESPACE` 改为 `bidox-*`
  - 框架级 `VBEN_GITHUB_URL` / `VBEN_DOC_URL` 等常量由 yudao / iocoder 改回 Vben 官方地址
- 登录页精简：`packages/effects/common-ui/src/ui/authentication/login.vue` 移除未启用的第三方登录入口与死代码

**2. 存量残留收敛（按后端菜单）**

删除 16 个不可达模块的存量页面：

- `src/views/` 从 2358 → 216 个文件（**加回 `bid/` 后为 235**），仅保留 `_core` / `dashboard` / `infra` / `system` / `bid`（当时在 `web-antd` / `web-ele` / `web-antdv-next` 三端同构处理）
- 清理 `src/router/routes/modules/` 下 13 个静态路由模块 + `routes/external/pms.ts`
- 清理 `src/api/` 下 15 个业务接口目录（保留 `core` / `infra` / `system`，**加回 `bid/` 后共 51 个文件**）
- 删除 `src/store/mall/`；移除 `locales` 中已无引用的 `mp` 文案块
- 修复 `src/layouts/basic.vue` 对 `#/views/fms/...` 的失效 import

**3. 修复 3 类上游 API 迁移 bug**（均为上游变更未跟进所致，当时在 `web-antd` / `web-ele` / `web-antdv-next` 中同构存在）

| # | 位置 | 症状 | 修法 |
| --- | --- | --- | --- |
| 1 | `views/system/area/data.ts` | Zod 4 移除 `z.string().ip()`，运行时抛 `TypeError` | 改用 `z.union([z.ipv4(), z.ipv6()], { message })` |
| 2 | `views/system/dict/data.ts` | vben 5.7 起 `componentProps` 回调改收上下文对象，旧写法 `values.id` 恒为 `undefined`，「编辑时禁用字典类型」失效 | 改用 `({ rootValues }) => ...` |
| 3 | `dept` / `user` 的 `select-modal`、`social/user` 的 `detail` | `useVbenModal` 未传 data 泛型，`getData()` 被推断为 `{}` | 补 `useVbenModal<{...}>()` 泛型 |

修复后 `pnpm check:type` 全仓通过。

**4. BidOx 业务页面（首批）**

- **知识库管理**：知识库 CRUD + 简单列表
- **文档管理**：上传（前端校验 50MB 上限，与后端对齐）、触发解析、解析状态与解析日志抽屉
- **企业知识问答**：会话列表 / 消息流 / 引用溯源，SSE 流式输出（`sse-stream.ts` 手写解析 + `use-knowledge-qa-stream.ts` 编排）
- **基础设施**：`markdown-view` 渲染组件 + 3 个单元测试

**5. 应用收敛：5 端 → 单端**

原有 5 个应用是同一批页面的并行克隆体，维护成本高。已收敛为 `web-antdv-next` 单应用：

- **业务模块迁移**：`views/bid`（19 文件）、`api/bid`（3 文件）、`api/auth-session.ts`（545 行，SSE 与 axios 共用的单飞 token 刷新）、`components/markdown-view`（整体替换原死代码）迁入 `web-antdv-next`；包名 `ant-design-vue` → `antdv-next`（10 个文件）
- **删除 4 个应用**：`web-antd` / `web-ele` / `web-naive` / `web-tdesign`（共 1653 个受跟踪文件），`pnpm-lock.yaml` 同步剔除 4 个 importer
- **配套清理**：`package.json` 脚本、`.vscode/launch.json`、`.github/workflows/ci.yml` 中的对应条目
- **共享包与配置收敛**：删除 `packages/styles/src/{antd,ele,naive}` 三个已无引用的样式入口及其 `exports`；清理 `pnpm-workspace.yaml` 的 `catalog` 中 9 个零使用条目（`ant-design-vue`、`@form-create/ant-design-vue`、`element-plus`、`@form-create/element-ui`、`naive-ui`、`@form-create/naive-ui`、`tdesign-vue-next`、`@form-create/designer`、`unplugin-element-plus`），catalog 209 → 200 条
- **验证**：`vue-tsc` 0 错误、90/90 单测通过、`pnpm build:antdv-next` 生产构建 11/11 成功、Playwright 端到端 6/6 通过且控制台 0 错误（覆盖登录 → 知识库增删 → 文档列表 → 问答 SSE 流式 + 引用角标跳转）

> `antdv-next` 与 `ant-design-vue` 4.x 有两处 API 差异需注意：`notification({ message })` 改为 `notification({ title })`；表单 `rules: 'selectRequired'` 改为 `rules: 'required'`。

### ⬜ 未开始

- **招标项目 / 评分点页面**：招标文件理解、评分点拆解的界面
- **标书生成与审核页面**：生成进度、成文预览、Word 导出、评分点逐条审核
- **知识库与项目库的进阶能力**：文档分类管理、批量操作、企业事实层维护界面

## 已知问题

| 问题 | 影响 | 说明 |
| --- | --- | --- |
| **2 个既有单测失败** | `pnpm test:unit` 退出码非 0 | `packages/stores/src/modules/user.test.ts`（清空 userInfo 用例）与 `packages/effects/common-ui/src/components/tree/__tests__/tree.test.ts`（半选父节点去重用例）。与 BidOx 业务无关，属上游遗留，尚未修 |
| **`.env.production` 曾硬编码 localhost** | 生产构建后接口指向本机 | 已改为相对路径 `/admin-api`；正式部署仍需按环境注入 `VITE_BASE_URL` |
| **百度统计仍用上游 key** | 统计会打到上游账号 | `apps/web-antdv-next/.env` 的 `VITE_APP_BAIDU_CODE` 待替换或置空 |
| **文档站 `docs/` 仍是 Vben 框架文档** | 无 | 站点标题 / 描述 / 版权已改为 BidOx 口径，正文内容仍是 Vben 框架文档（对二次开发有参考价值） |
| **`helpers.ts` 保留一条上游 PR 链接** | 无 | `components/form-create/helpers.ts` 里的 `gitee.com/yudaocode/.../pulls/834`，属外部公开技术溯源，不影响产品 |
| **改 `internal/vite-config/src` 后必须重建** | 改动不生效 | 应用消费的是 `dist/index.mjs`，源码改动后需 `pnpm --filter @vben/vite-config run stub` |
| **pre-commit 钩子较重** | 提交慢 | `oxlint` / `oxfmt` / `eslint` / `stylelint` + 全量 `pnpm check:type`，需 `NODE_OPTIONS=--max-old-space-size=8192` 避免 OOM |
| **`pnpm build` 重跑前需清旧 `dist/`** | 报 `拒绝访问 os error 5` | 先 `mv` 走旧 `dist/` 再构建 |

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm dev:antdv-next` | 启动应用（5999） |
| `pnpm build:antdv-next` | 构建应用（产物 `apps/web-antdv-next/dist`，`VITE_ARCHIVER=true` 时另生成 `dist.zip`） |
| `pnpm build` | 构建全部（turbo） |
| `pnpm lint` | 代码检查（vsh） |
| `pnpm format` | 代码格式化 |
| `pnpm check:type` | 类型检查（turbo typecheck） |
| `pnpm test:unit` | 单元测试（Vitest） |
| `pnpm dev:docs` | 启动文档站 |

## 跨端契约

```
浏览器 ──► bidox-ui (5999)
              │  /admin-api  ──►  bidox-service (48080)  ──►  bixox-ai (8000)
              │                      Java：用户/租户/权限/文件/业务库
              │                      Python：解析/向量化/RAG/生成
              └  唯一认证入口：POST /admin-api/system/auth/login
```

- 前端**只与 `bidox-service` 通信**，不直连 AI 服务；AI 相关能力（解析、问答）全部经 Java 转发。
- 文件上传走**后端上传**（`VITE_UPLOAD_TYPE=server`），前端只提交 multipart，不直连对象存储。

## 相关项目

| 项目 | 路径 | 职责 | 端口 |
| --- | --- | --- | --- |
| **bidox-ui** | `frontend/bidox-ui` | 前端管理后台（本仓库） | 5999 |
| **bidox-service** | `backend/bidox-service` | Web 端管理后台服务（Java / Spring Boot） | 48080 |
| **bixox-ai** | `ai-service/bixox-ai` | AI 服务（FastAPI，解析 / 向量化 / RAG / 生成） | 8000 |

## 开源协议

基于 [vue-vben-admin](https://github.com/vbenjs/vue-vben-admin)（MIT License）二次开发，遵循 MIT License。上游版权声明见 [LICENSE](./LICENSE)。
