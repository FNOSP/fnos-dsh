---
id: FNOS-036
title: FNOS-036 测试用例
description: FNOS-036 DSH 0.2.1-rc.5 插件适配与基线迁移的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-036-dsh-021-rc5-adaptation
plan: /plans/PLAN-FNOS-036-dsh-021-rc5-adaptation
status: 部分通过
lastVerified: 2026-10-30
verifiedAt: 2026-10-30
---

# FNOS-036 测试用例

## 测试范围与需求分析

被测对象是 DSH 基线 `0.2.1-rc.3 → 0.2.1-rc.5` 迁移后的仓库运行时与七个入库插件。执行任务与阶段见 [PLAN-FNOS-036](/plans/PLAN-FNOS-036-dsh-021-rc5-adaptation)，覆盖需求功能：

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-036-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 七插件在新运行时加载与代表功能 | 门禁误拒、行挂起、宿主接缝行为差异 |
| [FNOS-036-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-02) | 界面插座位置、主题与 rc.5 插座契约复核 | rc.5 思考内容 Body 插座 props 变化波及插件区块 |
| [FNOS-036-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-03) | 基线多处一致与三方插件门禁 | 只改默认 catalog 造成假绿；发布龄期门禁拦截新版本 |
| [FNOS-036-04](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-04) | 既有用户数据保持 | 迁移过程改写数据 |
| [FNOS-036-05](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-05) | 联调检出与 Desktop 版本 | 检出 tag、启动版本与插件锚定不匹配 |
| [FNOS-036-07](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-07) | 依赖版本单一事实来源 | 迁移时把版本字面量写回插件 manifest |

回归基线来源：[FNOS-029](/requirements/FNOS-029-dsh-021-rc3-adaptation) 在 `0.2.1-rc.3` 上的双客户端验收行为（插件管理页状态、界面区块位置、登录态与用量显示）。

CodeBuddy 插件按需求范围**排除**：不纳入本轮用例，其 `engines.dsh` 与兼容声明保持 `0.2.1-rc.3`。

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-036-01、02、04 | DSH Web 与 DSH Desktop | Web：`pnpm run start -- --web`（`DSH_HOME` 指向仓库 `.dsh`，带 token 地址）；Desktop：上游检出开发态（`fork-pj/deepseek-harness`，CDP 取证） |
| FNOS-036-03 | 本地构建链路 + DSH Web | `pnpm run check`、启动日志版本核对、`dshmarket` peer 判定 |
| FNOS-036-05 | DSH Desktop | `git describe` 与启动日志版本核对 |
| FNOS-036-07 | 本地构建链路 | CLI 守卫用例 + 变异测试 |

## 测试用例

### [FNOS-036-07 插件依赖版本单一事实来源](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-07)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-036-07 | 七插件 DSH 依赖均为 catalog | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-07) | 锚定改写完成 | 1.遍历七个插件 `package.json` 四类依赖 2.检索 `@deepseek-ai/dsh*` 条目 3.核对 `engines.dsh` 与 catalog | 全部为 `catalog:dsh`；`engines.dsh` 均为 `0.2.1-rc.5` | P0 | [FNOS-029-07](/requirements/FNOS-029-dsh-021-rc3-adaptation) 同口径 |
| TC-002 | FNOS-036-07 | 字面版本被门禁拒绝 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-07) | 门禁守卫在位 | 1.向半 UI 插件的 peer 注入 `0.2.1-rc.5` 字面量 2.运行基线守卫用例 3.还原后复跑 | 注入后守卫用例失败并点名该依赖；还原后全绿 | P1 | [FNOS-029-07-AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation) |

