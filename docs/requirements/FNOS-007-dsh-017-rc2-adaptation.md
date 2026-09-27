---
id: FNOS-007
title: FNOS-007 DSH 0.1.7-rc.2 适配与插件错误修复
description: 将 DSH 应用与仓库内四个插件升级到 0.1.7-rc.2，迁移被上游替换或移除的插件接缝，通过新增的插件兼容性门禁，并把文档站 Mermaid 渲染替换为客户端渲染器。
status: planned
owner: tnnevol
targetVersion: 5.6.0
lastVerified: 2026-09-24
---

# FNOS-007 DSH 0.1.7-rc.2 适配与插件错误修复

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-007 |
| 提出日期 | 2026-09-24 |
| 需求状态 | <Badge type="info" text="规划中" /> |
| 关联计划 | [PLAN-FNOS-007 DSH 0.1.7-rc.2 适配与插件错误修复](/plans/PLAN-FNOS-007-dsh-017-rc2-adaptation) |
| 适用应用 | `fn-deepseek-harness` |

## 需求背景与目标

当前 DSH 运行时、插件兼容性基线和 FPK 构建链统一以 `0.1.5-rc.2` 为基线（FNOS-004 交付）。上游已发布 `0.1.7-rc.2`，本仓库需要把应用与四个运行时插件同步升级，并修复各插件在该版本上的错误，确保插件可以正常运行。文档站使用的 Mermaid 渲染方案同时需要替换，以去掉旧构建期插件及其 CommonJS 依赖链。

这次升级不是单纯的版本号替换。`0.1.5-rc.2` 到 `0.1.7-rc.2` 之间约有 3650 次提交，其中若干处改动会直接让现有插件报错、静默失效或被拒绝加载：

1. **新增的插件兼容性门禁。** `0.1.7-rc.2` 引入 `evaluatePluginCompatibility()`，在**安装时**和**profile 启动时**用 SemVer 校验插件的每个 `@deepseek-ai/dsh*` peer 依赖是否满足运行版本。本仓库插件当前在 `peerDependencies` 中精确锁定 `0.1.5-rc.2`，而 `semver.satisfies('0.1.7-rc.2', '0.1.5-rc.2', { includePrerelease: true })` 为假，因此这些插件会被直接拒绝安装（`nothing was installed`，退出码 1）或在启动时被禁用。这是本次升级的最高优先级风险。
2. **Settings 接缝被整体替换。** `ctx.settings` 的服务实现由抽象类 `SettingsProvider` 换成 `SettingsForms`；`ctx.settings.register()`、`SettingsScope`、`SettingsProvider`、`SettingsApplies`、`SettingsSectionHooks` 等导出被移除，`@deepseek-ai/dsh-settings-file` 包被删除。客户端侧 `ctx.settingsScope` 与 `SettingsScope`/`SettingsScopeBinder` 一并被 `ctx.configForms`/`ConfigForm` 取代。`dsh-fnos` 插件的主题、授权目录和网关代理路径设置全部建立在这套接缝上。
3. **`settings.plugin.item` 插槽退役**，由 `plugins.bundle.config`、`plugins.row.config` 和 `plugins.item` 取代。`dsh-fnos` 的授权目录设置卡片注册在这个已不存在的插槽上。
4. **`dsh-llm` 的消息模型改为按角色区分的联合类型**，`ToolResultBlock` 被移除，工具结果改由 `role: 'tool'` 的消息承载。`dsh-codebuddy` 的 CodeBuddy 线缆序列化器按块类型 `tool-result` 从 user 消息中提取工具结果，该逻辑在 `0.1.7-rc.2` 上取不到任何结果。
5. **`dsh-attachment` 的 `ImageRequestPolicy` 改名为 `ImageRequestTarget`**，字段由 `{ maxPixels, maxBytes }` 改为 `{ width, height, maxBytes }`。`dsh-codebuddy` 的图片序列化器依赖旧名和旧字段。
6. **`ui-primitives` 图标命名规则改为 `Regular`/`Medium` 后缀**，数字后缀（`...14`、`...16`）的图标被移除。`dsh-fnos` 与 `dsh-codex-auth` 共四处组件引用了被移除的图标名。
7. **会话格式版本由 3 升到 4**，并新增 `session-format-v3-to-v4` 迁移边界。现有用户的 V3 会话日志需要能继续被读取。

除上述破坏性变更外，本需求还要把依赖基线、兼容性声明、FPK 构建配置、native 构建输入和文档统一到 `0.1.7-rc.2`，保持 FNOS-001～FNOS-006 已验收的网关、授权目录、NAS 引用、插件加载和用户数据行为不变。

### 适配依据

本需求的 DSH 版本、类型和插件接缝以本地官方 Harness checkout 为准：

