---
id: PLAN-FNOS-008
title: PLAN-FNOS-008 插件配置统一迁入插件管理页
description: 实施 FNOS-008 的插件配置界面迁移，并补齐 CodeBuddy 在 DSH Desktop 中的 Host/Client 兼容。
status: planned
owner: tnnevol
planDate: 2026-09-28
targetVersion: 5.6.0
lastVerified: 2026-09-28
---

# PLAN-FNOS-008 插件配置统一迁入插件管理页

| 字段 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-008 |
| 计划日期 | 2026-09-28 |
| 对应需求 | [FNOS-008 插件配置统一迁入插件管理页](/requirements/FNOS-008-plugin-config-in-plugin-manager) |
| 本轮功能 | FNOS-008-01 至 FNOS-008-06 全部进入本轮实施 |
| 上游依据 | 本地 Harness checkout `dsh-v0.1.7-rc.2`（`~/workspace/fork-pj/deepseek-harness`，与依赖版本一致）；官方架构决策「插件页上的插件配置」（2026-09-16）与「设置页作为伴生包」（2026-09-17） |
| 计划状态 | <Badge type="info" text="规划中" /> |

## 计划目标

把三个插件（`dsh-fnos`、`dsh-codebuddy`、`dsh-codex-auth`）的配置界面从设置弹框迁入插件管理页的组合包详情页，并让 CodeBuddy 在 DSH Desktop 中通过独立的 Host/Client 传输适配继续可用，实现 FNOS-008-01 至 FNOS-008-06。配置数据的存储、写入路径和用户数据保持不变；迁移完成后设置弹框不再承载任何插件配置。

## 当前实现与目标设计

### 当前 → 目标

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| fnOS 配置入口 | `settings.plugins.tab` 标签页（设置 → 插件 → 授权目录） | `plugins.bundle.config`（key `@tnnevol/dsh-fnos`，插件详情页配置区块） | 组件 props 类型、注册键、契约测试与文档更新；数据读写零改动 |
| CodeBuddy 配置入口 | `settings.section` 导航分区（id `codebuddy`，order 25） | `plugins.bundle.config`（key `@tnnevol/dsh-codebuddy`） | 组件适配详情页容器；`close` 语义改为空操作；数据读写零改动 |
| Codex Auth 配置入口 | `settings.section` 导航分区（id `codex-auth`，order 24） | `plugins.bundle.config`（key `@tnnevol/dsh-codex-auth`） | 同上 |
| 设置弹框插件分区 | 官方只读清单 + fnOS 标签页 + 两个导航分区 | 仅官方只读清单 | 三个注册移除后自动生效，无独立改动 |
| 配置数据 | `dsh-fnos` 命名空间（ConfigForms）、CodeBuddy localStorage/Host RPC、Codex settings 写入 | 不变 | 无数据迁移 |
| CodeBuddy 客户端传输 | Web/fnOS 通过 HTTP/RPC，Desktop 无独立适配 | Desktop 使用 Remote/外部打开适配器，Web/fnOS bridge 保留 | Host 业务、凭据和上游行为指纹不变；增加 Desktop 契约、错误和生命周期验证 |

### 迁移状态图

```mermaid
stateDiagram-v2
    [*] --> SettingsTab: 当前：settings.plugins.tab / settings.section
    SettingsTab --> BundleConfig: 变更点：注册迁入 plugins.bundle.config（T02/T03/T04）
    BundleConfig --> [*]
    note right of BundleConfig
        回退：恢复原 slot 注册即可回到设置弹框呈现
        数据层不动，回退无数据风险
    end note
```

### 迁移时序（以 fnOS 为例，三个插件同构）

```mermaid
sequenceDiagram
    participant User as 用户
    participant Page as 插件管理页
    participant Slot as plugins.bundle.config 条目
    participant Card as 配置组件
    participant Host as Host/网关
    User->>Page: 打开侧栏「插件」→ fnOS 详情页
    Page->>Slot: renderSlot(view: page, entryKey: 包名)
    Slot->>Card: 渲染配置区块（变更点：容器从设置弹框换为详情页）
    Card->>Host: fetch 网关路由 / RPC / settings 写入（不变）
    Host-->>Card: 返回数据，保存失败保留原值
```

变更点说明：只重新编排配置界面的挂载容器与入口；组件到 Host 的数据交互（网关路由、RPC、settings 写入）全部保持原路径。

## 影响范围分析

| 需求功能 | 代码模块 | 配置/数据 | 测试 | 文档 | 目标环境 |
| --- | --- | --- | --- | --- | --- |
| FNOS-008-01 | `plugins/dsh-fnos-plugin`（client 注册、授权目录卡片） | 无迁移 | 契约测试、卡片行为测试 | `docs/plugins/dsh-fnos.md` | DSH Web、真实 NAS |
| FNOS-008-02 | `plugins/dsh-codebuddy-plugin`（client 注册、CodeBuddySection） | 无迁移 | 现有组件测试回归 | `docs/plugins/dsh-codebuddy.md` | DSH Web、DSH Desktop |
| FNOS-008-03 | `plugins/dsh-codex-auth-plugin`（client 注册、CodexAuthSection） | 无迁移 | 现有组件测试回归 | `docs/plugins/dsh-codex-auth.md` | DSH Web、DSH Desktop |
| FNOS-008-04 | 由上面三项注册移除自动达成 | 无 | 契约测试断言更新 | 需求/计划/索引 | DSH Web、DSH Desktop |
| FNOS-008-05 | 无（数据层不动） | 既有配置数据保持 | 按插件升级前后数据对照 | — | fnOS 授权目录：真实 NAS；其他插件：DSH Web、DSH Desktop |
| FNOS-008-06 | `plugins/dsh-codebuddy-plugin` Host/Client、Remote 与 Web bridge | 既有凭据、偏好、任务状态保持 | Desktop transport、OAuth opener、生命周期和 Web 回归 | `docs/plugins/dsh-codebuddy.md`、验证证据 | DSH Web、DSH Desktop |
| FNOS-008-07 | `plugins/dsh-codex-auth-plugin` Client 登录开窗与取消 | 既有 OAuth 凭据、设置不变 | 登录 `null` 开窗、取消、复制与回归 | `docs/plugins/dsh-codex-auth.md`、验证证据 | DSH Web、DSH Desktop |