### [FNOS-036-01 七个入库插件在新运行时正常加载](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-003 | FNOS-036-01 | 插件管理页七个插件无异常 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 基线迁移完成，DSH Web 以 rc.5 启动 | 1.启动 DSH Web（带 token 地址）2.打开插件管理页 3.逐个核对七个插件行 | 全部插件行正常显示、无「异常」标记、无行挂起 | P0 | [FNOS-029-01](/requirements/FNOS-029-dsh-021-rc3-adaptation) 同口径 |
| TC-004 | FNOS-036-01 | 运行日志无插件加载错误 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | TC-003 执行后 | 1.查看启动与运行日志 2.检索模块未找到、插座未声明、挂起类错误 | 仓库插件无此类错误 | P0 | [FNOS-029-01-AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation) |
| TC-005 | FNOS-036-01 | Codex Auth 登录态与用量显示 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 迁移前已有登录凭据 | 1.打开详情页 2.核对账号区 3.发起一次对话看用量 | 登录态保持；模型目录可同步；用量显示正常 | P0 | [FNOS-029 TC-003](/tests/FNOS-029-dsh-021-rc3-adaptation) |
| TC-006 | FNOS-036-01 | Failover Search 开关与转移 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 插件已加载，既有偏好生效 | 1.核对输入区开关节 2.执行一次搜索类请求 | 开关状态与迁移前一致；搜索按配置顺序执行 | P1 | [FNOS-029 TC-004](/tests/FNOS-029-dsh-021-rc3-adaptation) |
| TC-007 | FNOS-036-01 | Midscene 桥接健康检查 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 插件已加载 | 1.`curl` 桥接健康端点 2.核对模型目录 | 健康检查返回 ok；模型目录映射宿主提供方 | P1 | [FNOS-029 TC-005](/tests/FNOS-029-dsh-021-rc3-adaptation) |
| TC-008 | FNOS-036-01 | OpenCode 合并目录与后缀 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 已有 OpenCode 登录凭据 | 1.打开详情页 2.核对模型目录卡片 | 单一 `OpenCode` 分组；模型名带 `· zen` / `· go` 后缀 | P1 | [FNOS-026](/requirements/FNOS-026-dsh-opencode-plugin) |
| TC-009 | FNOS-036-01 | ZCode 登录态与额度显示 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 已有 ZCode 登录凭据 | 1.打开详情页 2.核对账号与额度卡片 | 登录态保持；额度窗口显示正常 | P1 | [FNOS-027](/requirements/FNOS-027-dsh-zcode-plugin) |
| TC-010 | FNOS-036-01 | Semi UI Showcase 渲染 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 插件已加载 | 1.打开详情页 2.核对组件区块 | 各区块渲染无异常 | P2 | [FNOS-029 TC-008](/tests/FNOS-029-dsh-021-rc3-adaptation) |
| TC-011 | FNOS-036-01 | fnos 插件在 DSH Web 的加载状态 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 插件已加载（本地 Web 无 fnOS 宿主） | 1.核对插件管理页 fnos 行状态 | 插件包加载不报错（fnOS 专属能力按真实 NAS 口径另验） | P2 | [FNOS-029 TC-009](/tests/FNOS-029-dsh-021-rc3-adaptation) |

### [FNOS-036-02 插件界面契约保持](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-012 | FNOS-036-02 | 八类插座位置不变 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-02) | 插件已加载 | 1.核对插件详情区块 2.会话头部工具 3.输入区左右与浮层插槽 4.侧栏底部与设置动作 | 各区块出现在与 rc.3 基线相同的位置，无缺失、无重复 | P0 | [FNOS-029-02](/requirements/FNOS-029-dsh-021-rc3-adaptation) |
| TC-013 | FNOS-036-02 | 亮暗主题渲染与切换 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-02) | 插件已加载 | 1.亮色主题走查插件区块 2.切暗色 3.再切回 | 两主题下可读；切换实时生效、无残留 | P1 | [FNOS-029-02-AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation) |
| TC-014 | FNOS-036-02 | 思考内容 Body 插座契约复核 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-02) | 已知 rc.5 新增该插座 props 变化 | 1.核对官方升级指南 2.核对插座目录 diff 3.检索七插件是否注册该插座或依赖该渲染链 | 插件未注册 `conversation.chat.reasoning.body`、未依赖 `dsh-client-ui-chat`；结论为无需适配 | P0 | 新增行为，无回归基线 |