- 本地仓库：`~/workspace/fork-pj/deepseek-harness`
- 目标 tag：`dsh-v0.1.7-rc.2`
- 目标 commit：`477b4f420553e8a52c2fbccc464d7561b239c443`
- 上一基线 tag：`dsh-v0.1.5-rc.2`（commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`）
- 源码包版本：`@deepseek-ai/dsh-root@0.1.7-rc.2`
- 包管理器：`pnpm@11.7.0`（与上一基线相同）
- Node 引擎：`^22.19.0 || >=24.0.0`（与上一基线相同）

该 checkout 处于游离 HEAD，正好位于目标 tag，实施期间**不切换分支**，并固定以该 tag 的源码、生成类型、CLI 文档和构建结果为准。线上仓库只作为补充链接，不以主分支漂移内容替代本地 tag 证据。

上游 registry 分布：`0.1.7-rc.2` 发布在 `next` dist-tag 上，而 `latest` 仍指向 `0.1.5-rc.3`。因此本需求的所有安装与构建路径必须使用**精确版本**，不得改用 `latest`。

### 实施分期约束

仓库里存在三条彼此独立的 DSH 版本通路，本需求只升级其中服务于 FPK 运行时的那一条：

| 通路 | 声明位置 | 本需求是否升级 | 原因 |
| --- | --- | --- | --- |
| 插件依赖基线 | `pnpm-workspace.yaml` 的 `catalogs.dsh.*` | 是 | 决定插件编译与 peer 声明，是门禁能否放行的前提 |
| FPK 运行时 | `apps/fn-deepseek-harness/cmd/install_callback` 的 `DSH_VERSION`、构建 CLI 版本常量 | 是 | 交付给用户的运行时，是本次适配的目标 |
| 开发工具链 | `catalog` 顶层 `@deepseek-ai/dsh`、`.dsh/` 下的本地 profile | 否 | 服务于仓库内开发与调试，不是 FPK 运行时；两处均不由本需求改动 |

开发工具链暂不升级，是因为它会中断正在进行的开发：`catalog` 顶层的 `@deepseek-ai/dsh` 决定 `pnpm exec dsh` 与 `pnpm run dev:web` 使用的 CLI 版本，而当前开发用的 DSH Web 宿主正由这份 CLI 启动；`.dsh/profiles/web` 中的三个插件又以 `link:` 指向本仓库的插件目录（`plugins/dsh-codebuddy-plugin`、`plugins/dsh-codex-auth-plugin`、`plugins/dsh-semi-ui-showcase-plugin`），并加载 git 忽略的构建产物 `lib/`。若插件源码迁到新接缝而本地 profile 仍解析 `0.1.5-rc.2` 的 peer，链接进 profile 的插件会因 peer 不匹配被兼容性门禁禁用。

因此插件接缝迁移、插件依赖升级与本地开发宿主的运行时升级必须分别安排，不能假定三者同步。开发工具链的升级时机由后续独立变更确定，本需求不为它设截止条件。

## 需求目标

- DSH 应用和仓库内四个插件的兼容性基线统一为 `0.1.7-rc.2`，相关依赖、兼容性声明、FPK 构建配置、native 构建输入和文档保持一致。
- 四个运行时插件都能通过 `0.1.7-rc.2` 的插件兼容性门禁：既能在安装阶段被接受，也能在 profile 启动阶段不被禁用。
- 修复各插件在 `0.1.7-rc.2` 上的实际错误，使插件在该版本中正常运行，而不是仅在类型检查中通过。
- `dsh-fnos` 的 Settings 接缝迁移到 `SettingsForms`/`ConfigForms`，主题同步、授权目录和网关代理路径三项设置行为保持不变，用户已保存的设置值继续生效。
- `dsh-codebuddy` 的 LLM 消息序列化迁移到按角色的消息模型，工具调用、工具结果、文本、推理与图片内容仍能被正确还原到 CodeBuddy 线缆协议。
- `dsh-codex-auth` 的 `dsh-llm-pi-ai`、附件和设置接缝迁移后，Codex 登录、模型目录、用量查询和图片输入行为保持不变。
- `dsh-semi-ui` 共享包与总览插件在新客户端上可构建、渲染、刷新和卸载。
- FPK 能安装并启动 `0.1.7-rc.2` 运行时，安装回调、native 依赖准备、插件清单和构建校验全部对齐新基线。
- 文档站 Mermaid 图由客户端渲染器接管，保留缩放、拖拽、重置、复制源码、下载、全屏与明暗主题跟随能力，并去掉旧的构建期插件。
- 保留 FNOS-001～FNOS-006 已验收的网关、授权目录、NAS 引用、会话日志导出、用量图标和用户数据行为。

## 涉及范围

| 模块 | 目录或入口 | 职责 |
| --- | --- | --- |
| 插件依赖基线 | `pnpm-workspace.yaml` 的 `catalogs.dsh.*`、根 `pnpm-lock.yaml` | 声明并锁定 `0.1.7-rc.2` 的 `@deepseek-ai/dsh-*`，同步 `minimumReleaseAgeExclude` 和 `@deepseek-ai/schemastery` 版本 |
| fnOS 插件 | `plugins/dsh-fnos-plugin`、`compatibility.json` | 迁移 Host `ctx.settings` 与 Client `settingsScope`→`configForms` 接缝；迁移 `settings.plugin.item` 插槽、图标引用和输入触发器契约 |
| Codex Auth 插件 | `plugins/dsh-codex-auth-plugin`、`compatibility.json` | 适配 `dsh-llm-pi-ai`、`dsh-attachment`、设置与图标接缝；保留凭据、模型目录和用量行为 |
| CodeBuddy 插件 | `plugins/dsh-codebuddy-plugin`、`compatibility.json` | 迁移 `dsh-llm` 角色化消息模型、工具结果与图片请求目标接缝 |
| Semi UI 插件 | `packages/dsh-semi-ui`、`plugins/dsh-semi-ui-showcase-plugin` | 适配共享 UI 组件、客户端插槽和 renderer 契约 |
| FPK 应用 | `apps/fn-deepseek-harness/{manifest,cmd,app,config}` | DSH 版本、插件清单、安装/升级回调与运行身份 |
| 构建与发布 | `tooling/fnos-dsh-cli`、`.github/config`、`.github/scripts`、`.github/workflows` | 版本常量、native 构建输入文件和 FPK 产物校验 |
| 会话兼容 | 上游 `session-format-v3-to-v4` 迁移边界 | 验证插件不假设 V3 会话结构，用户既有会话仍可读取 |
| 文档与测试 | `docs/`、各插件 `tests/` | 记录迁移差异、契约断言和验证证据 |
| 文档站渲染 | `docs/package.json`、`docs/.vitepress/{config.mts,theme/}` | 用 `vitepress-mermaid-renderer` 替换旧构建期 Mermaid 插件，移除其 CJS 依赖链并在客户端主题中接入 |
| 三方市场插件 | `app/published-dsh-plugins.json`、`tooling/fnos-dsh-cli`、`docs/{apps,plugins}/` | 把 `dshmarket` 固定版本由 `1.46.1` 升到 `1.65.1`，同步构建校验常量与文档中的当前值 |

仓库内开发宿主不在本需求的改动范围内：`catalog` 顶层的 `@deepseek-ai/dsh`（供根 `package.json`、`pnpm exec dsh` 与 `pnpm run dev:web` 使用）保持当前版本；`.dsh/` 下的本地 profile 属本地运行状态，不由本需求升级。这两处服务于开发工具链，不是 FPK 运行时，其版本通路与 `catalogs.dsh.*`、`cmd/install_callback` 相互独立。

## 功能列表

| 编号 | 优先级 | 功能 | 用户行为 | 状态 |
| --- | --- | --- | --- | --- |
| FNOS-007-01 | P0 | 依赖与兼容性基线升级到 0.1.7-rc.2 | FPK 安装后应用私有 `dsh --version` 输出 `0.1.7-rc.2`；插件依赖目录、锁文件和构建常量不再引用旧基线 | <Badge type="info" text="规划中" /> |
| FNOS-007-02 | P0 | 通过 0.1.7-rc.2 插件兼容性门禁 | 安装插件时不再出现 `nothing was installed`；DSH Web 启动后插件行不被禁用，四个插件正常加载 | <Badge type="info" text="规划中" /> |
| FNOS-007-03 | P0 | `dsh-fnos` Settings 接缝迁移 | 主题跟随、授权目录列表和网关代理路径仍可在设置页读写，已保存的值升级后继续生效 | <Badge type="info" text="规划中" /> |
| FNOS-007-04 | P0 | `dsh-codebuddy` LLM 工具结果与图片接缝迁移 | 使用 CodeBuddy 模型的多轮工具调用对话可正常继续，图片输入按模型能力被接受或明确拒绝 | <Badge type="info" text="规划中" /> |
| FNOS-007-05 | P0 | `dsh-codex-auth` 接缝迁移 | Codex 登录、模型目录、用量查询和图片输入在 0.1.7-rc.2 上行为不变，已有凭据不被覆盖 | <Badge type="info" text="规划中" /> |
| FNOS-007-06 | P1 | Semi UI 共享包与总览插件迁移 | 共享组件与总览页面在新客户端可打开、切换主题和卸载，无运行时报错 | <Badge type="info" text="规划中" /> |
| FNOS-007-07 | P0 | FPK 构建、native 与发布清单对齐新基线 | 新 FPK 可构建、安装并启动，内置插件归档版本与发布清单精确一致 | <Badge type="info" text="规划中" /> |
| FNOS-007-08 | P0 | 既有会话在新的会话格式下仍可读取 | 升级后打开旧会话能正常加载，不因格式版本变化出现空白或报错 | <Badge type="info" text="规划中" /> |
| FNOS-007-09 | P1 | 插件设置页与图标资源适配 | 授权目录设置卡片在新设置页框架中仍可见可用；会话头部与模型选择图标正常显示 | <Badge type="info" text="规划中" /> |
| FNOS-007-10 | P1 | 升级、回滚与真实 NAS 验收 | 升级保留用户数据，失败可回滚；真实 NAS 记录完整证据 | <Badge type="info" text="规划中" /> |
| FNOS-007-11 | P1 | 文档站点 Mermaid 渲染器替换 | 文档站图表照常渲染，并新增缩放、拖拽、重置、复制源码、下载、全屏与明暗主题跟随；文档包不再依赖旧的构建期插件及其 CJS 依赖链 | <Badge type="tip" text="已完成" /> |
| FNOS-007-12 | P1 | 升级 `dshmarket` 固定版本到 1.65.1 | 新用户安装后 profile 中获得 `dshmarket@1.65.1` 且市场入口可用；已安装用户跳过安装、保留原有版本与配置 | <Badge type="warning" text="待完成" /> |

## 交互和行为约束

- `0.1.7-rc.2` 是本需求的唯一 DSH 运行时基线。`catalogs.dsh.*`、`compatibility.json`、`DSH_VERSION`、native 配置、FPK 安装回调、构建校验常量和发布文档不得继续引用 `0.1.5-rc.2` 作为当前值。
- `0.1.7-rc.2` 位于 `next` dist-tag，`latest` 仍指向 `0.1.5-rc.3`。所有安装、更新和构建路径必须使用精确版本；不得使用 `latest`、`next` 或其他浮动 dist-tag 解析 DSH 版本。
- 插件 `peerDependencies` 使用统一 catalog，不在各插件中重复硬编码 DSH 版本。升级后发布出的插件包，其 `@deepseek-ai/dsh*` peer 要求必须能让 `evaluatePluginCompatibility()` 在 `0.1.7-rc.2` 上判定为兼容。
- 兼容性门禁的放行必须来自**修正后的 peer 声明**，而不是用户侧豁免。`dsh plugin allow-version` 只作为诊断和临时过渡手段记录，不得作为交付方案写入安装回调、构建校验或用户文档。原因是豁免按 `包名@精确版本` 绑定运行版本，会让后续每次基线升级都重新失效，并把风险判断推给用户。
- `0.1.7-rc.2` 新增的 DSH 自有插件子命令（`allow-version`、`revoke-version`、`version-exemptions`）用于精确版本豁免管理；本需求的插件管理仍沿用 `dsh plugin --profile web add/update <package>@<exact-version>`，不改变插件生命周期顺序。
- `dsh plugin` 其余参数仍然转发给 pnpm；`dsh web` 与 `dsh --profile web` 等价，`--profile` 只允许出现一次。网关启动 Web 的参数形式保持现有写法。
- 开发用的 DSH CLI 与本地 profile 不随本需求升级。`catalog` 顶层 `@deepseek-ai/dsh` 保持当前版本，`.dsh/` 下的 `link:` 插件与 peer 解析保持不变：插件源码迁到新接缝、而本地 profile 仍解析 `0.1.5-rc.2` peer 时，链接进 profile 的插件会因 peer 不匹配被兼容性门禁禁用。因此插件接缝迁移、插件依赖升级与本地开发宿主的运行时升级需要分别安排，不能假定三者同步。
- FPK 运行时版本由 `apps/fn-deepseek-harness/cmd/install_callback` 的 `DSH_VERSION` 与构建 CLI 的版本常量独立声明，不读取 `catalog` 顶层条目。这是交付 `0.1.7-rc.2` 运行时的正式通路。
- 四个运行时插件（`@tnnevol/dsh-codex-auth`、`@tnnevol/dsh-codebuddy`、`@tnnevol/dsh-fnos`、`@tnnevol/dsh-semi-ui-showcase`）的发布版本与 DSH 运行时基线保持同一版本号，便于用户和安装器对照；`dshPluginApi.version` 仍单独声明运行时兼容基线，二者分别由 `compatibility.json` 和 `package.json` 承载。
- 插件版本号与 DSH 运行时版本号相同不代表插件可以独立于 `compatibility.json` 演进：任何后续升级都必须同时更新 `package.json`、`compatibility.json`、发布清单和本节版本约束。
- FPK 清单中的所有自动安装插件必须填写精确的 `version`，捆绑包的 `package.json` 版本必须与清单一致。`dshmarket` 的固定版本在本需求内由 `1.46.1` 升级为 `1.65.1`（本需求是当前开发中的需求，按[已完成的需求和计划不再变更](/charter/sdd-workflow#已完成的需求和计划不再变更)在该变更写入这里，不回改已完成的 FNOS-004）；该版本仍是精确版本，不使用 `latest`、`next` 或其他浮动 dist-tag。
- 已确认的上游破坏性变更必须在插件侧完成等价迁移，包括：
  - `dsh-llm`：`Message` 由接口改为按角色区分的联合类型别名；`ToolResultBlock` 从内容块中移除，工具结果改由 `role: 'tool'` 的消息连同 `toolCallId` 与 `isError` 承载；`createSystemMessage(text, plugin)` 变为单参数；`AssistantProvenance` 改名为 `AssistantProviderMetadata`；`GenerateOptions.messages` 放宽为 `RequestMessage[]`；`BlockAssembler.message()` 的来源参数变为必填。
  - `dsh-llm` 图片卸载：`RequestImageOffloadPolicy`、`offloadRequestImagesWithPolicy()`、`offloadedImagePrefixCount()` 被移除，改为 `LlmImageRequestBudget`、`requiredImageOffload()`、`projectOffloadedImages()`，并以 `IMAGE_OFFLOAD_REQUIRED` 错误码表示超预算。
  - `dsh-attachment`：`ImageRequestPolicy` 改名为 `ImageRequestTarget`，字段由 `{ maxPixels, maxBytes }` 改为 `{ width, height, maxBytes }`；新增 `longEdgeDimensions()` 与 `ProjectedDimensions`。`admitEncodedFile()` 与错误类型保持不变。
  - `dsh-settings`：`SettingsProvider`、`SettingsScope`、`SettingsRegisterOptions`、`SettingsApplies`、`SettingsSectionHooks`、`SettingsUpdateSource` 被移除，`ctx.settings` 变为 `SettingsForms`；写入统一走 `update`/`replace`/`mutate` 并支持 `expectedRevision` 乐观校验，读取走 `describe()`。`@deepseek-ai/dsh-settings-file` 包被删除，`settings.yaml` 由 DSH 在启动时迁移进 profile。
  - 客户端设置：`ctx.settingsScope` 与 `SettingsScope`/`SettingsScopeBinder`/`SettingsScopeSnapshot`/`SettingsScopeSpec`/`SettingsScopeController` 被 `ctx.configForms` 与 `ConfigForm`/`ConfigFormSnapshot` 取代；`ConfigForm` 的 `mutate`/`set`/`unset` 返回 `Promise<boolean>`。`settings.plugin.item` 插槽退役，改由 `plugins.bundle.config`、`plugins.row.config` 和 `plugins.item` 承载。
  - `ui-primitives`：`LinkIcon` 与 `ReferenceIcon` 改名为 `LinkIconMedium`/`LinkIconRegular` 与 `ReferenceIconMedium`/`ReferenceIconRegular`；数字后缀图标改为 `Regular`/`Medium` 后缀命名。
  - `ui-session`：`SessionPendingInteractionSnapshot` 与 `useSessionPendingInteraction` 被 `SessionStatus`/`SessionStatusSnapshot`/`useSessionStatus` 与 `useSessionRetainInfo` 取代；`inject` 增加 `remote`。
  - `ui-conversation`：`InputActions` 增加 `captureInsertion()` 与 `insertText()`；`SessionInput` 增加 `focus()`；`InputTriggerController` 增加 `openReference()`；`CommandClaim` 增加必填 `name`；`ReferenceInsert` 与 `TokenSpan` 的来源模块迁移到 `contract/draft-editor.ts`；`conversation.chat.turnTail` 由 `chain` 插槽改为 `list` 插槽。
  - `dsh-commands`：新增 `CommandDefinitionId`，`CommandDefinition`/`CommandDescriptor` 增加可选 `definitionId`；命令描述的本地化取值方式不变。
  - `dsh-session`：`SESSION_FORMAT_VERSION` 由 3 升到 4，工具结果事件的消息角色由 `user` 改为 `tool`，新增 `developer/message` 事件与 `SessionMessageProjection` 接缝；`sessionEventAt()` 与 `snapshotEvents()` 标记为废弃。
  - 插件清单契约：新增 `dsh.manifestVersion: 1`、顶层 `icon` 与 `engines.dsh` 字段；`dsh.bundle.patch` 支持有序数组；`DshProfileManifest.patchReload` 被移除。
- 会话格式迁移由 DSH 上游负责。本需求只验证插件不假设 V3 会话结构、不实现自己的迁移器，也不手工改写用户的会话文件。
- `dsh-fnos` 的主题同步、授权目录和网关代理路径三项设置的对外行为保持不变：设置在设置页可读写、写入后立即生效、重启后保持；`dsh-fnos` 自身不新增设置项。
- `dsh-codebuddy` 的多账号、切换策略、签到、额度、Token 统计和成长任务行为不变；本次只迁移消息序列化与图片请求接缝，不重构业务逻辑。
- `dsh-codex-auth` 的凭据引用、模型目录刷新、用量窗口和图片输入能力判定不变；升级不得覆盖或删除已有凭据与模型配置。
- 各插件的前端静态资源继续由插件自己的 `/fnos-plugins/static/<插件>/<资源>` 路由提供，不内联进客户端 bundle，也不读取 fnOS 宿主静态目录。
- `manifest` 继续使用 INI 格式；应用继续使用 `defaults.run-as: "package"`；FPK 继续不注册公开的 `dsh` 系统命令。
- 上游适配只修改本仓库插件、共享包和构建链，不提交上游源码补丁。若某个接缝无法等价迁移，必须先记录用户可见影响和回滚方式。
- 文档站的 Mermaid 渲染改用 `vitepress-mermaid-renderer`，不再使用构建期插件 `vitepress-mermaid-plugin`。文档包 `@tnnevol/fn-os-apps-docs` 移除 `dayjs`、`mermaid`、`vitepress-mermaid-plugin` 以及为旧插件 `vite.optimizeDeps.include` 而显式声明的 CJS 传递依赖（`@braintree/sanitize-url`、`cytoscape`、`cytoscape-cose-bilkent`、`debug`、`fastdom`）。
- 渲染器在客户端主题的 `Layout` 中初始化，不在 server-only 配置文件中初始化；SSR 阶段保持空操作，浏览器 hydration 后接管 `mermaid` 代码块。配置不再包裹 `withMermaid()`。
- 明暗主题切换时必须用新的 `theme` 重新调用渲染器；否则已挂载图表会停留在初始主题。主题取值跟随 VitePress 的 `isDark`。
- `securityLevel` 保持默认的 `'strict'`，不放宽为 `'loose'`：图表来源是本仓库受版本管理的 Markdown，不需要图表内 inline HTML，也没有放宽安全边界的理由。
- 工具栏按钮的启用范围按显示模式配置：桌面端提供缩放、重置、复制、下载与全屏，移动端不堆叠缩放按钮而保留重置、复制与全屏，全屏下同样保留缩放、重置、复制与下载；重置视图必须在每个断点保留，作为缩放或拖拽后的可靠恢复入口。
- 三个断点的工具栏组必须分别显式配置，不能只配桌面端与移动端。渲染器给 `fullscreen` 组的默认值只启用退出按钮，`fullscreenMode: 'dialog'` 下未配置该组时，进入全屏后缩放、重置、复制与下载会全部消失，只剩缩放比例和退出图标，等于全屏无法操作。
- 全屏容器必须铺满整个可视区域，即 `100vw` × `100vh`，并同时去掉圆角、边框与投影——否则四角会留下悬空的圆角描边。渲染器把 dialog 尺寸硬编码为 `min(94vw, 1200px)` × `min(90vh, 860px)`（1920×1080 下宽度仅占 63%），且只暴露 17 个控件类设计令牌、没有尺寸令牌，因此在站点样式中覆盖该类选择器。覆盖用 `body` 前缀提高一级权重，不使用 `!important`——渲染器在运行时把样式表 append 到 `<head>`，与站点样式优先级相同但位置更靠后。渲染器的 `@media (width<=768px)` 也命中同一类，但其权重低于带 `body` 前缀的规则，移动端同样铺满，不需要额外断点。
- 站点语言为中文，渲染器自带英文 tooltip 必须通过 `i18n.tooltips` 覆盖为中文文案；覆盖的键集合必须完整满足渲染器的 `ToolbarText` 类型（缺键或多键都视为配置错误）。
- 现有 Mermaid 代码块继续使用 `mermaid` 语言标签，图表内容不需要改写。本次只替换渲染方式，不修改任何图表的语义与文字。
- 文档站图表必须在明暗两种主题下都正常渲染，且键盘可达（缩放、重置、平移、全屏）并尊重 `prefers-reduced-motion`。

## 不在本次范围内

- 不追踪 `0.1.6-alpha.*`、`0.1.7-alpha.*`、`0.1.5-rc.3` 或后续 rc/正式版；它们另开需求。
- 不修改 DSH 官方源码，不向上游提交补丁，也不在本仓库内维护上游包的分叉副本。
- 不把 `dsh plugin allow-version` 的版本豁免作为正式交付手段，也不为用户预置 `compatibility.json` 豁免记录。
- 不改变 `dshmarket` 的「已安装则跳过」非破坏性策略：版本号虽从 `1.46.1` 升到 `1.65.1`，但安装器仍只在 profile 中不存在该插件时安装，已安装用户保留原版本与配置，不覆盖、不降级、不卸载。
- 不新增与 DSH 适配无关的插件功能，不重构 CodeBuddy 的多账号、签到、额度与统计策略，不重构 Codex 的登录与模型刷新策略。
- 不修改 fnOS 平台权限模型、网关路径规则、授权目录 ACL 行为或应用入口配置形态。
- 不为迁移到新设置页框架而重新设计设置界面：`dsh-fnos` 授权目录卡片的字段、文案、按钮和保存行为按现有实现迁移，不新增设置项。
- 不实现自己的会话格式迁移器，不重写、不回滚用户已存储的会话文件。
- 不改变会话头部入口、会话日志导出、用量图标供应商显隐和 `/fn` 指令的既有交互。
- 不调整 Node.js 版本要求：`0.1.7-rc.2` 的 `engines.node` 与上一基线相同，FPK 继续使用 `nodejs_v24`。
- 不升级工程内 DSH CLI：`catalog` 顶层 `@deepseek-ai/dsh` 保持当前版本，根 `package.json`、`pnpm run dev:web` 与 `pnpm exec dsh` 的行为不变。
- 不升级本地 profile 内的插件：不重建、不重链接 `plugins/dsh-codebuddy-plugin`、`plugins/dsh-codex-auth-plugin`、`plugins/dsh-semi-ui-showcase-plugin` 的 `lib/` 产物，不改 `.dsh/profiles/web`。
- 不重写文档中现有 Mermaid 图表的内容：本次只替换渲染方式，图表语义、节点文字和结构保持不变。
- 不为图表新增自定义 Mermaid 主题或 CSS 设计令牌覆盖：沿用渲染器默认外观，仅按站点语言覆盖工具栏文案。
- 不把 `dayjs` 从根 catalog 移除：CodeBuddy 插件仍依赖它；本次只解除文档包对它的依赖。

## 验收条件与完成状态

### FNOS-007-01 验收条件

- `FNOS-007-01-AC-01`：`pnpm-workspace.yaml` 的 `catalogs.dsh.*` 全部条目和 `minimumReleaseAgeExclude` 中对应条目指向 `0.1.7-rc.2`，`pnpm-lock.yaml` 解析出的 DSH 包版本可审计且没有混入 `0.1.5-rc.2`。
- `FNOS-007-01-AC-02`：仓库受版本管理的文件中，`0.1.5-rc.2` 只出现在历史需求、计划和验收记录里，不再作为插件依赖基线出现在 `catalogs.dsh.*`、构建常量、native 配置、安装回调和插件清单中。
- `FNOS-007-01-AC-03`：`@deepseek-ai/schemastery` 的版本与目标 tag 一致；`@earendil-works/pi-ai` 仍为 `0.85.1`，`node-pty` 补丁版本和 Node 引擎要求与目标 tag 一致。
- `FNOS-007-01-AC-04`：所有 DSH 安装与构建路径使用精确版本 `0.1.7-rc.2`，不存在 `latest`、`next` 或其他浮动 dist-tag 解析。
- `FNOS-007-01-AC-05`：`catalog` 顶层 `@deepseek-ai/dsh` 与 `.dsh/` 下的本地 profile 未被本需求改动，开发宿主的 CLI 版本和 profile 插件链接保持原状。

### FNOS-007-02 验收条件

- `FNOS-007-02-AC-01`：四个插件的 `package.json` 中，每个 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` peer 要求在运行版本 `0.1.7-rc.2` 上被判定为兼容；该判定有单元测试覆盖，使用与上游 `evaluatePluginCompatibility()` 相同的 SemVer 语义（`includePrerelease: true`）。
- `FNOS-007-02-AC-02`：在干净 profile 中执行 `dsh plugin --profile web add <package>@<exact-version>` 安装四个插件时，不出现兼容性拒绝，也不出现 `nothing was installed`。
- `FNOS-007-02-AC-03`：DSH Web 启动日志中不出现 `disabling profile plugin` 或 `is incompatible with dsh` 警告；四个插件在设置页和运行期均处于启用状态。
- `FNOS-007-02-AC-04`：profile 的 `compatibility.json` 豁免文件不存在或为空即可正常加载插件；交付物不依赖任何预先写入的豁免记录。
- `FNOS-007-02-AC-05`：`compatibility.json` 中 `dshPluginApi.version` 为 `0.1.7-rc.2`，其 `packages` 列表覆盖插件的实际 import 且不含无关包。