不涉及：应用 manifest、wizard、`cmd/` 脚本、网关、FPK 构建门禁、`published-dsh-plugins.json`。

## 源文件与生成产物边界

| 边界 | 内容 |
| --- | --- |
| 允许修改 | 三个插件的 `src/client/index.ts(x)`、对应配置组件、CodeBuddy `src/host`/`src/contracts` 与三插件 `package.json`（如需补依赖）、`plugins/*/tests`、`docs/plugins/*.md`、需求/计划/索引文档 |
| 禁止修改 | 上游 checkout；DSH Host/Client 运行时；网关脚本；`pnpm-workspace.yaml` catalog 之外的依赖策略（如需新增 `@deepseek-ai/dsh-client-ui-plugin-manager` 依赖，加入 `catalogs.dsh`，版本 `0.1.7-rc.2`） |
| 构建产物 | 三插件 `lib/`（构建输出，不入库）；FPK 不受影响（插件经 registry 拉取） |

## 技术迁移设计

### 上游接缝事实（已核实）

- 插件管理页（`ui-plugin-manager`）在 `main` 面板下声明 `plugins.bundle.config`（keyed，scope root），owner props 为 `PluginConfigViewProps`：`view: 'summary' | 'page'` 与可选 `form`；bundle 配置仅以 `view: 'page'` 渲染在详情页描述与组件列表之间（`data-plugin-config` 区块），渲染条件是该包名有注册条目（config ledger）。
- 社区 bundle 官方范式：`ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name, key: '<包名>', locale, inject }, 组件))`（上游 voice-input 示例）。
- slot 类型通过 type-only 引入 `@deepseek-ai/dsh-client-ui-plugin-manager/client`（上游 `ui-settings-shell` 同样以 devDependencies 持有该包）；`PropsRuntime` 泛型来自 `@deepseek-ai/dsh-client-ui-slots`。
- `form`（`ConfigPageForm`：`state` + `mutate`）仅在页面接了 settings 命名空间时才有意义；三个插件的配置组件均为自管理状态（fnOS 走网关路由，CodeBuddy 走 RPC + localStorage，Codex Auth 走 settings 写入 RPC），`form` 保持 `undefined`，组件忽略该 prop。
- 浏览器半侧挂载规则：组合包 patch 以裸包名为说明符的根行携带 client 半侧；三个插件均为 `- insert: id/name` 根行，符合条件。插件管理页的已安装分组来自 profile 的用户层插件（`BUILTIN_PROFILE_BUNDLES` 排除的正是 base 等内置行），三个插件会出现并带配置区块。

### 方案选择

**选择：统一迁入 `plugins.bundle.config`。**

- 被否决：CodeBuddy/Codex Auth 迁入 `plugins.item`。该 slot 官方注释标注 OCCUPIED by official settings pages，第三方插件占用与官方归属规则冲突。
- 被否决：保留设置弹框注册形成双入口。官方 ADR 已否决双入口方案，两处状态会漂移；FNOS-008-04 也要求设置侧不再有插件配置入口。
- 被否决：改用 `plugins.row.config`。三个插件的配置对象是组合包整体而非某一行。

### 各插件迁移要点

**dsh-fnos（FNOS-008-01）**

- `src/client/index.ts`：`settings.plugins.tab` 注册（id `dsh-fnos-authorized-directories`，order 100）替换为 `plugins.bundle.config` 注册（key `@tnnevol/dsh-fnos`）。无 `order` 字段需求；label 不再用于导航，卡片标题由组件自带。
- `AuthorizedDirectoriesCard.tsx`：props 类型 `PropsRuntime<'settings.plugins.tab'>` 改为 `PropsRuntime<'plugins.bundle.config'>`（组件忽略 `form`/`view`，只按 page 语义渲染）；卡片结构不变。
- 契约测试 `tests/contracts/package-contract.spec.ts` 与 `tests/client/settings-migration.spec.ts` 的 slot 断言同步更新；`dsh.client.inject` 类型清单补 `@deepseek-ai/dsh-client-ui-plugin-manager`。
- 保留不动：`settings.action`「打开配置文件」、主题桥、输入引用、侧栏动作、iframe 会话头部动作。

**dsh-codebuddy（FNOS-008-02）**

- `src/client/index.tsx`：`settings.section` 注册（id `codebuddy`，order 25）替换为 `plugins.bundle.config`（key `@tnnevol/dsh-codebuddy`）。
- `CodeBuddySection.tsx`：适配详情页容器。要点：
  - `close` 在设置弹框里关闭整个弹框；详情页无弹框语义，改为空操作（保留可选 prop 兼容现有调用点）。
  - 自有滚动：区块在设置弹框中依赖弹框内容区滚动；详情页区块高度不受限，组件根节点需要自身最大高度与滚动（参考现组件在设置页的高度约束写法）。
  - 标题：`settings.section` 的 `label` 不复存在，组件内部已有的「CodeBuddy」标题/区块头保留。
- 全页面账号管理面板（`shell.overlay` hash 路由）与对话输入区用量指示器不动；`panelRoute.open('accounts')` 的入口从详情页区块进入。
- 现有测试以组件行为为主，逐个跑通即可；`close` 语义变化不涉及断言（`close?.()` 调用点保留）。

**CodeBuddy Desktop 兼容（FNOS-008-06）**

**已在 `dsh-0.1.7-rc.2` 源码核实的事实（`apps/desktop`、`packages/client/modules`）：**