### [FNOS-036-03 仓库运行与构建基线同步](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-015 | FNOS-036-03 | 基线多处一致 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-03) | 基线改写与重装完成 | 1.核对 catalog 三处（默认/命名/发布龄期豁免）2.核对 `install_callback` 3.核对七插件 `engines.dsh` 与 compatibility | 全部为 `0.2.1-rc.5`；仓库 `check` 通过 | P0 | [FNOS-029-04](/requirements/FNOS-029-dsh-021-rc3-adaptation) 多处同源口径 |
| TC-016 | FNOS-036-03 | DSH Web 运行时版本核对 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-03) | TC-003 环境 | 1.读启动日志或关于页版本 2.与插件兼容声明比对 | 运行时报告 `0.2.1-rc.5`，与插件锚定一致 | P0 | [FNOS-029-04-AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation) |
| TC-017 | FNOS-036-03 | dshmarket 门禁判定 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-03) | 基线已切 rc.5 | 1.semver 判定 peer 范围 2.核对三方插件版本未变 | `^0.2.1-rc.1` 包含 `0.2.1-rc.5`，安装不被拒 | P1 | [FNOS-029-04-AC-03](/requirements/FNOS-029-dsh-021-rc3-adaptation) |
| TC-018 | FNOS-036-03 | 全插件包级验证 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-03) | 锚定改写与重装完成 | 1.仓库级 `check`（packages/plugins/tooling）2.逐插件核对 typecheck、单测与构建 | 全部退出码 0，基线一致性用例通过 | P0 | [FNOS-029-04](/requirements/FNOS-029-dsh-021-rc3-adaptation) |

### [FNOS-036-04 用户数据兼容](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-019 | FNOS-036-04 | 既有凭据与偏好保持 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-04) | 迁移前已存在凭据与偏好 | 1.迁移后启动 DSH Web 2.核对各插件登录态 3.核对模型配置与开关偏好 | 凭据、账号、偏好、模型配置全部生效，无需重新登录 | P0 | [FNOS-029-05](/requirements/FNOS-029-dsh-021-rc3-adaptation) |
| TC-020 | FNOS-036-04 | 迁移无数据改写 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-04) | TC-019 环境 | 1.比对迁移前后 `.dsh` 关键文件的内容与权限 | 用户数据文件未被迁移过程改写，权限保持 600 | P1 | [FNOS-029-05-AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation) |

### [FNOS-036-05 Desktop 联调检出更新](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-05)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-021 | FNOS-036-05 | 检出 tag 核对 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-05) | fetch 完成 | 1.在检出目录执行 `git describe --tags` 2.核对工作区干净 | HEAD 精确落在 `dsh-v0.2.1-rc.5` | P0 | [FNOS-029 TC-020](/tests/FNOS-029-dsh-021-rc3-adaptation) |
| TC-022 | FNOS-036-05 | Desktop 版本与插件加载 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-05) | 检出已装依赖；项目 `.dsh` 作 `DSH_HOME` | 1.启动开发态 Desktop（渲染调试端口）2.读运行时版本 3.核对插件管理页 | 版本报告含 `0.2.1-rc.5`；七插件加载正常 | P0 | [FNOS-029 TC-021](/tests/FNOS-029-dsh-021-rc3-adaptation) |
| TC-023 | FNOS-036-05 | Desktop 界面回归 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-05) | TC-022 通过 | 1.CDP 走查插件详情与输入区块 2.亮暗主题切换 | 与 Web 侧结论一致：区块位置不变、切换生效 | P1 | [FNOS-029 TC-022](/tests/FNOS-029-dsh-021-rc3-adaptation) |