### FNOS-007-03 验收条件

- `FNOS-007-03-AC-01`：`dsh-fnos` Host 侧不再引用被移除的 `ctx.settings.register()`、`SettingsScope`、`SettingsProvider`；设置读写改由 `SettingsForms` 的接口完成，类型检查通过。
- `FNOS-007-03-AC-02`：客户端不再 `inject` `settingsScope`，不再调用 `ctx.settingsScope.bind()`；主题持久化改由 `configForms`/`ConfigForm` 完成。
- `FNOS-007-03-AC-03`：升级前已保存的主题偏好、网关代理路径和授权目录相关设置，在升级后仍能被读取并生效；用户不需要重新配置。
- `FNOS-007-03-AC-04`：网关代理路径设置写入后仍会同步到应用数据目录的配置文件，读取接口返回的值与设置页一致；写入失败时保留原文件并可重试。
- `FNOS-007-03-AC-05`：`ui-theme` 主题命名空间读取路径已按新接缝修正，fnOS 主题跟随与 DSH 深浅色偏好优先级行为不变。

### FNOS-007-04 验收条件

- `FNOS-007-04-AC-01`：`dsh-codebuddy` 的消息序列化不再按 `tool-result` 内容块提取工具结果；改为按 `role: 'tool'` 的消息连同 `toolCallId` 与 `isError` 生成线缆消息，类型检查和单元测试通过。
- `FNOS-007-04-AC-02`：多轮工具调用会话（含工具结果、超长工具调用 id、重放推理）能完整序列化为 CodeBuddy 线缆协议，且在真实请求中不返回 400。
- `FNOS-007-04-AC-03`：图片请求目标改用 `ImageRequestTarget` 与 `{ width, height, maxBytes }`，图片输入仍按所选模型能力被接受或明确拒绝，不再出现类型错误。
- `FNOS-007-04-AC-04`：模型不支持图片时仍返回原有 `UNSUPPORTED_CONTENT` 语义错误，不静默丢弃图片内容。
- `FNOS-007-04-AC-05`：多账号、切换策略、签到、额度与 Token 统计行为无回归；文本、图片和错误流仍能被界面正确消费。