- Desktop 是 Electron 壳，加载打包内同一套 Web 前端（`dsh-app://app/`），profile 使用 `PROFILE_TEMPLATES.web`（含 `dsh-host-webserver`）。
- 该源下非静态请求由 `forwardWebRequest()` 整体转发到同一个 Host，并由壳注入 Host Cookie 并删除 origin/sec-fetch-site；Host 信任栅栏对 loopback + 无 origin 放行。因此插件的 `/codebuddy` RPC、`/api`、Remote WebSocket、`/plugins/*` bundle 在 Desktop 下照常可用。
- `dsh.client.platform` 只接受 `web`（`decl.platform !== 'web'` 即跳过插件）；Desktop 复用该载体，**不得**改成 desktop/electron。
- 壳在主窗口安装 `setWindowOpenHandler`：http/https 调 `shell.openExternal(url)` 后返回 `{ action: 'deny' }`，`window.open` 因此返回 `null`。该 `null` 是「已外部打开」，不是「被拦截」。

**因此 Desktop 适配的实现边界（纠正先前误判）：**

- **不新增** CodeBuddy Remote facade 或第二套客户端传输层；`webServer` 仍是既有 web 组合的组成部分，不是 Desktop 阻塞点。
- 收口开窗：新增 `src/client/external-opener.ts` 的 `openAuthUrl()`，三个登录入口（设置区块添加账号、设置区块重新登录、后台面板添加账号）统一调用；不检查 `window.open` 返回值，并吞掉开窗异常，避免未处理异常触发宿主 fail-loud。
- 登录结果仍以宿主 `pollLogin` 为准；开窗失败不阻断登录流程。
- Desktop 适配不修改 CodeBuddy 上游请求中的 `x-client-platform`、UA、来源头和行为上报口径；Web/fnOS 行为保持不变。

**dsh-codex-auth（FNOS-008-03）**

- `src/client/index.tsx`：`settings.section` 注册（id `codex-auth`，order 24）替换为 `plugins.bundle.config`（key `@tnnevol/dsh-codex-auth`）。
- `CodexAuthSection.tsx`：适配详情页容器，要点同 CodeBuddy（无 `close` 依赖，标题自带）。
- 对话输入区用量状态（`conversation.input.right`）不动。

**Codex Auth Desktop 兼容（FNOS-008-07）**

先经源码核实，确认它是**功能性阻断**而非可选优化：

- `CodexAuthSection.signIn()` 先 `window.open(CODEX_AUTH_VERIFICATION_URI, '_blank')`，随后 `if (popup === null) { setStatus({ status: 'error', message: t('popupBlocked') }); return }`。Desktop 壳对 http/https 一律返回 `{ action: 'deny' }`，因此 `popup` **必为 `null`**：授权页确实已在系统浏览器打开，但函数在此返回，紧随其后的 `POST …/auth/login`（请求设备码）**永不发出**，用户看到的是「浏览器阻止了登录窗口」。即 Desktop 下 Codex Auth 完全无法登录。
- 第二处 `window.open(challenge.verificationUri, '_blank')` 同样在 `null` 时 `return`；此处不阻断流程，仅丢失窗口句柄，表现为「取消时关不掉授权窗口」。
- 已核实**无缺口**的路径：`/plugins/dsh-codex-auth-plugin/auth/*` 与 CodeBuddy 的 `/codebuddy` 同类，由壳 `forwardWebRequest()` 转发并注入 Cookie；`trustedRequest()` 在无 origin 时回落到 `localPeer(req)`，Desktop 转发来自 loopback 故放行；剪贴板权限在 `microphone-permissions.ts` 中对非 `media` 权限返回 `true`，Semi `copyable` 可用。

实现边界（沿用 FNOS-008-06 已确立的 Desktop 结论，不新增传输层）：

- 开窗收口为单一实现：`null` 表示「壳已交给系统浏览器打开」，**不**作为失败；`signIn()` 在 `null` 时继续请求设备码并把状态推进到「等待授权」。
- 第二处开窗在 `null` 时静默跳过 `add(opened)`，不再提前 `return`；句柄不可得只影响「取消时一并关窗」，不影响取消本身与已登录账号。
- 不检查返回值、吞掉开窗异常，避免客户端未处理异常触发宿主 fail-loud；登录结果仍以宿主授权状态为准。
- 保留既有语义：授权码由用户点击 Semi `copyable` 复制（`signIn()` 内不得自动复制）、取消走独立 `cancel` 端点而非 `logout`、关窗不等于放弃。
- 不修改 `/plugins/…` 路由契约、`trustedRequest` 判定、`dsh.client.platform: web` 或上游 OpenAI 交互流程。

**设置弹框最终形态（FNOS-008-04）**

- 三个注册移除后，「设置 → 插件」只剩官方清单标签页；官方内置配置页在侧栏插件页，不受影响。
- fnOS iframe 下的 `settings.action`「打开配置文件」属于设置弹框头部动作，保留。

## 分阶段任务

### 阶段一：dsh-fnos 迁移（T01–T03）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-008-T01-01 | FNOS-008-01 / AC-01–03 | 补充插件类型依赖：`package.json` 增加 `@deepseek-ai/dsh-client-ui-plugin-manager: catalog:dsh`（并在 `pnpm-workspace.yaml` 的 `catalogs.dsh` 登记 `0.1.7-rc.2`）；client 注册从 `settings.plugins.tab` 换为 **`plugins.detail.section`**（list 座位：用 `id` 而非 key、不声明 `inject`、按 `subject` 自筛包名）；卡片 props 类型从 `PropsRuntime<'settings.plugins.tab'>` 改为独立 props | 无 | 插件构建通过；本地 `dsh web` 详情页「包含的组件」**之后**出现授权目录区块 |
| PLAN-FNOS-008-T01-02 | FNOS-008-01 / AC-01–02 | 卡片行为适配与回归：确认添加/删除/刷新/保存失败保护在详情页容器中不变 | T01-01 | 插件单测 + 本地交互走查 |
| PLAN-FNOS-008-T01-03 | FNOS-008-01-AC-03、FNOS-008-04-AC-01 | 契约测试更新：`package-contract.spec.ts`、`settings-migration.spec.ts` 的 slot 与 inject 断言改为 `plugins.detail.section`；补 subject 自筛用例（list 座位不筛会串到别的插件详情页） | T01-01 | `pnpm --filter @tnnevol/dsh-fnos test`（或对应 vitest 过滤）通过 |

