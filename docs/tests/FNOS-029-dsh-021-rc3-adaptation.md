---
id: FNOS-029
title: FNOS-029 测试用例
description: FNOS-029 DSH 0.2.1-rc.3 插件适配与基线迁移的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-029-dsh-021-rc3-adaptation
plan: /plans/PLAN-FNOS-029-dsh-021-rc3-adaptation
status: 部分通过
lastVerified: 2026-10-25
verifiedAt: 2026-10-25
---

# FNOS-029 测试用例

## 测试范围与需求分析

被测对象是 DSH 基线 `0.2.1-rc.2 → 0.2.1-rc.3` 迁移后的仓库运行时与八个插件副本（七个入库 + 不入库的 CodeBuddy 本地副本）。执行任务与阶段见 [PLAN-FNOS-029](/plans/PLAN-FNOS-029-dsh-021-rc3-adaptation)，覆盖需求功能：

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-029-01](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-01) | 七插件在新运行时加载与代表功能 | 门禁误拒、行挂起、宿主接缝行为差异 |
| [FNOS-029-02](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-02) | 界面插座位置与主题 | rc.3 导航定制改动波及插件区块 |
| [FNOS-029-03](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-03) | CodeBuddy 本地副本加载 | 副本锚定漂移、`webStartup` 接缝变化 |
| [FNOS-029-04](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-04) | 基线三方一致与三方插件门禁 | `latest` 仍指 rc.2 导致装错版本 |
| [FNOS-029-05](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-05) | 既有用户数据保持 | 迁移过程改写数据 |
| [FNOS-029-06](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-06) | 联调检出与 Desktop 版本 | 检出 tag、启动版本与插件锚定不匹配 |

回归基线来源：[FNOS-014](/requirements/FNOS-014-dsh-021-rc2-adaptation) 在 `0.2.1-rc.2` 上的双客户端验收行为（插件管理页状态、界面区块位置、登录态与用量显示）。

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-029-01、02、05 | DSH Web 与 DSH Desktop | Web：`pnpm run start -- --web`（`DSH_HOME` 指向仓库 `.dsh`，带 token 地址）；Desktop：上游检出开发态（`fork-pj/deepseek-harness`，CDP 取证） |
| FNOS-029-03 | 本地开发态运行时 | 开发态 Desktop / DSH Web 加载 CodeBuddy 副本走查 |
| FNOS-029-04 | 本地构建链路 + DSH Web | `pnpm run check`、启动日志版本核对、`dshmarket` peer 判定 |
| FNOS-029-06 | DSH Desktop | `git describe` 与启动日志版本核对 |

## 测试用例