### FNOS-007-05 验收条件

- `FNOS-007-05-AC-01`：`dsh-codex-auth` 使用的 `PiAiAdapter`、`ResolvedPiAiProviderProfile` 与 `@earendil-works/pi-ai` `0.85.1` 接口在新基线下仍可用；类型检查、单元测试和构建通过。
- `FNOS-007-05-AC-02`：Codex 登录、凭据读写、模型目录刷新和用量查询在 `0.1.7-rc.2` 上功能不变；已有的 `auth.json` 与模型配置升级后不被覆盖或删除。
- `FNOS-007-05-AC-03`：插件引用的图标改为新的 `Regular`/`Medium` 命名，组件渲染无缺失图标或运行时未定义错误。
- `FNOS-007-05-AC-04`：`compatibility.json` 的 `piAi` 声明与实际安装的 `@earendil-works/pi-ai` 版本一致。

### FNOS-007-06 验收条件

- `FNOS-007-06-AC-01`：`packages/dsh-semi-ui` 与 `dsh-semi-ui-showcase` 的类型检查、单元测试和构建通过。
- `FNOS-007-06-AC-02`：总览页面在新客户端可打开、切换主题、滚动浏览各分组并正常卸载，无运行时异常或重复注册。
- `FNOS-007-06-AC-03`：共享组件中引用的 `ui-primitives`、`ui-slots`、`ui-renderer`、`ui-theme` 导出在新基线下均存在；被重命名或迁移的导出已按新名称修正。