### 阶段二：CodeBuddy 迁移与 Desktop 适配（T02-01–T02-06）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-008-T02-01 | FNOS-008-02 / AC-01 | 注册迁移：`settings.section` → `plugins.bundle.config`（key `@tnnevol/dsh-codebuddy`）；类型依赖与 inject 清单同 T01-01 | 无 | 插件构建通过 |
| PLAN-FNOS-008-T02-02 | FNOS-008-02 / AC-01–02 | 容器适配：`close` 空操作、根节点滚动约束、账号管理面板入口回归 | T02-01 | 现有组件测试全绿 + 本地交互走查（登录弹窗、面板打开） |
| PLAN-FNOS-008-T02-03 | FNOS-008-02-AC-03、FNOS-008-04-AC-01 | 设置侧栏无 CodeBuddy 分区的断言与回归 | T02-01 | 测试通过；设置弹框走查 |
| PLAN-FNOS-008-T02-04 | FNOS-008-06 / AC-01、AC-03–05 | 核实 Desktop 运行契约：Electron 壳复用 web 客户端载体与同一 Host，`/codebuddy` RPC、`/api`、Remote WebSocket 与 `/plugins/*` 由壳转发并注入 Cookie；据此确认不需要新增 Remote facade，并补契约测试锁定 `dsh.client.platform: web` | T02-01 | 目标运行时源码核实 + 契约测试失败后转绿 |
| PLAN-FNOS-008-T02-05 | FNOS-008-06 / AC-03–04、AC-06–07 | 收口 OAuth 开窗语义：三个登录入口统一走 `openAuthUrl`，不解读 `window.open` 返回值（Desktop 返回 `null` 但仍已外部打开），开窗异常不得逃逸 | T02-04 | 开窗行为测试 + 组合级回归 |
| PLAN-FNOS-008-T02-06 | FNOS-008-06 / AC-02、AC-05 | 组合级验证 Desktop 等价路径：真实 Host 下 `/codebuddy` RPC 与客户端 bundle 可用，账号/用量/成长任务读写一致 | T02-05 | 真实 profile + HTTP/RPC 端到端证据 |

### 阶段三：Codex Auth 迁移与 Desktop 兼容（T03-01–T03-04）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-008-T03-01 | FNOS-008-03 / AC-01 | 注册迁移与类型依赖：`settings.section`（id `codex-auth`、order 24）→ `plugins.bundle.config`（key `@tnnevol/dsh-codex-auth`）；补 `@deepseek-ai/dsh-client-ui-plugin-manager` 的 catalog 条目、peer/dev 依赖与 `dsh.client.inject`；客户端仅 type-only 引入该包 | 无 | 插件构建通过；`lib/client.js` 含新注册且不含 `settings.section` |
| PLAN-FNOS-008-T03-02 | FNOS-008-03-AC-02、FNOS-008-04-AC-01 | 容器适配与断言：确认组件无设置弹框的视口/滚动耦合（详情页为普通纵向 flex、页面整体滚动），补布局回归；契约断言改为详情页注册并移除设置侧分区 | T03-01 | 测试通过；组合级确认 Codex 条目在插件清单中且 `enabled` |
| PLAN-FNOS-008-T03-03 | FNOS-008-07 / AC-01–03、AC-06 | 修复 Desktop 登录阻断：`signIn()` 不再把 `window.open` 的 `null` 判为「弹窗被拦截」；开窗收口为单一实现并吞掉异常，`null` 时继续请求设备码；同步修正 `popupBlocked` 文案适用条件 | T02-04（共用 Desktop 契约） | 新增强制性行为测试（`null` 仍继续请求 login）+ 现有授权窗测试同步更新 |
| PLAN-FNOS-008-T03-04 | FNOS-008-07 / AC-04–05、AC-07 | 授权窗口句柄可选化：句柄不可得时仅失去「取消时关窗」，不影响取消与已登录账号；回归独立浏览器与 fnOS 行为 | T03-03 | 取消/复制/回归测试；`dsh.client.platform` 契约断言 |
| PLAN-FNOS-008-T03-05 | FNOS-008-06 / AC-02–03、FNOS-008-07 / AC-06 | Desktop 安装后激活失败修复：客户端 `inject` 补 `remote.llm`，并让模型目录桥接在命名空间不可解析时降级为 no-op（未声明的 `remote.<ns>` 读取在 Cordis 代理上会抛错，原先会拖垮整个客户端条目，导致详情页无配置区）；补「源码中每个 `remote.<ns>` 访问都已在 `inject` 声明」的契约测试 | T03-01、T03-02 | 应用真实前端无头渲染加载探针 profile：激活告警 0 条且 `[data-plugin-config]` 渲染出配置区；新增回归测试通过 |
| PLAN-FNOS-008-T03-06 | FNOS-008-07 / AC-06 | 模型弹框旧数据修复：`remote.llm.discoverModels` 由 `RemoteNamespaceService.install()` 以**只有 getter、没有 setter** 的访问器安装，原先的 `llm.discoverModels = bridged` 赋值被静默丢弃，桥接从未生效而回落到适配器构建期快照；改为 `Object.defineProperty` 覆盖并读回校验，失败即 fail closed，dispose 还原原 descriptor | T03-05 | A/B 端到端：同一 profile 下弹框模型列表从构建期快照（`gpt-5.4*`）变为账号目录；新增「覆盖 getter-only 访问器」回归测试 |
| PLAN-FNOS-008-T03-07 | FNOS-008-06 / AC-02–03 | 运行时启用报 `webServer` 定位（上游缺陷，本仓库仅规避与上报）：`connection.rpc.handle()` 经 `get rpc() { const owner = this.ctx }` 取 **connection 服务自身的 ctx**，其 `inject` 在光纤激活时固化；`dsh-web-app` 把该行声明为 `inject: [webRuntime]`，补 `webServer` 的补丁来自 CodeBuddy 自己的 bundle 层，而**运行时 reload 只更新合成树，不会给已 active 的光纤补依赖**，因此「应用内启用」必然失败，重启才恢复。实测插件侧重试（20 次/30 秒）与追加 reload 均无效 | T03-05 | 以客户端实际 RPC `setBundleEnabled` 复现 `application:"failed"` + 帧级一致堆栈；插桩对比冷启动（`inject=["webRuntime","webServer"]`，告警 0、`POST /codebuddy/status` 返回合法信封）与运行时启用（reload 后组合树正确但旧光纤仍抛错）；重启后实机由 405 恢复 |