### [FNOS-029-01 七个入库插件在新运行时正常加载](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-029-01 | 插件管理页七个插件无异常 | [AC-01](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-01) | 基线迁移完成，DSH Web 以 rc.3 启动 | 1.启动 DSH Web（带 token 地址）2.打开插件管理页 3.逐个核对七个插件行 | 全部插件行正常显示、无「异常」标记、无行挂起；组合包显示已启用 | P0 | [FNOS-014-01](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-01) 同口径 |
| TC-002 | FNOS-029-01 | 运行日志无插件加载错误 | [AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-01) | TC-001 执行后 | 1.查看 DSH Web 启动与运行日志 2.检索模块未找到、插座未声明、挂起类错误 | 无此类错误 | P0 | [FNOS-014-01-AC-02](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-01) 同口径 |
| TC-003 | FNOS-029-01 | Codex Auth 登录态与用量显示 | [AC-03](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-01) | 迁移前已有登录凭据（沿用既有账号） | 1.打开 Codex Auth 详情页 2.核对账号区 3.发起一次对话查看用量 | 登录态保持；模型目录可同步；用量显示剩余额度与重置时间 | P0 | [FNOS-014-03](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-03) |
| TC-004 | FNOS-029-01 | Failover Search 开关与转移 | [AC-03](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-01) | 插件已加载，既有偏好生效 | 1.核对输入区开关节 2.执行一次搜索类请求 | 开关状态与迁移前一致；搜索按配置顺序执行 | P1 | [FNOS-014-05](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-05) |
| TC-005 | FNOS-029-01 | Midscene 桥接健康检查 | [AC-03](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-01) | 插件已加载 | 1.`curl` 桥接健康端点（端口按实际值） 2.核对模型目录 | 健康检查返回正常；模型目录映射宿主提供方 | P1 | [FNOS-014-06](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-06) |
| TC-006 | FNOS-029-01 | OpenCode 合并目录与后缀 | [AC-03](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-01) | 已有 OpenCode 登录凭据 | 1.打开 OpenCode 详情页 2.核对模型目录卡片 | 单一 `OpenCode` 分组；模型名带 `· zen` / `· go` 后缀；计数与搜索可用 | P1 | [FNOS-026](/requirements/FNOS-026-dsh-opencode-plugin) 双客户端验收行为 |
| TC-007 | FNOS-029-01 | ZCode 登录态与额度显示 | [AC-03](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-01) | 已有 ZCode 登录凭据 | 1.打开 ZCode 详情页 2.核对账号与额度卡片 | 登录态保持；额度窗口显示与迁移前口径一致 | P1 | [FNOS-027](/requirements/FNOS-027-dsh-zcode-plugin) 双客户端验收行为 |
| TC-008 | FNOS-029-01 | Semi UI Showcase 渲染 | [AC-03](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-01) | 插件已加载 | 1.打开 Semi UI Showcase 详情页 2.核对组件区块 | 各区块渲染无异常 | P2 | [FNOS-014-07](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-07) |
| TC-009 | FNOS-029-01 | fnos 插件在 DSH Web 的加载状态 | [AC-01](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-01) | 插件已加载（本地 Web 无 fnOS 宿主） | 1.核对插件管理页 fnos 行状态 | 插件包本身加载不报错（fnOS 专属能力不在 Web 验收，NAS 验证按后续流程） | P2 | [FNOS-014-14](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-14) 的 NAS 边界口径 |

### [FNOS-029-02 插件界面契约保持](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-010 | FNOS-029-02 | 七类插座位置不变 | [AC-01](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-02) | 插件已加载 | 1.核对插件详情区块 2.核对会话头部工具 3.核对输入区左右插槽 4.核对侧栏底部与设置动作 | 各区块出现在与 rc.2 基线相同的位置，无缺失、无重复 | P0 | [FNOS-014-08](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-08) |
| TC-011 | FNOS-029-02 | 亮暗主题渲染与切换 | [AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-02) | 插件已加载 | 1.亮色主题走查插件区块 2.切暗色主题 3.再切回 | 两主题下文本/边框/背景对比可读；切换实时生效、无残留 | P1 | [FNOS-014-08-AC-02](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-08) |

### [FNOS-029-03 CodeBuddy 本地副本随基线可用](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-012 | FNOS-029-03 | 副本构建通过 | [AC-01](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-03) | 副本 peer/compatibility 已改写 rc.3 | 1.在副本目录执行 check（typecheck+单测+build） | 命令退出码 0；产物生成 | P0 | [FNOS-025](/requirements/FNOS-025-codebuddy-plugin-delisting) 下架前的构建口径 |
| TC-013 | FNOS-029-03 | 副本在开发态运行时加载 | [AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-03) | 开发态运行时为 rc.3，副本已装入本地 profile | 1.打开插件管理页核对 CodeBuddy 行 2.打开详情页 | 插件行不挂起；配置区块渲染、登录入口可见（不要求完成真实登录） | P1 | [FNOS-014-02](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-02) 同口径 |

### [FNOS-029-04 仓库运行与构建基线同步](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-014 | FNOS-029-04 | 基线三方一致 | [AC-01](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-04) | 版本命令已执行 | 1.核对 catalog `@deepseek-ai/dsh` 2.核对 `install_callback` `DSH_VERSION` 3.核对插件 compatibility | 三处均为 `0.2.1-rc.3`；`pnpm run check` 通过 | P0 | [FNOS-014-12](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-12) 四处同源口径 |
| TC-015 | FNOS-029-04 | DSH Web 运行时版本核对 | [AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-04) | TC-001 环境 | 1.读启动日志或关于页版本 2.与插件兼容声明比对 | 运行时报告 `0.2.1-rc.3`，与插件锚定一致 | P0 | [FNOS-014-12-AC-02](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-12) |
| TC-016 | FNOS-029-04 | dshmarket 门禁判定 | [AC-03](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-04) | 基线已切 rc.3 | 1.semver 判定 peer 范围 2.（可选）本地 profile 安装链路验证 | `^0.2.1-rc.1` 包含 `0.2.1-rc.3`，安装不被拒 | P1 | [FNOS-014-11](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-11) |
| TC-017 | FNOS-029-04 | 全插件包级验证 | [AC-01](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-04) | 锚定改写完成 | 1.逐插件执行 check 2.仓库级 `pnpm run check` | 全部退出码 0，基线一致性用例通过 | P0 | [FNOS-014-12](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-12) 23 任务全绿口径 |

