---
id: FNOS-009
title: FNOS-009 测试用例
description: FNOS-009 DSH 0.2.0-rc.2 插件适配的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-009-dsh-020-rc2-adaptation
plan: /plans/PLAN-FNOS-009-dsh-020-rc2-adaptation
status: 部分通过
lastVerified: 2026-09-30
verifiedAt: 2026-09-30
---

# FNOS-009 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-009 |
| 关联需求 | [FNOS-009 DSH 0.2.0-rc.2 插件适配](/requirements/FNOS-009-dsh-020-rc2-adaptation) |
| 关联计划 | [PLAN-FNOS-009 DSH 0.2.0-rc.2 插件适配](/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation) |
| 测试状态 | <Badge type="info" text="部分通过" /> |

## 测试范围与需求分析

覆盖 [功能列表](/requirements/FNOS-009-dsh-020-rc2-adaptation#功能列表) 中 FNOS-009-01 至 FNOS-009-12 全部功能：

- 版本重锚定后四插件在 DSH `0.2.0-rc.2` 的加载（[FNOS-009-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-01)）与各插件功能保持（[02](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-02)、[03](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-03)、[04](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-04)、[05](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-05)、[07](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-07)）。
- 用户数据兼容（[FNOS-009-06](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-06)）与文档基线（[FNOS-009-08](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-08)）。
- 授权目录列表持久化与权限校验剔除（[FNOS-009-09](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09)、[FNOS-009-10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10)）。
- 「插入 NAS 文件或目录」选择树父子勾选解耦（[FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11)）。
- 插件安装不受新发布阻断（[FNOS-009-12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12)）。

关键风险点：受控 `value` 与 Semi TreeSelect 内部状态的同步边界；fnOS SDK 授权接口在不同宿主（iframe/独立浏览器/扩展桥）上的行为差异。

❓ 待确认：`@trimjs/web-app` 授权接口在真实 NAS Flutter 壳上的返回形态（[FNOS-009-10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) 执行前确认）。

## 测试环境

目标环境按 [需求的验收环境范围](/requirements/FNOS-009-dsh-020-rc2-adaptation#验收环境范围) 划分；执行方式遵循[测试环境执行方式](/charter/tests-spec#测试环境执行方式)：fnOS 插件走真实 NAS，其他插件统一在 `pnpm run start -- --web` 启动的本地 DSH Web（`DSH_HOME` 指向仓库 `.dsh`）中执行。

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| [01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-01)、[03](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-03)、[04](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-04)、[05](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-05)、[07](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-07) | DSH Web、DSH Desktop | Web：`pnpm run start -- --web`（`DSH_HOME=<repo>/.dsh`）；Desktop：客户端内加载插件走查；两者均需覆盖 |
| [02](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-02)、[06（fnOS 部分）](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-06)、[09](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09)、[10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | DSH Web + 真实 fnOS NAS | Web 部分：`pnpm run start -- --web`；fnOS 桥接部分：真实 NAS 部署执行 |
| [06（其他）](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-06)、[08](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-08) | DSH Web/Desktop、文档站构建环境 | Web 走查 + `pnpm run build -- --docs` |
| [11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | DSH Web | `pnpm run start -- --web`（`DSH_HOME=<repo>/.dsh`） |
| [12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 真实 fnOS NAS（安装回调链路）；本地 shell 分支断言 | NAS 部署执行；分支断言走 `packages/fnos-gateway` 本地测试 |

## 测试用例

### [FNOS-009-11 插入 NAS 引用的父子选择解耦](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11)

实现与核实背景见 [PLAN-FNOS-009 阶段六](/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation#阶段六插入选择树父子解耦t06-01t06-03)。

**根因（已在 DSH 源码核实）**：原实现用 `inputActions.setDraft()` 删除引用，而
`@deepseek-ai/dsh-client-ui-conversation` 的 `setDraft()` 会执行 `root.clear()` 后按纯文本重建
整个编辑器文档——**所有引用 chip 都会被销毁**，因此取消父目录会连带清掉子项的引用。
修复改为 `inputActions.insertText('', span)` 只替换目标 chip 自身的原子跨度，其余 chip 的节点与
`occurrenceId` 保持不变。跨度换算（剪贴板投影 → detect 投影）由纯函数
`fnosOccurrenceDetectSpan()` 承担，删除计划由 `planFnosOccurrenceRemovals()` 生成，
两者都可独立测试。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 取消父目录保留已选子项 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 输入框无引用 | 1.打开「插入 NAS 文件或目录」选择树 2.展开一个授权目录 3.勾选父目录与其下一个子项 4.确认子项引用已插入 5.取消父目录勾选 | 父目录引用被移除，子项引用保留且子项仍处于选中状态 | P0 |
| TC-002 | [FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 先选子项后取消父目录 | [AC-02](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 输入框无引用 | 1.打开选择树 2.先只勾选子项 3.再勾选父目录 4.取消父目录 | 子项引用保留、选中状态不变，仅父目录引用移除 | P1 |
| TC-003 | [FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 取消子项不影响父目录 | [AC-03](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 父目录与子项均已选中 | 1.打开选择树 2.取消子项勾选 | 子项引用移除，父目录引用与选中状态保持 | P1 |
| TC-004 | [FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 解耦后重复勾选一致 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | TC-001 执行完成 | 1.重新勾选已取消的父目录 2.再次取消 | 每次操作只影响父目录自身，子项始终保留 | P2 |
| TC-005 | [FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 深层父子链解耦 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 存在三层目录 | 1.勾选第一层与第三层 2.取消第一层 | 第三层引用保留，仅第一层移除 | P2 |

### [FNOS-009-12 插件安装不受新发布阻断](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12)

实现与验证见 [PLAN-FNOS-009 阶段七](/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation#阶段七插件安装发布日期放行统一t07-01t07-02)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-006 | [FNOS-009-12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 自有插件新版首次安装放行 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 自有插件未安装 | 1.在 NAS 上安装应用 2.观察插件安装阶段日志 | 自有插件按清单版本安装成功，不出现发布日期拒绝导致的失败消息 | P0 |
| TC-007 | [FNOS-009-12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 自有插件从旧版升级放行 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 已安装旧版自有插件 | 1.升级应用到含新插件版本的 FPK 2.观察插件安装阶段日志 | 旧版收敛到清单版本且安装成功，不因新版发布日期过近中断 | P0 |
| TC-008 | [FNOS-009-12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 历史同包名残留场景 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | profile 内存在同名旧版本的历史放行记录 | 1.安装应用并触发多插件依次安装 2.观察是否出现列表条目校验失败 | 多个插件连续安装全部成功，无「lockfile 校验失败」类报错 | P0 |
| TC-009 | [FNOS-009-12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 失败原因可诊断 | [AC-02](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 可构造插件安装失败的场景 | 1.令某插件安装失败 2.查看安装回调日志与向导提示 | 失败以非零退出并给出具体原因，不提示用户手动解除发布日期限制或清理缓存 | P1 |
| TC-010 | [FNOS-009-12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 手动安装默认策略不变 | [AC-03](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 应用已安装 | 1.在插件市场或 DSH 插件管理中手动安装一个刚发布的插件 | 手动安装入口的默认安全策略未被放宽，行为与应用安装回调内的处理相互独立 | P1 |
| TC-011 | [FNOS-009-12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 归档替换路径不回归 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 存在 FPK 内置插件归档 | 1.以含 `bundled-dsh-plugins` 归档的 FPK 安装/升级 | 归档替换仍走先移除后添加，与清单版本收敛一致，无新增失败 | P1 |
| TC-012 | [FNOS-009-12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 同版本重复安装幂等 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 自有插件版本已与清单一致 | 1.再次安装同版本 FPK 2.观察插件阶段日志 | 版本一致时跳过安装且不报错，不产生重复安装副作用 | P2 |
| TC-013 | [FNOS-009-12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 三方插件放行不回归 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 三方插件未安装或版本不一致 | 1.安装/升级应用 2.观察三方插件安装日志 | 三方插件安装与版本收敛保持既有放行行为，未被本次改动破坏 | P2 |

### [FNOS-009-09 授权目录列表持久化](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09)

实现与核实背景见 [PLAN-FNOS-009 阶段五](/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation#阶段五授权目录持久化与权限校验t05-01t05-05)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-014 | [FNOS-009-09](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09) | 老用户升级后字段缺省安全 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09) | settings 中无 `authorizedDirectories` | 1.以空 settings 构造 schema 2.读取该字段 | 校验通过且解引用为空数组，不抛错 | P0 |
| TC-015 | [FNOS-009-09](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09) | 持久化写入去重保序 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09) | 传入含重复项的路径列表 | 1.调用写入 2.读取返回值 | 重复项合并、首次出现顺序保留，写入指定命名空间 | P1 |
| TC-016 | [FNOS-009-09](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09) | 持久化列表优先展示 | [AC-02](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09) | 持久化有目录、实时查询为空 | 1.以空实时列表加载 | 持久化目录仍出现在展示列表中 | P0 |
| TC-017 | [FNOS-009-09](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09) | 写入失败不影响当前会话 | [AC-03](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09) | 写入接口返回错误 | 1.触发持久化写入失败 2.观察页面 | 只记日志、页面不报错，既有数据不被清空 | P1 |

### [FNOS-009-10 持久化目录权限校验与剔除](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-018 | [FNOS-009-10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | 共享接口通过即保留 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | 持久化含一个共享目录 | 1.共享接口返回 ok 2.执行校验 | 该项保留，且不再调用用户目录接口（无弹窗） | P0 |
| TC-019 | [FNOS-009-10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | 用户目录接口兜底 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | 共享接口拒绝该路径 | 1.共享接口返回 ok=false、用户接口返回 ok 2.执行校验 | 该项判定为通过并保留 | P1 |
| TC-020 | [FNOS-009-10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | 两个接口都拒绝则剔除 | [AC-02](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | 两个接口都返回 ok=false | 1.执行校验 2.观察剔除清单 | 该项进入剔除清单并从展示移除，同步回写持久化 | P0 |
| TC-021 | [FNOS-009-10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | 桥接不可用不剔除 | [AC-04](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | 接口返回 `undefined` 或调用抛错 | 1.执行校验 | `available=false`、剔除清单为空、全部路径按保留返回 | P0 |
| TC-022 | [FNOS-009-10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | 恢复授权后可重新持久化 | [AC-03](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | 目录曾被剔除 | 1.在 fnOS 侧重新授权 2.经「添加/刷新」操作目录 | 目录重新进入列表并被持久化 | P1 |

### [FNOS-009-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-01)~[08 版本适配与功能保持](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-08)（规划中，随阶段一~三回填）

用例随 [阶段一~三任务](/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation#分阶段任务) 完成后回填，覆盖插件加载、四插件功能回归、升级数据兼容与文档基线。

## 测试执行结果

> 执行后回填；不修改上方用例定义。非 fnOS 插件功能按[测试环境执行方式](/charter/tests-spec#测试环境执行方式)要求 **DSH Web 与 DSH Desktop 各执行一次、按客户端分列**；仅 Web 或仅 Desktop 的结果不构成该用例的完成结论。

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-006 | [FNOS-009-12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 本地 shell 分支断言 | 通过 | 2026-09-30 | 自有插件首次安装走放行调用，`bundled-plugin-install.spec.ts` 断言 |
| TC-007 | [FNOS-009-12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 本地 shell 分支断言 | 通过 | 2026-09-30 | 自有插件版本收敛走放行调用 |
| TC-008 | [FNOS-009-12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 本地 pnpm 11.7.0 端到端 | 通过 | 2026-09-30 | 复刻「历史同包名残留 + 新发布版本」：旧逻辑第 2 个包报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`（与 NAS 日志逐字一致），新逻辑三个包全部装成功 |
| TC-012 | [FNOS-009-12](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-12) | 本地 shell 分支断言 | 通过 | 2026-09-30 | 同版本保持不重复安装 |
| — | [FNOS-009-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-01) | 本机 DSH Web 0.2.0-rc.2 | 通过（DSH Web） | 2026-09-30 | 证据见 [本地 Web 验证记录](/validation/FNOS-009-local-web-2026-09-30) |
| — | [FNOS-009-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-01) | DSH Desktop 自带运行时 0.2.0-rc.2 | 通过（Desktop 运行时） | 2026-09-30 | 三插件无「异常」、详情页正常、控制台无错；证据见 [Desktop 运行时验证记录](/validation/FNOS-009-desktop-runtime-2026-09-30)；真实 NAS 待补。**该次使用隔离探针 profile，不满足项目 profile 约束，已被下一行的结论取代** |
| — | [FNOS-009-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-01) | **DSH Desktop（真实 Electron 壳 + 项目 profile）** | **通过（DSH Desktop）** | **2026-10-06** | 环境版本：Desktop `0.2.0-rc.2`（Electron 44）/ 内置运行时 `0.2.0-rc.2` / 插件 `0.2.0-rc.2.0`；`DSH_HOME=<repo>/.dsh`、profile 为 `.dsh/profiles/desktop`；已安装 3 个插件，「异常」「不兼容」均 0 次；CDP 取证，证据见 [Desktop 验证记录](/validation/FNOS-009-desktop-cdp-2026-10-06)；**收尾：已退出项目 profile 的 Desktop 并以缺省 `DSH_HOME` 重启，交还全局 profile（未产生测试账号，无需清理）** |
| — | [FNOS-009-04](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-04) | **DSH Desktop（真实 Electron 壳 + 项目 profile）** | **部分通过** | **2026-10-06** | 版本徽章 `v0.2.0-rc.2.0`、「共 1 个 · 1 运行中」；账号管理区渲染正常（6 个账号、额度 1468/1609、已签到）；登录与用量待复验 |
| — | [FNOS-009-03](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-03) | 本机 DSH Web 0.2.0-rc.2 | 部分通过 | 2026-09-30 | AC-02 模型目录与分组弹层正常；登录与用量待复验 |
| — | [FNOS-009-05](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-05) | 本机 DSH Web 与 Desktop 运行时 | 通过 | 2026-09-30 | 两处运行时上展示页与组件分组均正常渲染；证据见本地 Web 与 Desktop 运行时验证记录 |
| — | [FNOS-009-05](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-05) | **DSH Desktop（真实 Electron 壳 + 项目 profile）** | **通过** | **2026-10-06** | 插件通过兼容门禁并正常加载，插件页与详情页无异常；逐组件渲染结论见 [本地 Web 验证记录](/validation/FNOS-009-local-web-2026-09-30) |
| TC-014–TC-017 | [FNOS-009-09](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09) | 单测（schema/宿主持久化） | 通过 | 2026-09-30 | 字段缺省、去重保序、持久化优先、写入失败保留 |
| TC-001–TC-005 | [FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 单测（删除计划与跨度换算） | 通过 | 2026-09-30 | 取消父目录只移除父项跨度；反向、取消子项、重复勾选、三层链均覆盖；浏览器走查待补 |
| TC-018–TC-022 | [FNOS-009-10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | 单测（SDK 校验服务） | 通过 | 2026-09-30 | 逐项通过/剔除、桥接不可用降级；真实 NAS 桥接待复验 |
| TC-023 | [FNOS-009-10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | 单测（卡片级剔除编排） | 通过 | 2026-09-30 | 只读项不参与校验、桥接不可用不剔除、剔除后保持展示顺序、无可校验项不构造 SDK |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | TC-008 | 自有插件的新发布版本被 pnpm 发布日期限制阻断应用安装（fnOS NAS 实测） | P0 | 已修复 | 由 FNOS-009-12 实现：安装回调内自有与三方插件统一使用受控 release-age 例外；真实 NAS 复验待补 |
| BUG-02 | — | 上游已移除 `dsh-agent-presets`、`dsh-code-runtime`，`0.2.0-rc.2` 下无对应版本 | P2 | 已修复 | 从 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 剔除这两个条目；二者已无依赖方 |

## 测试结论

**部分通过。** 执行用例 26 条：通过 24、部分通过 2、失败 0。

已完成：
- 四插件版本重锚定与全量单测——**1451 项全部通过**（插件 1352、网关 98、CLI 36 等，含 fnOS 插件 232 项）。
- FNOS-009-12 的 pnpm 端到端复验：复刻 NAS 失败现场，旧逻辑报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`，
  新逻辑三个包全部装成功。
- FNOS-009-01、03、05 的 DSH Web 实测；FNOS-009-01、04、05 的 **DSH Desktop 真实 Electron 壳**实测（项目 profile + CDP 取证）。
- FNOS-009-06 的数据兼容：升级前写入的凭据、偏好、工作区与会话在升级后保持。
- FNOS-009-09/10/11 的本地单测（持久化读写、逐项校验剔除与降级、卡片级剔除编排、选择树父子解耦）。
- FNOS-009-09 的**运行时验证**：打包后装入 DSH Desktop 自带运行时，实测持久化路由写入成功并落盘。

未完成（需真实 fnOS NAS 或桌面壳内操作）：
- fnOS 插件在真实 NAS 上的功能与数据兼容（FNOS-009-02、06 的 fnOS 部分、09/10 的 SDK 桥接）。
- Codex Auth 与 CodeBuddy 的真实登录/用量走查（FNOS-009-03/04 的账号相关验收）：Desktop 侧已验账号管理区与额度渲染，登录流程与用量数据待复验。
- **Desktop 暗色主题未覆盖**：按 [UI 测试规范](/charter/tests-spec#ui-测试视觉与样式)要求 UI 用例应在亮暗两主题各执行一遍，本次只采集到亮色主题。
- **Desktop 宿主差异点未逐一走查**：外部链接经系统默认浏览器打开（`setWindowOpenHandler` 语义）、OAuth 授权回流、设置页呈现。规范明确「行为以 Desktop 实测为准，不以 Web 结果外推」，故这些点不能由 Web 结论替代。
- FNOS-009-11 的浏览器实机走查：本仓库无 jsdom/happy-dom 与 lexical，无法建 DOM 渲染测试；
  解耦逻辑已作为纯函数覆盖（含删除计划与跨度换算），但「挂载后的编辑器接受该跨度且
  子项 occurrenceId 保持稳定」这一环仅通过阅读 DSH 源码验证，需人工在运行中的 DSH Web 上走查。
- FNOS-009-07 的上游增量变化逐项走查清单。

真实 NAS 执行证据按规范登记 `docs/validation/`，本页结论引用该证据。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-09-30 | 初始登记 | 建立 FNOS-009 测试用例文档；先登记 FNOS-009-11 父子解耦用例（对应计划任务已完成实现部分），其余章节随阶段任务回填。 |
| 2026-09-30 | 上下文关联改造 | 功能点、验收条件、计划任务的纯文本表达改为指向需求/计划文档锚点的 markdown 链接。 |
| 2026-09-30 | 登记 FNOS-009-12 用例 | 新增 TC-006–TC-013，覆盖自有与三方插件安装放行、历史残留场景、失败可诊断、手动安装策略不变与归档替换不回归；测试范围与环境同步到 FNOS-009-12。用例先登记，执行结果待阶段七完成后回填。 |
| 2026-09-30 | 回填首轮执行结果 | 回填 FNOS-009-01/03/05 的 DSH Web 实测与 FNOS-009-12 分支级结果；登记 BUG-01（自有插件被发布日期阻断）与 BUG-02（上游包移除）。结论更新为「部分通过」，未完成项与目标环境证据缺口列在结论中。 |
| 2026-10-06 | 回填 Desktop 真实壳执行结果 | 按[DSH Desktop 测试](/charter/tests-spec#dsh-desktop-测试)的项目 profile 约束，在真实 Electron 壳内用 CDP 取证，新增 FNOS-009-01/04/05 的 DSH Desktop 执行结果；2026-09-30 那次隔离探针结论因不满足 profile 约束被标注为已被取代。未完成项补充 Desktop 暗色主题与宿主差异点。证据见 [Desktop 验证记录](/validation/FNOS-009-desktop-cdp-2026-10-06)。 |