### 阶段七：CodeBuddy 面板内联与配置合并（T07-01–T07-08）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-008-T07-01 | FNOS-008-02 / AC-01–03 | 注册迁移：删 `settings.section`（id `codebuddy`）与 `shell.overlay`（id `codebuddy-panel`）两处注册，改挂 `plugins.bundle.config`（key `@tnnevol/dsh-codebuddy`）；删除 `PanelRouteController`、`panel-route.ts`、hash 前缀匹配与 `panel.install()` effect。客户端不再需要 `'slots'` 以外的 shell.overlay 字符串键强转 | 无 | 构建通过；`lib/client.js` 含 `plugins.bundle.config` 且不含 `shell.overlay` / `settings.section` / `#/codebuddy` |
| PLAN-FNOS-008-T07-02 | FNOS-008-02 / AC-02 | 内容内联：`panel.tsx` 的 `AccountsPage` 与 `TokenStatsPage` 去掉 `DshLayout`/`DshNav`/返回栏/页标题后作为详情页内的两个分区；删除 `visited` 延迟挂载 keep-alive（详情页切走即卸载）；Token 统计区块可折叠 | T07-01 | 组件测试：详情页渲染出两个分区、无 `DshNav`；卸载后重挂载仍从 store 恢复 |
| PLAN-FNOS-008-T07-03 | FNOS-008-02 / AC-02 | 保留项适配：增长任务整套（列表/完成任务/一键完成/执行日志/查看日志）、三个自动开关、账号卡片签到与旅行状态、积分总览全部保留在详情页；`useAutoPrefs` 的 host 采纳仍在挂载时执行，详情页卸载重挂不重复采纳 | T07-02 | 现有 growth/auto/checkin/travel 测试全绿；新增详情页内四块存在性断言 |
| PLAN-FNOS-008-T07-04 | FNOS-008-02 / AC-03 | 设置区块移除与控件迁移：`CodeBuddySection` 的登录/账号列表/开关不再渲染；「切换阈值」（`$autoSwitchThreshold`）与「显示余额余量」（`$showUsage`）作为独立小区块迁入详情页，读写仍走既有 store 与 host RPC | T07-02 | 新增控件测试：改阈值写入 store 且发 `autoSwitch` RPC；旧「管理面板」入口与 `nav`/`back`/`managePanel` 文案不再被引用 |
| PLAN-FNOS-008-T07-05 | FNOS-008-02 / AC-04、FNOS-008-05 / AC-01、AC-04 | 配置合并：`codebuddy-auth.json` 扩为单一文档（`version: 2`：`activeId`/`accounts`/`prefs`/`growthRun`）；4 个路径 getter 收敛；`growthRun` 改用 storage 的同一 `mutationQueue`（两个模块原本各持一个队列却写同一目录）；新增旧格式读时迁移 | 无 | `storage.spec.ts` 扩展：旧 4 文件 → 单文档，字段逐项保留；迁移不删除旧文件 |
| PLAN-FNOS-008-T07-06 | FNOS-008-02 / AC-04 | 显式迁移脚本：`plugins/dsh-codebuddy-plugin/scripts/migrate-storage.mjs` + npm script，与读时迁移共用同一实现（不各写一份）；旧文件改名为 `.migrated-<ts>` 保留，历史 `*.backup-*` 不处理 | T07-05 | 脚本在含旧格式的沙盒目录上运行：生成单文档、旧文件改名、输出摘要；重复运行幂等 |
| PLAN-FNOS-008-T07-08 | FNOS-008-02 / AC-05 | 多会话并发换号修复：`failedId` 改为「本次尝试真正被拒的账号」（发出请求前冻结、每轮切换后更新）；`switchTo` CAS 失败时采用当前账号继续重试而非放弃；`from === to` 时不产出「已自动切换」提示。补端到端并发用例（两/三个账号、失败响应晚于别人切换的确定性编排） | T07-03 | 反转任一修复对应用例变红；插件 67 文件全绿 |
| PLAN-FNOS-008-T07-07 | FNOS-008-02 / AC-01–04、FNOS-008-06 / AC-01 | 端到端验证：探针 profile + 无头 Electron 打开插件详情页，断言四个区块渲染、两个控件可写、Token 图表挂载、成长任务入口可用；确认无 `#/codebuddy` 残留路由 | T07-03、T07-04、T07-06 | 真实前端渲染证据；修复前失败、修复后通过 |
| PLAN-FNOS-008-T07-09 | FNOS-008-02 / AC-06 | 呈现层级对齐：`panel.tsx` 的 Token 统计去掉 `<details>`/`<summary>` 折叠容器，改为与账号管理同级的常驻区块标题（`dsh-codebuddy-panel-section-title` + `tokenTitle`）；删除已无引用的 `.dsh-codebuddy-detail-collapse` / `.dsh-codebuddy-detail-summary` 全部样式（含 caret 与 `prefers-reduced-motion` 分支） | T07-02 | 契约测试：详情页不含 `<details>` / `<summary>` / `detail-collapse`，Token 标题常驻且与账号标题同级；反转任一项变红；插件全量测试通过 |