### FNOS-007-07 验收条件

- `FNOS-007-07-AC-01`：`pnpm run build -- --plugin <name>` 与 `pnpm run build -- --fpk --app fn-deepseek-harness` 成功；构建校验使用的 DSH 版本常量、native 配置文件名和安装回调三者一致。
- `FNOS-007-07-AC-02`：native 构建输入文件按新基线命名并被构建脚本、CI 工作流和文档同步引用；node-pty 与 Node.js 版本与目标 tag 的依赖树一致。
- `FNOS-007-07-AC-03`：FPK 安装后应用私有 `${TRIM_PKGHOME}/.npm-global/bin/dsh --version` 输出 `0.1.7-rc.2`，DSH Web 可经 fnOS 网关打开。
- `FNOS-007-07-AC-04`：`published-dsh-plugins.json` 与 `app/bundled-dsh-plugins/*.tgz` 的插件名和精确版本一致；`dshmarket` 仍不进入内置目录，其固定版本与构建校验常量、FNOS-004 记录的当前值三者一致。
- `FNOS-007-07-AC-05`：构建校验在版本、native 配置、锁文件、插件清单或捆绑包元数据任一不一致时拒绝发布。
- `FNOS-007-07-AC-06`：安装回调对 `@deepseek-ai/dsh-attachment-local` 的源码补丁与目标版本编译产物匹配：每处锚点各匹配且仅匹配一次，补丁可重复执行且幂等，`attachment root` 与新增的 `cacheRoot` 都落在 `${TRIM_PKGVAR}` 下的应用私有路径内。锚点被上游改动时以非零退出并给出可定位错误，不得产出半补丁状态。
- `FNOS-007-07-AC-07`：`apps/fn-deepseek-harness/app/` 下的生成产物（`gateway-proxy.mjs`、`rolldown-runtime-*.mjs`、`scripts/install-callback-helper.mjs`、`bundled-dsh-plugins/`、`native/` 与版本文件）不被直接编辑；网关与安装辅助逻辑的改动只落在 `packages/fnos-gateway/src/`，产物经构建重新生成且内容与源码一致。