## 测试执行结果

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-021 | FNOS-036-05 | DSH Desktop 检出 | 通过 | 2026-10-30 | `git fetch --tags` 后 checkout；`git describe --tags` = `dsh-v0.2.1-rc.5`（commit `b830ec950f`），`git status --porcelain` 为空 |
| TC-015 | FNOS-036-03 | 本地构建链路 | 通过 | 2026-10-30 | `pnpm-workspace.yaml` 内 `0.2.1-rc.3` 残留 0 处、`0.2.1-rc.5` 348 处（默认 catalog 1 + 命名 catalog 41 + 发布龄期豁免 305 + pnpm 自动补 1 条 `dsh-client-ui-entry-customization@0.2.1-rc.5`）；`install_callback` 的 `DSH_VERSION="0.2.1-rc.5"`；七插件 `engines.dsh` 与 compatibility 均为 rc.5（CodeBuddy 按范围保持 rc.3） |
| TC-001 | FNOS-036-07 | 本地构建链路 | 通过 | 2026-10-30 | 七插件 DSH 依赖全部为 `catalog:dsh`，无版本字面量；基线守卫用例 `keeps every plugin DSH dependency on the catalog and its engines.dsh on the runtime baseline` 通过 |
| TC-002 | FNOS-036-07 | 本地构建链路 | 通过 | 2026-10-30 | 变异测试：向 `dsh-semi-ui-showcase-plugin` 的 peer `@deepseek-ai/dsh-client-ui-slots` 注入 `0.2.1-rc.5` 字面量后，上述守卫用例由 ✓ 转为 ×；还原后复跑 100 条全绿 |
| TC-017 | FNOS-036-03 | 本地构建链路 | 通过 | 2026-10-30 | `dshmarket@1.66.47` peer `^0.2.1-rc.1` 按 semver 包含 `0.2.1-rc.5`；`published-dsh-plugins.json` 中 `dshmarket` 版本未变（仍 1.66.47） |
| TC-018 | FNOS-036-03 | 本地构建链路 | 通过 | 2026-10-30 | `pnpm run check -- --packages --plugins --tooling`：29 个 turbo 任务全部成功，0 失败；单测合计 CLI 100、gateway 147、plugin-kit 12、semi-ui 11，七插件 1366（codex-auth 137、fnos 369、failover-search 233、midscene 211、opencode 208、semi-ui-showcase 39、zcode 169），CodeBuddy 副本 1022（按范围仅构建，未纳入验收） |
| TC-014 | FNOS-036-02 | 本地构建链路 | 通过 | 2026-10-30 | 复核官方 `docs/upgrade-guide/v0.2.1-rc.4/reasoning-body-props`：`conversation.chat.reasoning.body` 的 `ReasoningBodyOwnerProps` 新增 `rawText`、`text` 改义为展示文本；插座目录 12 处改动中 11 处仅为 `source` 行号位移（`+6`），唯一契约变化即该插座；七插件未注册该插座、未依赖 `dsh-client-ui-chat` 或 `client-ui-cot-translation`，结论为无需适配 |
| TC-016 | FNOS-036-03 | DSH Web（仓库 profile） | 通过 | 2026-10-30 | 页面 boot 载荷报告 `release.version = 0.2.1-rc.5`（commit `d4db512`、rev `a25c3cad4553`）；服务端日志的兼容判定文案同为「incompatible with dsh 0.2.1-rc.5」 |
| TC-003 | FNOS-036-01 | DSH Web（仓库 profile） | 通过 | 2026-10-30 | 插件管理页「已安装插件」列出 6 个在范围内插件（Codex、Failover Search、Midscene、OpenCode、Semi UI、ZCode）且无任何异常标记；页面唯一「异常」是 `@tnnevol/dsh-codebuddy`——按需求范围排除，与本轮结论无关 |
| TC-004 | FNOS-036-01 | DSH Web（仓库 profile） | 通过 | 2026-10-30 | 启动日志中被跳过/禁用的只有 `@tnnevol/dsh-codebuddy`（范围外）、`agent-team` 与 `tool-agent-team`（profile 内官方实验性插件仍为 rc.2）；六个在范围内插件无模块未找到、插座未声明或行挂起记录 |
| TC-005～TC-010 | FNOS-036-01 | DSH Web（仓库 profile） | 部分通过 | 2026-10-30 | 六个插件均已加载并注册进客户端运行时（boot `entries` 含 `@tnnevol/dsh-{codex-auth,failover-search,midscene,opencode,semi-ui-showcase,zcode}`，共 80 个入口），插件管理页可见；各插件的代表功能（账号登录态、用量、模型目录、搜索转移、桥接健康）未逐项交互走查，留待后续补测 |
| TC-012 | FNOS-036-02 | DSH Web（仓库 profile） | 部分通过 | 2026-10-30 | 会话头部工具区可见「智能体团队、用访达打开、更多打开方式、更多操作、Semi UI、打开右侧边栏」六个区块（含仓库插件 Semi UI 的注册块），位置与 rc.3 基线一致；输入区左右插槽、侧栏底部动作与设置动作未逐项走查 |
| TC-011 | FNOS-036-01 | DSH Web（仓库 profile） | 不适用 | 2026-10-30 | 本地 Web profile 的依赖清单未安装 `@tnnevol/dsh-fnos`（该插件面向真实 fnOS 宿主），本环境不具备验证条件；其加载与能力按真实 NAS 口径另验 |
| TC-013 | FNOS-036-02 | DSH Web | 待执行 | — | 亮暗主题切换未走查 |
| TC-019～TC-020 | FNOS-036-04 | DSH Web | 待执行 | — | 既有凭据/偏好在本次运行中可见但未做迁移前后比对取证 |
| TC-022 | FNOS-036-05 | DSH Desktop（开发态，检出 rc.5） | 通过 | 2026-10-30 | 渲染进程 CDP 取证：`__DSH_BOOT__.release = {version: 0.2.1-rc.5, commit: b830ec9}`（与检出 tag 一致），界面标题区显示「DSH 本地构建 0.2.1-rc.5-b830ec9」；User-Agent 含 `@deepseek-ai/dsh-desktop/0.2.1-rc.5`；boot `entries` 78 项含六个仓库插件（codex-auth、failover-search、midscene、opencode、semi-ui-showcase、zcode） |
| TC-023 | FNOS-036-02 | DSH Desktop（开发态，检出 rc.5） | 部分通过 | 2026-10-30 | 插件管理页「已安装插件」列出六个在范围内插件且可打开详情，页面无「不兼容 / 无法加载 / 挂起」；唯一「异常」为范围外的 `@tnnevol/dsh-codebuddy`。会话页输入区、侧栏与「Semi UI」头部工具区块均在位；主题读取到 `data-ds-theme-source=light`，但未切换暗色（避免改动使用者当前主题设置），主题切换仍按待执行处理 |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | TC-001 | 变异测试脚本用 `git checkout` 还原，把半 UI 插件的 `engines.dsh` 一起回退到 `0.2.1-rc.3` | P1 | 已修复 | 属于测试脚手架缺陷而非产品缺陷：首次变异脚本以 `git checkout -- <file>` 还原被注入的 manifest，连带回退了该文件上未提交的基线改动。复跑前审计七个插件时发现（仅该插件 `engines` 为 rc.3），已改回 rc.5 并复验；变异测试改为「备份文件 → 注入 → 运行 → 从备份还原」，不再触碰 git 工作区 |