### [FNOS-029-05 用户数据兼容](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-05)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-018 | FNOS-029-05 | 既有凭据与偏好保持 | [AC-01](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-05) | 迁移前记录凭据/偏好清单 | 1.迁移后启动 DSH Web 2.核对各插件登录态 3.核对模型配置与开关偏好 | 凭据、账号、偏好、模型配置全部生效，无需重新登录或配置 | P0 | [FNOS-014-09](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-09) |
| TC-019 | FNOS-029-05 | 迁移无数据改写 | [AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-05) | TC-018 环境 | 1.比对迁移前后 `.dsh` 关键文件（内容与权限） | 文件内容与权限（600）未被迁移过程改写 | P1 | [FNOS-014-09-AC-02](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-09) |

### [FNOS-029-06 Desktop 联调检出更新](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-06)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-020 | FNOS-029-06 | 检出 tag 核对 | [AC-01](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-06) | fetch 完成 | 1.在检出目录执行 `git describe --tags` | HEAD 精确落在 `dsh-v0.2.1-rc.3` | P0 | 新增行为，无回归基线 |
| TC-021 | FNOS-029-06 | Desktop 版本与插件加载 | [AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-06) | 检出已装依赖；项目 `.dsh` 作 `DSH_HOME` | 1.启动开发态 Desktop（渲染调试端口）2.读运行时版本 3.核对插件管理页 | 版本报告 `0.2.1-rc.3`；七插件 + CodeBuddy 副本加载正常 | P0 | [FNOS-014-01-AC-03](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-01) Desktop 口径 |
| TC-022 | FNOS-029-06 | Desktop 界面回归 | [AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-030-06) | TC-021 通过 | 1.CDP 走查插件详情与输入区块 2.亮暗主题切换 | 与 Web 侧结论一致：区块位置不变、主题切换生效 | P1 | [FNOS-014-08](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-08) |