### FNOS-007-08 验收条件

- `FNOS-007-08-AC-01`：升级后打开 `0.1.5-rc.2` 期间产生的旧会话，页面能正常加载会话内容，不出现空白、解析失败或未处理异常。
- `FNOS-007-08-AC-02`：插件代码不实现自己的会话格式迁移器，也不直接改写用户会话文件；迁移由 DSH 自身完成。
- `FNOS-007-08-AC-03`：插件对会话事件的处理不假设工具结果位于内容块中；若插件读取会话消息，按新的 `role: 'tool'` 结构处理。
- `FNOS-007-08-AC-04`：会话日志导出对旧会话仍能生成可打开的 ZIP，不因格式版本变化而失败。

### FNOS-007-09 验收条件

- `FNOS-007-09-AC-01`：`dsh-fnos` 授权目录设置卡片注册到 `0.1.7-rc.2` 实际存在的插槽上，在设置页可见可用；不再引用已退役的 `settings.plugin.item`。
- `FNOS-007-09-AC-02`：会话头部文件入口、会话日志按钮和模型选择下拉所引用的图标在新命名下正常显示，尺寸和位置与适配前一致。
- `FNOS-007-09-AC-03`：插件静态资源仍通过 `/fnos-plugins/static/<插件>/<资源>` 由插件自身路由返回，不内联进客户端 bundle。
- `FNOS-007-09-AC-04`：`/fn` 指令、授权目录选择器与文件引用插入行为不变。

