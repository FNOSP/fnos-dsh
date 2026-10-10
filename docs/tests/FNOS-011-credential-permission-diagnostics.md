---
id: FNOS-011
title: FNOS-011 测试用例
description: FNOS-011 凭据文件权限异常的可诊断性测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-011-credential-permission-diagnostics
plan: /plans/PLAN-FNOS-011-credential-permission-diagnostics
status: 执行中
lastVerified: 2026-10-10
verifiedAt: 2026-10-10
---

# FNOS-011 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-011 |
| 关联需求 | [FNOS-011 凭据文件权限异常的可诊断性](/requirements/FNOS-011-credential-permission-diagnostics) |
| 关联计划 | [PLAN-FNOS-011 凭据文件权限异常的可诊断性](/plans/PLAN-FNOS-011-credential-permission-diagnostics) |
| 测试状态 | <Badge type="tip" text="自动化已执行（Web 侧）" /> |

## 测试范围与需求分析

覆盖 [功能列表](/requirements/FNOS-011-credential-permission-diagnostics#功能列表) 中 FNOS-011-01 至 FNOS-011-05 全部功能：

- 凭据可用性判定覆盖属主可读位（[FNOS-011-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01)）。
- DSH 凭据不可读时的可诊断错误（[FNOS-011-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-02)）。
- 凭据失败不导致整个 DSH Web 退出（[FNOS-011-03](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-03)）。
- 插件区分「未登录」与「凭据不可读」（[FNOS-011-04](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04)）。
- 权限判定逻辑单点收敛（[FNOS-011-05](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-05)）。

关键风险点：真实 NAS 上需构造 `chmod 000` 现场且不能破坏用户真实凭据（先备份后构造）；fnOS ACL 文件系统（共享文件夹显示 `0000`）与 DSH_HOME btrfs 卷的语义差异；判定条件不得回退既有拒绝语义。

## 测试环境

目标环境按 [需求的验收环境范围](/requirements/FNOS-011-credential-permission-diagnostics#验收环境范围) 划分；执行方式遵循[测试环境执行方式](/charter/tests-spec#测试环境执行方式)：

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| [01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01)、[04](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04)、[05](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-05) | DSH Web、DSH Desktop | Web：`pnpm run start -- --web`（`DSH_HOME=<repo>/.dsh`）；Desktop：项目 `.dsh/profiles/desktop`；两者均需覆盖 |
| [02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-02)、[03](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-03) | 真实 fnOS NAS | 内网 NAS 桌面 `http://192.168.119.6:5666/`；构造现场后走真实启动链路，日志从 `/var/log/apps/fn-deepseek-harness.log` 取证 |

**现场构造与恢复约定**（强约束，全部用例通用）：

- 测试 profile 内构造凭据文件异常前，先按[账号状态测试顺序与 auth 配置备份](/charter/tests-spec#账号状态测试顺序与-auth-配置备份)备份原凭据到 `tmp/plugin-backup/`；测试结束恢复为 `600` 并逐文件核对权限。
- 构造方式为对**测试 profile 或测试实例**的凭据文件执行 `chmod 000`（属主不可读现场），不使用模拟数据替代。
- 凭据文件一律不入仓库；NAS 侧凭据路径与权限位可记录，凭据内容不得记录。

## 测试用例

### [FNOS-011-01 凭据可用性判定覆盖属主可读位](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01)

实现见 [PLAN-FNOS-011 T01-01](/plans/PLAN-FNOS-011-credential-permission-diagnostics#分阶段任务)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-011-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | `600` 判定为可用 | [AC-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | 凭据文件权限 `600` | 1.调用共享权限判定 2.读取结果 | 判定为「可用」，正常路径行为不变 | P0 | 基线：[正常路径 `mode: 0o600` 写入](/requirements/FNOS-011-credential-permission-diagnostics#调研结论) |
| TC-002 | [FNOS-011-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | `0000` 判定为不可用 | [AC-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01)、[AC-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | 凭据文件权限 `0000` | 1.调用共享权限判定 2.读取结果 | 判定为「不可用」（属主可读位缺失），不再放行 | P0 | 新增行为，无回归基线 |
| TC-003 | [FNOS-011-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | `644` 仍判定为不可用（既有语义不回退） | [AC-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | 凭据文件权限 `644` | 1.调用共享权限判定 | 判定为「不可用」，既有拒绝语义不回退 | P0 | 基线：[上游 assertOwnerOnly 既有拒绝语义](/requirements/FNOS-011-credential-permission-diagnostics#调研结论) |
| TC-004 | [FNOS-011-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | `400`（属主只读）边界判定 | [AC-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | 凭据文件权限 `400` | 1.调用共享权限判定 2.读取结果 | 属主可读位存在但属主不可写；按判定实现给出的三态结论核对（不可用或可用与实现一致），记录边界结论 | P2 | 新增行为，无回归基线 |
| TC-005 | [FNOS-011-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | 文件不存在判定为「不存在」 | [AC-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | 凭据文件不存在 | 1.调用共享权限判定 | 判定为「不存在」，与「存在但不可读」三态可区分 | P0 | 基线：[isENOENT 之外必须暴露的既有立场](/requirements/FNOS-011-credential-permission-diagnostics#调研结论) |
| TC-006 | [FNOS-011-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | ACL 文件系统下的 `0000` 现场复现 | [AC-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | 真实 NAS，共享文件夹（ACL 卷） | 1.在共享文件夹放置凭据文件（传统位显示 `0000`）2.`cp -p` 到 DSH_HOME（btrfs）3.对 DSH_HOME 中的副本调用判定 | 判定为「不可用」并给出修复指引（跨卷复制保留异常权限位的真实场景） | P1 | 基线：[真机 `cp -p` 保留 `0000` 的复现记录](/requirements/FNOS-011-credential-permission-diagnostics#调研结论) |

### [FNOS-011-02 DSH 凭据不可读时给出可诊断错误](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-02)

> <Badge type="danger" text="废弃（2026-10-10）" /> 功能 FNOS-011-02 经维护者确认废弃、不做排期（影响上游包，不修改官方代码）；本组用例随之废弃，不再执行。保留原文供追溯。

实现见 [PLAN-FNOS-011 T03-01](/plans/PLAN-FNOS-011-credential-permission-diagnostics#分阶段任务)（已废弃）。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-007 | [FNOS-011-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-02) | 真机 `0000` 启动日志可诊断 | [AC-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-02) | 真实 NAS，已备份原凭据 | 1.备份 `.credentials.yaml` 到 `tmp/plugin-backup/` 2.`chmod 000` 3.启动应用 4.读取 `/var/log/apps/fn-deepseek-harness.log` | 日志错误点明权限问题，含文件路径、当前权限位 `0000` 与修复命令（如 `chmod 600 <路径>`） | P0 | 基线：[真实 NAS 启动失败事件（错误只有一行 EACCES）](/requirements/FNOS-011-credential-permission-diagnostics#需求背景) |
| TC-008 | [FNOS-011-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-02) | 错误信息不含凭据内容 | [AC-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-02) | TC-007 的现场 | 1.检查日志与界面诊断文本 | 只引用文件路径与权限位，不出现凭据内容片段 | P0 | 新增行为，无回归基线 |
| TC-009 | [FNOS-011-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-02) | 修复命令可执行且有效 | [AC-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-02) | TC-007 现场 | 1.复制日志中的修复命令执行 2.重启应用 | 命令执行成功；重启后凭据正常加载，无权限错误 | P1 | 新增行为，无回归基线 |

### [FNOS-011-03 凭据失败不导致整个 DSH Web 退出](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-03)

> <Badge type="danger" text="废弃（2026-10-10）" /> 功能 FNOS-011-03 随 FNOS-011-02 一并废弃、不做排期；本组用例不再执行。保留原文供追溯。

实现见 [PLAN-FNOS-011 T03-02](/plans/PLAN-FNOS-011-credential-permission-diagnostics#分阶段任务)（已废弃）。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-010 | [FNOS-011-03](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-03) | 凭据 `0000` 时应用可打开 | [AC-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-03) | 真实 NAS，凭据 `0000`（TC-007 现场） | 1.启动应用 2.打开 DSH Web 界面 | 应用不再以 code 1 退出；界面可见凭据异常提示与修复指引 | P0 | 基线：[升级链路事件——原表现为只显示「DSH Web 未运行」恢复页](/requirements/FNOS-011-credential-permission-diagnostics#需求背景) |
| TC-011 | [FNOS-011-03](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-03) | 修复后能力恢复 | [AC-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-03) | TC-010 现场 | 1.按提示执行修复 2.重启/刷新 3.验证依赖凭据的能力 | 凭据正常加载；登录态、账号等依赖凭据的能力恢复可用 | P0 | 新增行为，无回归基线 |
| TC-012 | [FNOS-011-03](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-03) | 降级不删除凭据 | [AC-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-03) | TC-010 现场 | 1.降级运行期间检查凭据文件 | 凭据文件仍存在且未被删除或改写；应用不做自动 `chmod` | P1 | 基线：[行为约束——不自动修复权限](/requirements/FNOS-011-credential-permission-diagnostics#行为约束) |

### [FNOS-011-04 插件区分「未登录」与「凭据不可读」](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04)

实现见 [PLAN-FNOS-011 T02-01](/plans/PLAN-FNOS-011-credential-permission-diagnostics#分阶段任务)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-013 | [FNOS-011-04](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04) | 插件凭据 `0000` 提示异常 | [AC-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04) | DSH Web（测试 profile），备份 `codebuddy-auth.json` 后 `chmod 000` | 1.打开 CodeBuddy 插件详情页 2.观察账号区 | 界面提示凭据异常与修复方式，不再静默呈现为「未登录」 | P0 | 基线：[同一模式曾表现为账号列表静默变空](/requirements/FNOS-011-credential-permission-diagnostics#需求背景) |
| TC-014 | [FNOS-011-04](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04) | 凭据不存在仍呈现「未登录」 | [AC-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04) | 凭据文件不存在 | 1.移除（非 chmod）凭据文件 2.打开插件详情页 | 呈现为「未登录」不报错；与「凭据不可读」两种情形可区分 | P0 | 基线：[现有未登录呈现](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04) |
| TC-015 | [FNOS-011-04](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04) | Desktop 端同样区分两种情形 | [AC-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04)、[AC-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04) | DSH Desktop（项目 `.dsh/profiles/desktop`） | 1.分别构造 `0000` 与文件不存在 2.观察插件呈现 | Desktop 与 Web 结论一致：`0000` 报凭据异常，不存在报未登录 | P1 | 新增行为，无回归基线 |

### [FNOS-011-05 权限判定逻辑单点收敛](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-05)

实现见 [PLAN-FNOS-011 T01-02](/plans/PLAN-FNOS-011-credential-permission-diagnostics#分阶段任务)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-016 | [FNOS-011-05](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-05) | 插件统一引用共享判定 | [AC-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-05) | 仓库源码 | 1.源码扫描各插件凭据权限判定实现 | 均引用同一共享实现；无各插件重复实现的判定条件 | P1 | 新增行为，无回归基线 |
| TC-017 | [FNOS-011-05](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-05) | 五种输入的单测齐备 | [AC-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-05) | 共享判定实现 | 1.检查共享判定的单测覆盖 | `600`、`644`、`0000`、`400`、文件不存在五种输入均有用例且通过 | P0 | 新增行为，无回归基线 |
| TC-018 | [FNOS-011-05](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-05) | 接入插件回归无破坏 | [AC-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-05) | 接入共享判定的插件 | 1.运行接入插件的既有测试套件 | 既有测试全部通过，正常路径（`600`）行为不变 | P1 | 基线：接入插件既有测试套件 |

## 测试执行结果

> 执行后回填；不修改上方用例定义。非 fnOS 插件功能按[测试环境执行方式](/charter/tests-spec#测试环境执行方式)要求 **DSH Web 与 DSH Desktop 各执行一次、按客户端分列**；仅 Web 或仅 Desktop 的结果不构成该用例的完成结论。

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001~005 | FNOS-011-01 | DSH Web（本地单测注入 stat） | 通过 | 2026-10-10 | `packages/dsh-plugin-kit/tests/credential-permission.spec.ts` 12 条：`600`/`644`/`0000`/`400`/`440`/`444`/`700`、ENOENT→absent、非 ENOENT 上抛、文案断言 |
| TC-006 | FNOS-011-01 | 真实 NAS（ACL 卷现场） | 待执行 | — | 需真实 fnOS 环境 |
| TC-007~009 | FNOS-011-02 | 真实 NAS | 废弃 | 2026-10-10 | 功能废弃，不再执行 |
| TC-010~012 | FNOS-011-03 | 真实 NAS | 废弃 | 2026-10-10 | 功能废弃，不再执行 |
| TC-013（自动化部分） | FNOS-011-04 | DSH Web（本地单测） | 通过 | 2026-10-10 | `plugins/dsh-codebuddy-plugin/tests/storage-file-state.spec.ts` 5 条：absent/600/0000/644 三态 + panelStatus 载荷区分；界面走查与 Desktop 复核待验收 |
| TC-014 | FNOS-011-04 | DSH Web | 通过（自动化部分） | 2026-10-10 | absent 时 panelStatus 不带 credentialState，与既有形状一致 |
| TC-015 | FNOS-011-04 | DSH Desktop | 待执行 | — | 需 Desktop 环境 |
| TC-016 | FNOS-011-05 | 本地源码扫描 | 通过 | 2026-10-10 | `tests/permission-predicate-convergence.spec.ts`：两插件源码剥注释后无 `0o077`/`isOwnerOnly`，均引用共享包 |
| TC-017 | FNOS-011-05 | 本地单测 | 通过 | 2026-10-10 | 五种输入齐备（见 TC-001~005 备注） |
| TC-018 | FNOS-011-05 | 本地回归 | 通过 | 2026-10-10 | codebuddy 909 条、codex-auth 137 条全绿 |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| — | — | 尚无记录 | — | — | — |

## 测试结论

**自动化部分已通过（2026-10-10），真实 NAS 与 Desktop 部分待验收。**

- FNOS-011-01/04/05 的本地自动化全部通过（共享判定 12 条 + 插件三态 5 条 + 收敛守门 2 条，插件全量 909+137 回归绿）。
- FNOS-011-02/03 已随功能废弃，对应用例不再执行。
- 待验收：TC-006（NAS ACL 现场）、TC-013 界面走查与 TC-015（Desktop）。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-09 | 初始登记 | 建立 FNOS-011 测试用例文档，覆盖 FNOS-011-01~05 共 18 条用例：判定三态与边界（TC-001~006，含 ACL 卷现场）、可诊断错误与凭据红线（TC-007~009）、降级不退出（TC-010~012）、插件两态区分（TC-013~015，Web/Desktop 双端）、单点收敛（TC-016~018）。现场构造与恢复约定按测试规范执行。 |