### 阶段四：文档与索引（T04-01–T04-03）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-008-T04-01 | FNOS-008-01–03、FNOS-008-06–07 | 更新三个插件的配置入口、Desktop 运行形态、OAuth 外部打开限制与截图说明 | 阶段一–三完成 | 文档构建通过 |
| PLAN-FNOS-008-T04-02 | FNOS-008-04 | 需求/计划索引登记 FNOS-008/PLAN-FNOS-008；移除已合并的 FNOS-009 独立入口 | 需求、计划创建时 | `pnpm run doc-sync` / 站内链接检查 |
| PLAN-FNOS-008-T04-03 | FNOS-008-05–07 | 本地升级兼容验证：配置数据、DSH Web 回归和 Desktop 契约对照；fnOS 专属行为单独列入 NAS 验收 | 阶段一–三完成 | 按目标环境分别登记 `docs/validation/` 证据 |

### 阶段五：DSH Desktop 验收（T05-01）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-008-T05-01 | FNOS-008-06 / AC-01–07、FNOS-008-07 / AC-01–07 | 在目标 DSH Desktop 版本安装 CodeBuddy 与 Codex Auth bundle，验证加载、配置详情页、OAuth 登录/取消（含 `window.open` 返回 `null` 的 Desktop 路径）、模型、用量、成长任务、重启恢复和卸载清理 | 阶段二–四完成 | Desktop 目标环境证据；失败时保留 DSH Web 行为并记录降级 |

### 阶段六：fnOS 插件 NAS 验收（T06-01）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-008-T06-01 | FNOS-008-01 / 全部 AC；FNOS-008-05 中 fnOS 授权目录数据部分 | 构建 FPK，在真实 NAS 验证 fnOS 组合包详情页、授权目录读写与权限；确认升级前后 fnOS 授权目录配置保留 | fnOS 插件实现及 DSH Web 验收完成 | NAS 证据登记 `docs/validation/`；不把 CodeBuddy/Codex Auth 验收列为 NAS 阻塞项 |

### 任务依赖

```mermaid
flowchart TD
    T01a[T01-01 依赖与注册迁移] --> T01b[T01-02 卡片回归]
    T01a --> T01c[T01-03 契约测试]
    T02a[T02-01 注册迁移] --> T02b[T02-02 容器适配]
    T02a --> T02c[T02-03 设置侧断言]
    T02a --> T02d[T02-04 Desktop 契约]
    T02d --> T02e[T02-05 开窗语义收口]
    T02e --> T02f[T02-06 组合级端到端验证]
    T03a[T03-01 注册迁移] --> T03b[T03-02 设置侧断言]
    T03a --> T03c[T03-03 Codex Desktop 登录阻断修复]
    T02d --> T03c
    T03c --> T03d[T03-04 窗口句柄可选化与回归]
    T07a[T07-01 注册迁移] --> T07b[T07-02 面板内容内联]
    T07b --> T07c[T07-03 保留项适配]
    T07b --> T07d[T07-04 设置移除与控件迁移]
    T07e[T07-05 配置合并] --> T07f[T07-06 迁移脚本]
    T07c --> T07g[T07-07 端到端验证]
    T07g --> T07h[T07-08 并发换号修复]
    T07d --> T07g
    T07f --> T07g
    T01b --> T04[T04 文档与本地兼容验证]
    T01c --> T04
    T02b --> T04
    T02c --> T04
    T02f --> T04
    T03b --> T04
    T03d --> T04
    T07g --> T04
    T04 --> T05[T05-01 DSH Desktop 验收]
    T04 --> T06[T06-01 fnOS 插件 NAS 验收]
```

三个插件的配置入口迁移相互独立，可并行实施；CodeBuddy 与 Codex Auth 的 Desktop 兼容共用同一份 Desktop 契约结论（T02-04）。DSH Web/Desktop 验收覆盖三个插件各自的目标客户端；真实 NAS 验收仅覆盖 fnOS 插件的宿主授权目录能力，不能作为 CodeBuddy/Codex Auth 的完成阻塞项。

## 交互和行为设计

### 插件详情页配置区块（通用）

- 入口：侧栏「插件」→ 已安装分组 → 对应组合包卡片 → 详情页；配置区块位于描述与「组件」列表之间。
- 渲染：`view: 'page'`；三插件组件均为自管理状态，不消费 `form`。
- 启停联动：插件行关闭后浏览器半侧卸载，配置区块消失；重新启用后恢复（上游既定行为，FNOS-008-05-AC-03 验证）。

### fnOS 授权目录卡片

- 操作保持：查看列表、添加（fnOS 目录选择器）、删除、刷新、保存；保存失败提示沿用现有文案。
- 「打开配置文件」仍在设置弹框头部动作，不迁。

### CodeBuddy 区块

- 详情页承载全部配置：账号管理（登录、添加账号、账号卡片、积分总览、三个自动开关、刷新、完成任务、查看日志）与 Token 统计（总览、趋势、活动热力图、分布与排行）两块内容内联展示；「切换阈值」与「显示余额余量」作为独立控件同样在详情页内。
- 原全页面管理面板（`shell.overlay` + `#/codebuddy/*` hash 路由 + `DshNav` 侧栏 + 返回按钮）整体移除；`panel-route.ts` 与 `PanelRouteController` 一并删除，不再有 hash 归属匹配。
- 详情页为窄列纵向容器且切走即卸载：删除原面板的 `visited` 延迟挂载（keep-alive）逻辑；跨挂载状态由模块级持久化 store（`usage-prefs`、`token-stats`、`account-epoch`）承担，`useAutoPrefs` 的 host 采纳在每次挂载执行但幂等。
- 增长任务整套保留：账号卡片内的签到与旅行状态、三个自动开关、成长任务列表、完成任务/一键完成、执行日志抽屉、积分总览在详情页内均可用，行为与迁移前一致。
- 设置弹框不再有 CodeBuddy 区块（`settings.section` 注册删除），`nav`/`managePanel` 入口随之消失。

### CodeBuddy 配置文档合并