### FNOS-007-10 验收条件

- `FNOS-007-10-AC-01`：FPK 升级后 `DSH_HOME`、profile、凭据、工作区、授权目录、插件设置和会话数据保留，应用能正常启动。
- `FNOS-007-10-AC-02`：安装与升级可重复执行且幂等；不因新清单而自动移除用户已安装的旧插件。
- `FNOS-007-10-AC-03`：升级失败时返回非零并保留可恢复的旧运行时与配置状态；按回滚流程处理后应用可启动且用户数据不变。
- `FNOS-007-10-AC-04`：`pnpm run check -- --all`、`pnpm run build -- --docs` 和 `git diff --check` 通过。
- `FNOS-007-10-AC-05`：真实 NAS 记录 FPK 安装、升级、启动、网关 HTTP/SSE/WebSocket、四个插件加载与设置读写证据；本地构建结果不替代真实 NAS 结论。

### FNOS-007-11 验收条件

- `FNOS-007-11-AC-01`：`docs/package.json` 不再依赖 `dayjs`、`mermaid`、`vitepress-mermaid-plugin`、`@braintree/sanitize-url`、`cytoscape`、`cytoscape-cose-bilkent`、`debug`、`fastdom`；改为依赖 `vitepress-mermaid-renderer`，且该版本在 catalog 中以精确版本固定。
- `FNOS-007-11-AC-02`：`docs/.vitepress/config.mts` 不再导入或包裹 `withMermaid()`，不再声明为旧插件服务的 `vite.optimizeDeps.include` 条目和 `mermaid` 配置项；配置为可独立求值的纯 VitePress 配置。
- `FNOS-007-11-AC-03`：`docs/.vitepress/theme/index.ts` 在客户端 `Layout` 中调用 `createMermaidRenderer()`，明暗切换时用新的 `theme` 重新调用；SSR 构建不因 `window`/`document` 访问而失败。
- `FNOS-007-11-AC-04`：仓库内全部 Mermaid 代码块（当前 6 个文件共 21 个块）在 `securityLevel: 'strict'` 下渲染为 SVG，无解析或渲染失败；`<br/>` 标签在节点与 participant 标签中正常换行。
- `FNOS-007-11-AC-05`：`pnpm run build -- --docs` 成功，构建产物中出现渲染器标记，且只包含 workspace 锁定的 Mermaid 版本，不引入其他版本副本。
- `FNOS-007-11-AC-06`：工具栏中文文案覆盖的键集合完整满足渲染器的 `ToolbarText` 类型；缺少或多出键时类型检查失败。桌面端、移动端与全屏三组按钮都按约束显式配置，`resetView` 在三个断点都启用。
- `FNOS-007-11-AC-09`：进入全屏后工具栏仍提供缩放、缩放比例、重置视图、复制源码、下载与退出全屏，缩放与重置操作生效，退出后内联视图恢复到适配前的缩放与位移。
- `FNOS-007-11-AC-10`：全屏容器精确铺满视口——容器矩形为 `[0, 0, 视口宽, 视口高]`，占比 100% × 100%，圆角、边框与投影均为无，且不产生横向溢出。桌面、大屏、笔电与移动四种视口以及明暗主题下均成立；图表随容器放大并保持自动适配，进入全屏后缩放、重置、复制、拖拽平移、`f` 键切换与退出恢复都正常。
- `FNOS-007-11-AC-07`：仓库内不再存在指向旧插件 `vitepress-mermaid-plugin` 的现行文档描述。
- `FNOS-007-11-AC-08`：`pnpm run check -- --sdd`、`pnpm run build -- --docs` 和 `git diff --check` 通过。