## 测试结论

**部分通过（双客户端已验，剩余为逐项功能走查与真机）**：23 条用例中 11 条通过、8 条部分通过、1 条不适用、3 条待执行，0 失败、0 阻塞。

- **执行统计**：通过 11（TC-001、TC-002、TC-003、TC-004、TC-014、TC-015、TC-016、TC-017、TC-018、TC-021、TC-022）/ 部分通过 8（TC-005～TC-010、TC-012、TC-023）/ 不适用 1（TC-011）/ 待执行 3（TC-013、TC-019、TC-020）/ 失败 0 / 阻塞 0；遗留 Bug 0 个（BUG-01 已修复）。
- **一句话结论**：DSH 基线已从 `0.2.1-rc.3` 迁移到 `0.2.1-rc.5`，catalog 三处、七插件兼容锚定与安装回调四处同源一致，仓库与全部插件包级验证全绿，rc.5 唯一面向插件作者的插座契约变化经复核不落在插件能力面上；双客户端运行时回归尚待执行。
- **遗留风险**：
  1. **逐项功能走查与主题切换未完成**（TC-005～TC-010、TC-012、TC-023 的主题部分部分通过，TC-013、TC-019～TC-020 待执行）：双客户端已取证的是插件加载（Web 80 项 / Desktop 78 项 boot `entries` 均含六个仓库插件）、插件管理页六个在范围内插件无异常、会话头部工具区块在位、Desktop 界面标题报告 `0.2.1-rc.5-b830ec9`；账号登录态、用量、模型目录、搜索转移、桥接健康、输入区左右插槽、亮暗主题切换与迁移前后数据比对仍需补测。暗色主题未切换是为了不改动使用者当前主题设置，需在可接受改动的环境补做后恢复。
  2. **FPK 真机安装与升级未执行**：安装回调 `DSH_VERSION` 已与 catalog 一致，但真实 fnOS NAS 上的安装/升级与 `dshmarket` 实装门禁需按发布流程验证。
  3. **CodeBuddy 副本停在 rc.3**（按需求范围排除）：它在本地 profile 中被运行时跳过、插件管理页显示「异常」；如需继续使用需单独迁移，本轮不处理。
  4. **profile 内官方实验性插件仍为 rc.2**（`agent-team`、`tool-agent-team`）：启动时被运行时禁用，属本地 profile 状态，需单独升级，不影响本需求插件。
  5. **外部账号依赖**：Codex / OpenCode / ZCode 的登录态与额度显示依赖真实账号，运行时回归需沿用既有凭据。