- 磁盘上由 6 个文件收敛为 1 个：`codebuddy-auth.json` 扩为带 `version: 2` 的单一文档，字段为 `activeId`/`accounts`/`prefs`（`autoSwitch`/`autoCheckin`/`autoTravel`）/`growthRun`。
- 读时自动迁移：`loadStorage()` 读到无 `version: 2` 的文档时，探测旧子文件并把内容并入，原子写回新格式后把旧文件改名为 `.migrated-<ts>`（保留，不删除）。用户无需手动操作。
- 显式脚本：`pnpm --filter @tnnevol/dsh-codebuddy migrate:storage`，与读时迁移共用同一实现，用于离线/NAS 预迁移与排错。
- 写入串行化收敛：`storage.ts` 与 `growth-run.ts` 原先各持一个 `SerialQueue` 却写同一目录，合并后 `growthRun` 必须走 storage 的同一把锁，避免单文件上的读-改-写互相覆盖。
- 历史遗留文件（`*.backup-*`）不在本插件生成逻辑内，迁移时不处理、不清理。

### Codex Auth 区块

- 登录、全局模型选择与保存、模型目录刷新操作不变；登录窗口生命周期管理不动。

### CodeBuddy Desktop 运行路径

- Desktop 详情页与其他运行形态复用同一配置组件、同一 Host 业务与同一 RPC；组件不感知客户端形态，也不需要分支。
- OAuth 登录页通过 `openAuthUrl` 打开：独立浏览器返回窗口句柄，Desktop 由壳转系统浏览器并返回 `null`；两种情况都视为「已发起打开」，登录结果由 `pollLogin` 决定。
- 开窗被策略拦截或抛异常时登录流程不崩溃、不误报，用户可重试；`window.open` 之外的传输、断线与失败语义沿用既有实现。

## 数据、权限和错误处理

- 不新增持久化；不改变既有写入路径（`dsh-fnos` settings 命名空间、CodeBuddy localStorage + Host RPC、Codex settings 写入 RPC）。Desktop 只增加 Remote 传输投影，不复制凭据或账号数据。
- 保存失败保护不变：失败时保留原值（对齐 `FNOS-007-03-AC-04`）。Remote/传输失败必须显式返回错误，不转换为空账号或成功。
- Web/fnOS 的既有 HTTP bridge 保留；Desktop 不要求 `webServer`，但 Remote 注册必须可逆。
- 权限无变化：不新增 fnOS 权限；OAuth token 仍仅由 Host 保存和使用。

## 依赖、风险和决策

| 项 | 内容 | 应对 |
| --- | --- | --- |
| 上游事实 | 插件管理页、`plugins.bundle.config`、`PluginConfigViewProps`、config ledger 渲染条件均已在本地 checkout `dsh-v0.1.7-rc.2` 源码核实 | 无需待验证；升级上游时关注 slot 契约变化 |
| 风险：CodeBuddy/Codex Auth 区块在详情页容器中的布局差异（原为整屏设置分区，现为嵌入区块） | 组件原样式按设置分区宽度设计 | 保留组件区块宽度自适应；交互走查覆盖窄宽度场景；必要时加容器内边距 |
| 风险：`close` 语义变化遗漏调用点 | 两个调用点已知（面板入口、取消登录） | 保留可选 prop，类型检查兜底 |
| 决策：不动 `settings.action`「打开配置文件」 | 属设置弹框头部动作，与插件配置迁移无关 | — |
| 决策：不为无配置插件新增配置页 | FNOS-008 明确排除 | — |
| 风险：Desktop Loader 不支持当前 Client bundle 或外部打开能力 | 已核实为否：Desktop 复用 web 载体并由壳转发请求、转系统浏览器打开 | 已消解；契约由 `tests/desktop-adaptation.spec.ts` 锁定 |
| 风险：`window.open` 在 Desktop 返回 `null` 被误判为「弹窗被拦截」 | 壳对外部链接返回 deny 但已调 `shell.openExternal` | CodeBuddy 已收口到 `openAuthUrl`；Codex Auth 需同样修复（该误判在 Desktop 上是**登录阻断**，见 FNOS-008-07） |
| 风险：把 `dsh.client.platform` 改成 desktop/electron | `dsh-client-modules` 只接受 `web`，改后 Web 与 Desktop 同时失效 | 契约测试断言该字段保持 `web` |
| 回滚 | 恢复原 slot 注册并重新构建发布插件；数据层不动，回退无数据风险 | 按插件独立回滚；Desktop 适配可单独撤回 |


## 测试、打包、发布和回滚

- **包级**：三插件 typecheck、单测、构建（`lib/` 产物新鲜）；CodeBuddy `client.js` 同时确认配置详情页注册和 Desktop transport 入口，且不包含 Host 模块。
- **DSH Web**：`dsh plugin add` 链接三插件构建产物启动 Web profile：三个详情页配置区块可见可用；设置弹框无插件配置入口；官方配置页正常；CodeBuddy Web bridge 回归通过。
- **Desktop 契约级**：在 `null` 开窗下验证 CodeBuddy 与 Codex Auth 的登录都继续推进（断言用户可观察行为）；`dsh.client.platform` 保持 `web`。
- **DSH Desktop**：在目标版本验证 CodeBuddy/Codex Auth 加载、详情页、OAuth 外部打开与登录取消、模型、用量、成长任务、重启、断线和卸载清理；非 fnOS 插件以 Web/Desktop 验收作为完成条件，不要求 NAS。
- **FPK**：本需求不修改 FPK 结构，按现有流程构建冒烟即可；不因插件 UI 迁移要求重复发布或安装整个应用。
- **真实 NAS（仅 fnOS 专属部分）**：安装/升级后验证 FNOS-008-01 与 FNOS-008-05 中授权目录的读写、权限和保留行为；不把 CodeBuddy、Codex Auth 的验收列入 NAS 阶段。
- **文档**：`pnpm run doc-sync` 与站内链接检查。
- **回滚**：单插件可独立回滚到原注册；Desktop 适配可独立撤回；禁止删除任何用户配置数据。

## 参考资料