### FNOS-007-12 验收条件

- `FNOS-007-12-AC-01`：`published-dsh-plugins.json` 的 `bundled` 中 `dshmarket` 版本为 `1.65.1`，与构建校验常量 `DSHMARKET_VERSION`、`docs/apps/fn-deepseek-harness.md` 与 `docs/plugins/index.md` 中的当前值一致；文件以换行结尾。
- `FNOS-007-12-AC-02`：构建校验在清单与常量不一致时仍然拒绝发布；清单、常量与文档一致时校验通过，FPK 构建不被阻断。
- `FNOS-007-12-AC-03`：`dshmarket@1.65.1` 的 DSH peer 要求在 `0.1.5-rc.2` 与 `0.1.7-rc.2` 上均判定为兼容，不使用 `latest`、`next` 或其他浮动 dist-tag。
- `FNOS-007-12-AC-04`：`dshmarket` 仍不进入 FPK 内置目录，安装阶段由 DSH CLI 以精确版本安装；已安装用户跳过安装并保留原有版本与配置，不覆盖、不降级、不卸载。
- `FNOS-007-12-AC-05`：本次版本变更记录在 FNOS-007（当前开发中的需求）内，未修改状态为 `已完成` 的 FNOS-004 的需求与计划正文。

### 状态看板

| 阶段 | 状态 | 当前范围 | 下一步 |
| --- | --- | --- | --- |
| 插件依赖与兼容性门禁 | <Badge type="info" text="规划中" /> | `catalogs.dsh.*`、插件 peer 声明与门禁验证 | 建立基线并补 peer 兼容性断言 |
| 插件接缝迁移 | <Badge type="info" text="规划中" /> | Settings、LLM 消息模型、附件、图标与插槽迁移 | 依赖基线切换后按 Host、Client 顺序推进 |
| FPK 与新会话格式 | <Badge type="info" text="规划中" /> | 构建常量、native 输入、安装回调与旧会话读取 | 更新构建常量与 native 输入 |
| 升级、回滚与验收 | <Badge type="info" text="规划中" /> | 用户数据保留、回滚路径与真实 NAS 证据 | 本地回归后进入真实 NAS 验收 |
| 文档 Mermaid 渲染器替换 | <Badge type="tip" text="已完成" /> | 依赖替换、主题接入、工具栏中文化、图表与构建验证 | 无；已完成 |
| dshmarket 固定版本升级 | <Badge type="warning" text="待完成" /> | 清单、构建校验常量与文档当前值同步到 `1.65.1` | 真实 NAS 安装/升级验证后回写状态 |

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-09-24 | 新增 FNOS-007 | 记录 DSH `0.1.7-rc.2` 适配需求：升级四个插件与应用依赖基线，迁移 Settings、LLM 消息模型、附件、客户端插槽与图标接缝，并通过新增的插件兼容性门禁 |
| 2026-09-24 | 明确门禁放行方式 | 确认 `0.1.5-rc.2` 精确 peer 在 `0.1.7-rc.2` 上被 `evaluatePluginCompatibility()` 判定为不兼容，会导致安装被拒和 profile 启动禁用；放行必须来自修正后的 peer 声明，`dsh plugin allow-version` 只作诊断过渡，不作为交付方案 |
| 2026-09-24 | 新增 FNOS-007-11 | 把文档站 Mermaid 渲染器替换纳入本需求：`@tnnevol/fn-os-apps-docs` 改用 `vitepress-mermaid-renderer`，移除旧构建期插件及其 CJS 传递依赖 |
| 2026-09-24 | 划定开发宿主边界 | 明确 `catalog` 顶层 `@deepseek-ai/dsh` 与 `.dsh/` 下的本地 profile 不由本需求升级：二者服务于开发工具链而非 FPK 运行时，与 `catalogs.dsh.*`、`cmd/install_callback` 的版本通路相互独立 |
| 2026-09-24 | 确认目标版本与范围边界 | 目标版本暂定 `5.6.0`；`dshmarket` 固定版本、fnOS 权限模型、网关路径规则和会话文件内容不在本次改动范围 |
| 2026-09-24 | 修复全屏工具栏缺失（FNOS-007-11-AC-09） | 接入时只配置了 `desktop` 与 `mobile` 两组，未配置 `fullscreen` 组，于是回退到渲染器默认值——该默认只启用 `toggleFullscreen`，导致进入全屏后缩放、重置、复制与下载全部消失，只剩缩放比例和退出图标。现显式配置 `fullscreen` 组；已在真实浏览器中验证开发与生产构建下的全屏缩放、重置与退出恢复 |
| 2026-09-27 | 全屏容器改为铺满视口（FNOS-007-11-AC-10） | 按需求把全屏尺寸从渲染器硬编码的 `min(94vw, 1200px)` × `min(90vh, 860px)` 覆盖为 `100vw` × `100vh`，并去掉圆角、边框与投影以避免四角悬空描边。渲染器只提供控件类设计令牌、没有尺寸令牌，故在 `custom.css` 覆盖类选择器并用 `body` 前缀提高权重（不用 `!important`）。实测四种视口与明暗主题下容器矩形均为 `[0,0,W,H]`、占比 100% × 100%、无横向溢出；缩放、重置、复制、拖拽与退出恢复全部正常 |
| 2026-09-27 | 新增 FNOS-007-12：dshmarket 升级到 1.65.1 | 按用户决定把 `dshmarket` 固定版本由 `1.46.1` 升级为 `1.65.1`，同步发布清单、构建校验常量与插件/应用文档中的当前值。原文「固定版本不变」的表述改为「在本需求内升级」，并保留「已安装则跳过、不覆盖用户版本」的策略。按 SDD 规范，该变更记入当前开发中的本需求，未回改状态为 `已完成` 的 FNOS-004 |