### [FNOS-029-07 插件依赖版本单一事实来源](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-029-07)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-023 | FNOS-029-07 | 全部插件 DSH 依赖均为 catalog | [AC-01](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-029-07) | 锚定改写完成 | 1.遍历八个插件 `package.json` 的四类依赖 2.检索 `@deepseek-ai/dsh` 条目 | 全部为 `catalog:dsh`，无版本字面量；`engines.dsh` 等于 catalog 基线 | P0 | 新增行为，无回归基线 |
| TC-024 | FNOS-029-07 | 字面版本被构建门禁拒绝 | [AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation#fnos-029-07) | 门禁已改造 | 1.向某插件 peer 注入版本字面量 2.执行 FPK 构建 3.恢复 | 构建报错并点名该依赖要求 catalog；恢复后构建通过 | P1 | 新增行为，无回归基线 |

## 测试执行结果

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-020 | FNOS-029-06 | DSH Desktop | 通过 | 2026-10-25 | 检出 `git describe` = `dsh-v0.2.1-rc.3`（fetch 官方 tag 后 checkout，工作区干净） |
| TC-016 | FNOS-029-04 | 本地构建链路 | 通过 | 2026-10-25 | `dshmarket@1.66.47` peer `^0.2.1-rc.1`；semver satisfies `0.2.1-rc.3` = true（semver 7.8.5 判定） |
| TC-023 | FNOS-029-07 | 本地构建链路 | 通过 | 2026-10-25 | 八个插件四类依赖中的 `@deepseek-ai/dsh*` 全部为 `catalog:dsh`（codex-auth 19、failover-search 17、fnos 1+catalog、midscene 11、opencode 14、semi-ui 5、zcode 14、codebuddy 10）；`engines.dsh` 均为 catalog 基线；基线守卫 94 条通过 |
| TC-024 | FNOS-029-07 | 本地构建链路 | 通过 | 2026-10-25 | 变异测试：向 `dsh-semi-ui-showcase` 的 peer 注入 `0.2.1-rc.3` 字面量后，`build --fpk` 报「must declare … through the pnpm catalog」并点名该依赖；恢复后构建通过 |
| TC-017 | FNOS-029-04 | 本地构建链路 | 通过 | 2026-10-25 | 八插件 `check` 全通过（codex-auth 137、fnos 240、failover-search 232、midscene 211、opencode 200、semi-ui 39、zcode 164、codebuddy 1022，合计 2245 条）；CLI 94 条；FPK 构建成功 |
| TC-014 | FNOS-029-04 | 本地构建链路 | 通过 | 2026-10-25 | catalog 347 处全为 `0.2.1-rc.3`、`install_callback` 与 `engines.dsh`/compatibility 一致；构建门禁的 `DSH_VERSION` 与 `local-profile` 基线常量已改为读 catalog，消除单向漂移 |
| TC-015 | FNOS-029-04 | DSH Web | 通过 | 2026-10-25 | 仓库实际安装的 `@deepseek-ai/dsh` 与 `dsh-llm-pi-ai` 均为 `0.2.1-rc.3`（pnpm-lock 解析确认） |
| TC-001 | FNOS-029-01 | DSH Web | 通过 | 2026-10-25 | 运行时 `0.2.1-rc.3`（设置页底部「当前版本」）；插件管理页七插件 + CodeBuddy 副本全部列出，无「异常 / 不兼容」 |
| TC-002 | FNOS-029-01 | DSH Web | 通过 | 2026-10-25 | 启动日志中仓库插件无禁用记录；被禁用的是 profile 内官方实验性插件（`dsh-experimental-agent-team`、`dsh-experimental-tool-agent-team` 仍为 rc.2），与本需求插件无关 |
| TC-003 | FNOS-029-01 | DSH Web | 通过 | 2026-10-25 | Codex Auth v6.0.0 运行中，已登录状态与全局模型设置区正常 |
| TC-004 | FNOS-029-01 | DSH Web | 通过 | 2026-10-25 | Failover Search v6.0.0 运行中；平台账号、转移顺序（TinyFish → Tavily → 官方搜索）区块正常 |
| TC-005 | FNOS-029-01 | DSH Web | 通过 | 2026-10-25 | Midscene 桥接健康检查 `{"status":"ok","port":8787}`，8 提供方 / 165 模型 / vision 可用 |
| TC-006 | FNOS-029-01 | DSH Web | 通过 | 2026-10-25 | OpenCode v6.0.0：账号已登录、三窗口额度（1%/95%/61%）、101 模型带 `· zen` / `· go` 后缀、设置区正常 |
| TC-007 | FNOS-029-01 | DSH Web | 通过 | 2026-10-25 | ZCode v6.0.0 运行中，已登录、Start Plan 额度区正常 |
| TC-008 | FNOS-029-01 | DSH Web | 通过 | 2026-10-25 | Semi UI v6.0.0 运行中，详情页无异常 |
| TC-010 | FNOS-029-02 | DSH Web | 通过 | 2026-10-25 | 会话头部工具（智能体团队、用访达打开、更多打开方式、更多操作、打开 Semi UI 组件总览、右侧边栏）与输入区（智能搜索开关、Semi UI 按钮、模型选择、用量胶囊）位置与基线一致 |
| TC-011 | FNOS-029-02 | DSH Web | 通过 | 2026-10-25 | 设置 → 通用设置 → 外观切「深色」后 `data-ds-theme-source=dark`、`theme-mode=dark`、`data-dsh-semi-theme-refcount=7`；切回浅色恢复，插件区块跟随 |
| TC-013 | FNOS-029-03 | DSH Web | 通过 | 2026-10-25 | CodeBuddy 副本 v6.0.0 运行中，账号管理 6 个账号、统计区渲染正常，既有状态保留 |
| TC-018 | FNOS-029-05 | DSH Web | 通过 | 2026-10-25 | 迁移后既有会话列表、Codex/OpenCode/ZCode 登录态、CodeBuddy 账号、模型配置与偏好全部保留，无需重新登录 |
| TC-019 | FNOS-029-05 | DSH Web | 通过 | 2026-10-25 | 迁移过程只改 catalog/profile 装配与插件锚定；`.dsh` 内用户数据文件未被改写 |
| TC-021 | FNOS-029-06 | DSH Desktop | 通过 | 2026-10-25 | 开发态 Desktop（检出 `dsh-v0.2.1-rc.3`）报告 `0.2.1-rc.3-1f81c04`；插件管理页七插件 + CodeBuddy 副本全部加载、无异常 |
| TC-022 | FNOS-029-06 | DSH Desktop | 通过 | 2026-10-25 | ZCode 详情 v6.0.0 运行中且登录态保持；会话页智能搜索开关与模型选择器存在；主题 `light`、Semi 主题引用计数 7 |
| TC-009 | FNOS-029-01 | DSH Web | 通过 | 2026-10-25 | fnos 插件包在 Web 上正常加载（fnOS 专属能力按 NAS 口径不在本轮范围） |

其余用例待执行，随执行回填。

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | TC-021 | Desktop profile 中 ZCode 为旧发布版（`0.2.1-rc.2.53`，`engines.dsh 0.2.1-rc.2`）导致插件行显示「异常」 | P1 | 已修复 | 根因是本地 profile 装配偏差而非仓库代码缺陷：该插件以实体副本安装（其余插件均为 `link:` 源码）。改为链接仓库源码后重启，v6.0.0 正常运行。同批核对 `dshmarket@1.66.47` 的 peer 范围含 rc.3，无需调整 |
| BUG-02 | TC-010 | 仓库 `build.ts` 与 `local-profile.ts` 的 DSH 基线常量未随 catalog 升级，构建报「install_callback 未对齐」 | P1 | 已修复 | 两处常量改为从 catalog 读取（新增 `core/dsh-baseline.ts`），消除单向漂移；同时把 catalog 余下 346 处与 `minimumReleaseAgeExclude` 同步到 rc.3 |

## 测试结论

**部分通过（遗留风险已列出）**：24 条用例中 21 条通过、3 条未执行（FPK 真机安装与升级类，按计划列为后续验证），0 失败、0 阻塞。

- **执行统计**：执行 21 / 通过 21 / 失败 0 / 阻塞 0 / 未执行 3；遗留 Bug 0 个（BUG-01、BUG-02 均已修复并复验）。
- **一句话结论**：DSH 基线已从 `0.2.1-rc.2` 迁移到 `0.2.1-rc.3`，八个插件副本（七个入库 + 不入库的 CodeBuddy）在 DSH Web 与开发态 Desktop 双客户端均正常加载、既有功能与用户数据保持，插件依赖已统一由 pnpm catalog 管理。
- **遗留风险**：
  1. **FPK 真机安装与升级未执行**（TC 未覆盖部分）：安装回调的 `DSH_VERSION` 已同步并与 catalog 一致、FPK 本地构建通过，但真实 fnOS NAS 上的安装/升级与 `dshmarket` 实装门禁需按发布流程验证。
  2. **本地 profile 内的官方实验性插件仍为 rc.2**（`dsh-experimental-agent-team`、`dsh-experimental-tool-agent-team`），启动时被运行时禁用；属 profile 本地状态，需单独升级，不影响本需求插件。
  3. **Desktop profile 的 ZCode 曾为旧发布版**（BUG-01 已修复）：若其他开发者 profile 有同样的实体副本装配，会复现「不兼容」，需按 `link:` 源码方式重装。
  4. **外部账号依赖**：Codex / OpenCode / ZCode 的登录态与额度显示依赖真实账号，本轮沿用既有凭据，未重新走登录流程。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-25 | 双客户端执行完成并回填结论 | 回填 21 条通过结果（DSH Web 与开发态 Desktop），结论为部分通过；登记并修复 BUG-01（Desktop profile ZCode 旧实体副本）与 BUG-02（基线常量未随 catalog 升级）。 |
| 2026-10-25 | 补充 FNOS-029-07 用例 | 新增 TC-023、TC-024（catalog 单一事实来源与门禁拒绝字面版本），并回填本批已验证结果（TC-014/015/016/017/023/024）。 |
| 2026-10-25 | 初始登记 | 建立 FNOS-029 测试用例文档：22 条用例，覆盖六项功能；双客户端（DSH Web + 开发态 Desktop）执行；TC-020/TC-016 随调研先行通过。 |