- 官方架构决策：`.agents/notes/implemented/architecture/2026-09-16-plugin-configuration-on-the-plugins-page.zh.md`（上游仓库）
- 官方架构决策：`.agents/notes/implemented/architecture/2026-09-17-settings-pages-as-companion-packages.zh.md`（上游仓库）
- 上游插件管理页：`packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx`、`slot-contract.ts`、`config-ledger.ts`
- 上游社区 bundle 配置范式：`packages/experimental/client-ui-voice-input/src/client/mount.ts`
- 上游 cookbook：`docs/cookbook/adding-a-settings-card.zh.md`
- 本仓库需求：FNOS-007-03/09（迁移不改写入路径的先例与约束）

## 完成状态

| 阶段 | 状态 |
| --- | --- |
| 阶段一：dsh-fnos 迁移 | <Badge type="info" text="规划中" /> |
| 阶段二：CodeBuddy 迁移与 Desktop 适配 | <Badge type="info" text="规划中" /> |
| 阶段三：Codex Auth 迁移与 Desktop 兼容 | <Badge type="warning" text="本地完成，待验证" /> |
| 阶段四：文档与索引 | <Badge type="info" text="规划中" /> |
| 阶段五：DSH Desktop 验收 | <Badge type="info" text="待完成" /> |
| 阶段六：fnOS 插件 NAS 验收 | <Badge type="info" text="规划中" /> |

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-09-28 | 初始计划 | 建立 PLAN-FNOS-008，覆盖 FNOS-008-01 至 FNOS-008-05；上游接缝事实已在 `dsh-v0.1.7-rc.2` checkout 核实。 |
| 2026-09-28 | 合并 FNOS-009 | 新增 FNOS-008-06 与 CodeBuddy Desktop、OAuth 开窗和目标环境验收任务；原 PLAN-FNOS-009 不再单独追踪。 |
| 2026-09-28 | 更正 Desktop 前提 | 经 `dsh-0.1.7-rc.2` 源码核实（`apps/desktop`、`packages/client/modules`）：Desktop 复用 web 客户端载体与同一 Host，`/codebuddy` RPC 等由壳转发即可用。删除 T02-05/T02-06 原「新增 Host Remote facade 与 Client transport API」的任务约定（不需要的重构），改为契约核实、开窗语义收口与组合级端到端验证。 |
| 2026-09-28 | CodeBuddy Desktop 实现完成、Desktop 验收阻塞 | 落地 `openAuthUrl` 开窗收口（3 个登录入口）与 `tests/desktop-adaptation.spec.ts`；插件检查 68 文件/888 测试通过，本地组合下 `/codebuddy` RPC 与客户端 bundle 端到端可用。本机未安装 Electron 且 `apps/desktop` 未构建，真实 Desktop 运行时验收无法执行，阶段五标记为「待完成」，证据见 [FNOS-008-06 本地验证记录](/validation/FNOS-008-06-codebuddy-desktop-local-2026-09-28)。 |
| 2026-09-28 | 新增 Codex Auth Desktop 任务 | 审计确认 FNOS-008-07 为功能性阻断：`signIn()` 把 `window.open` 的 `null` 判为「弹窗被拦截」并提前返回，Desktop 下设备码永不请求。新增 T03-03（修复登录阻断）与 T03-04（窗口句柄可选化与回归），并把阶段五验收范围扩到两个插件的 `null` 开窗路径。 |
| 2026-09-28 | Codex Desktop 修复实现完成、Desktop 验收阻塞 | 落地 T03-03/T03-04：新增 `src/client/window-opener.ts`（`openAuthorizationWindow`），`signIn()` 在 `null` 时继续请求设备码，句柄登记改为判空守卫，取消作废路径改 `popup?.close()`；新增 `tests/client/desktop-window.spec.ts`（10 条）并同步两处旧写法断言。插件检查 18 文件/88 测试通过，构建通过，本地组合下 `/plugins/dsh-codex-auth-plugin/auth/status` 端到端返回 200。本机无 Electron 运行时，真实 Desktop 验收未执行，证据见 [FNOS-008-07 本地验证记录](/validation/FNOS-008-07-codex-desktop-local-2026-09-28)。 |
| 2026-09-28 | 落地 T03-01/T03-02 | Codex Auth 配置从设置弹框 `settings.section` 迁入插件管理页 `plugins.bundle.config`（key `@tnnevol/dsh-codex-auth`）。补 `@deepseek-ai/dsh-client-ui-plugin-manager` 的 catalog 条目、peer/dev 依赖、`dsh.client.inject` 与 compatibility 清单；客户端仅 type-only 引入该包。新增 `tests/client/bundle-config-registration.spec.ts`（8 条）覆盖注册契约、无设置侧入口、无运行时 import、类型依赖、compat 一致性与布局解耦。插件检查 19 文件/96 测试通过；构建产物含新注册且不含 `settings.section`；组合级确认 Codex 条目 `enabled/active`。数据读写路径未变，无数据迁移。 |
| 2026-09-29 | 新增 T07-08 | 并发换号审计发现两个真实缺陷（详见 FNOS-008-02-AC-05 变更记录），登记为 T07-08 并补可证伪的并发用例。 |
| 2026-09-29 | 登记验证记录 | 补登三份 `docs/validation/` 记录：FNOS-008-01（fnOS 授权目录迁入详情页）、FNOS-008-02（CodeBuddy 详情页与设置浮层）、FNOS-008-06（Desktop 运行时复验）。01/02 此前只有提交与单测、无验证记录，属流程缺失。另更正 FNOS-008-06 旧记录「本机未安装 Electron、无法验收」已被事实取代——目标运行时（`/Applications/DeepSeek Harness.app`）已安装且实测两个插件均在 Desktop 上激活；按验收规范「证据只追加，不修改」，以新文件取代，旧记录保持原样。 |
| 2026-09-29 | 按插件拆分环境验收阶段 | CodeBuddy/Codex Auth 改为 DSH Web 与 Desktop 验收；真实 NAS 阶段仅覆盖 fnOS 插件授权目录及其数据保留，调整影响矩阵、任务依赖和验收清单。 |
| 2026-09-29 | 新增 T07-09 | Token 统计在详情页内改回常驻区块（与账号管理同级呈现），删除折叠容器与配套样式；登记 FNOS-008-02-AC-06。 |