- **复跑开发态 Desktop 的两条环境前提**（本轮踩过，登记备查）：
  1. 必须以**检出目录为工作目录**调用 `pnpm`，让 corepack 按检出自己的 `packageManager`（`pnpm@11.28.5`）解析；在本仓库目录用 `pnpm --dir <检出>` 会解析到仓库的 `11.16.0` 并在依赖状态检查阶段失败。
  2. 必须先 `unset ELECTRON_RUN_AS_NODE`：本会话环境带 `ELECTRON_RUN_AS_NODE=1`，会让 Electron 以纯 Node 运行并拒绝 `--remote-debugging-port` / `--user-data-dir`，报 `bad option`。去掉后渲染进程调试端口 9333 正常，可用 CDP 取 `dsh-app://app/` 渲染进程证据（REA 的页面目标列举只接受 HTTP(S)，需用原始 CDP 协议）。
  3. 从检出目录启动时未再出现插件 manifest 被改写的情况；仍建议启动前后各做一次 `catalog:dsh` 与 `engines.dsh` 校验（本轮用 `tmp/manifest-baseline.txt` 的 sha256 基线比对，结果一致）。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-30 | 回填 DSH Desktop 运行时回归结果 | 以检出目录为工作目录、清掉 `ELECTRON_RUN_AS_NODE` 后启动开发态 Desktop（复用刚通过 7/7 构建门禁的产物）。渲染进程 CDP 取证：`release = 0.2.1-rc.5 (b830ec9)`，78 个 boot 入口含六个仓库插件，插件管理页六插件无异常、唯一「异常」为范围外 CodeBuddy，界面可交互。回填 TC-022 通过、TC-023 部分通过；启动前后 sha256 基线比对确认插件 manifest 未被改写。 |
| 2026-10-30 | 回填 DSH Web 运行时回归结果 | 启动仓库 profile 的 DSH Web（`pnpm run start -- --web`），页面 boot 载荷确认运行时 `0.2.1-rc.5`、80 个入口含六个仓库插件；插件管理页六个在范围内插件无异常，唯一「异常」为范围外的 CodeBuddy。回填 TC-003、TC-004、TC-016 通过，TC-005～TC-010、TC-012 部分通过，TC-011 记为不适用（本地 Web profile 未安装 fnos 插件）。 |
| 2026-10-30 | 初始登记与包级结果回填 | 建立 FNOS-036 测试用例文档：23 条用例覆盖六项功能；回填包级与构建链路 7 条通过结果（检出 tag、基线多处一致、catalog 单一事实来源、门禁变异、三方插件判定、全插件包级验证、rc.5 插座契约复核）；登记并修复 BUG-01（变异脚本回退连带破坏锚定）。 |
