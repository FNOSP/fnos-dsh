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
| TC-001 | [FNOS-011-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | 本地单测 | 通过 | 2026-10-10 | `packages/dsh-plugin-kit/tests/credential-permission.spec.ts`：`600` 判定为 `usable`，正常路径行为不变 |
| TC-002 | [FNOS-011-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | 本地单测 | 通过 | 2026-10-10 | `0000` 判定为 `unusable`（属主可读位缺失），不再放行——这是本次判定补全的核心用例 |
| TC-003 | [FNOS-011-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | 本地单测 | 通过 | 2026-10-10 | `644` 仍判定为 `unusable`，既有拒绝语义未回退 |
| TC-004 | [FNOS-011-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | 本地单测 | 通过 | 2026-10-10 | `400`（属主只读）判定为 `usable`——属主可读位存在即满足本判定；边界结论已记录 |
| TC-005 | [FNOS-011-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | 本地单测 | 通过 | 2026-10-10 | 文件不存在（`ENOENT`）判定为 `absent`，与 `unusable` 三态可区分；非 `ENOENT` 的 stat 失败照常上抛 |
| TC-006 | [FNOS-011-01](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-01) | 真实 fnOS NAS | 未执行 | — | ACL 卷现场（共享文件夹 `0000` 经 `cp -p` 复制到 btrfs）需真实 NAS 环境 |
| TC-007 | [FNOS-011-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-02) | — | 未执行 | — | 功能 FNOS-011-02 已废弃（2026-10-10，需修改上游包，不修改官方代码），用例不再执行 |
| TC-008 | [FNOS-011-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-02) | — | 未执行 | — | 随 FNOS-011-02 废弃 |
| TC-009 | [FNOS-011-02](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-02) | — | 未执行 | — | 随 FNOS-011-02 废弃 |
| TC-010 | [FNOS-011-03](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-03) | — | 未执行 | — | 功能 FNOS-011-03 随 FNOS-011-02 一并废弃，用例不再执行 |
| TC-011 | [FNOS-011-03](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-03) | — | 未执行 | — | 随 FNOS-011-03 废弃 |
| TC-012 | [FNOS-011-03](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-03) | — | 未执行 | — | 随 FNOS-011-03 废弃 |
| TC-013 | [FNOS-011-04](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04) | 本地单测 | 通过 | 2026-10-10 | `plugins/dsh-codebuddy-plugin/tests/storage-file-state.spec.ts`：`0000` 时 `storageFileState()` 返回 `unusable` 且 `panelStatus` 载荷带 `credentialState=unusable`（界面据此显示凭据异常警示块）。界面是否真的按此渲染由 TC-013-UI（DSH Web）与 TC-015（DSH Desktop）覆盖 |
| TC-013-UI | [FNOS-011-04](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04) | DSH Web（Midscene Test） | 通过 | 2026-10-15 | 执行载体 `plugins/dsh-codebuddy-plugin/tests/e2e/cases/FNOS-011-credential-permission-ui.yaml`。TC-013a 健康态确认无警示块且面板确已挂载（避免「没有警示块」是因为页面没打开而误判）；**破坏性的 TC-013b（`chmod 000`）与 TC-014a（文件不存在）均已在真实现场执行通过**——分别确认警示块含 `chmod 600` 修复指引、以及文件不存在时呈现未登录且不报异常。这是单测到不了的一环：单测断言 `credentialState` 载荷，界面是否真的按此渲染只有真实浏览器能证 |
| TC-014 | [FNOS-011-04](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04) | 本地单测 | 通过 | 2026-10-10 | 文件不存在（`absent`）时 `panelStatus` 不带 `credentialState`，与既有形状一致，呈现为普通未登录 |
| TC-015 | [FNOS-011-04](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-04) | DSH Desktop | 通过 | 2026-10-15 | `packages/dsh-e2e-desktop/` 三态全部实跑：TC-015a 健康态（3.3s，账号正常显示且无警示块）、TC-015b `chmod 000`（3.5s，警示块含「凭据文件存在但不可读」与 `chmod 600` 指引、账号数 0）、TC-015c 文件不存在（3.4s，呈现「暂无已登录账号」且**不**报权限异常）——两态可区分已在真实 Desktop 上验证。造现场直接改工作区内 `.dsh/codebuddy-auth.json`（Desktop 的 `DSH_HOME` 即指向它），**无需重启 Desktop**：宿主 `panelStatus` 每次都重读文件（`loadStorage` 与 `storageFileState` 均无缓存）；但要**完全离开插件面板**（回会话页）才会重新取数。「两态肉眼是否可辨」属视觉结论，CDP 通道无视觉判定，本轮为人工走查 |
| TC-016 | [FNOS-011-05](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-05) | 本地测试 | 通过 | 2026-10-10 | `tests/permission-predicate-convergence.spec.ts`：剥注释后扫描两插件源码，无 `0o077`／`isOwnerOnly` 手写判定，均引用 `@tnnevol/dsh-plugin-kit` |
| TC-017 | [FNOS-011-05](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-05) | 本地单测 | 通过 | 2026-10-10 | 五种输入（`600`／`644`／`0000`／`400`／不存在）齐备且通过；另覆盖 `440`／`444`／`700` 与文案断言 |
| TC-018 | [FNOS-011-05](/requirements/FNOS-011-credential-permission-diagnostics#fnos-011-05) | 本地测试 | 通过 | 2026-10-10 | 接入插件回归：codebuddy 909 条、codex-auth 137 条全绿，`600` 正常路径行为不变 |

环境版本三元组：DSH `0.2.0-rc.2` / 插件（`@tnnevol/dsh-codebuddy` `0.2.0-rc.2.2`、`@tnnevol/dsh-codex-auth` `0.2.0-rc.2.0`）/ 共享包 `@tnnevol/dsh-plugin-kit` `0.1.0`。

## 自动化用例（可重复执行）

界面结论由 Midscene Test 承载，执行载体在 `plugins/dsh-codebuddy-plugin/tests/e2e/`（DSH Web）
与 `packages/dsh-e2e-desktop/`（DSH Desktop）；本节只登记可重复执行的范围与运行方式。

| 套件 | 通道 | 用例 | 覆盖 |
| --- | --- | --- | --- |
| `plugins/dsh-codebuddy-plugin/tests/e2e/` | Bridge Mode（真实 Chrome） | TC-013a / TC-013b / TC-014a | 健康态无警示块；`0000` 报警示块与 `chmod 600` 指引；文件不存在呈未登录且不报警 |
| `packages/dsh-e2e-desktop/` | 渲染进程 CDP（不移动鼠标、不切前台） | TC-015a / TC-015b / TC-015c | 同上三态，在 DSH Desktop 上验证 |

- **Web 侧运行**（在插件根执行，破坏性用例需临时把配置里的 `tags.exclude` 换成 `tags.include`）：
  ```bash
  DSH_WEB_URL="http://127.0.0.1:8070/?token=…" pnpm run test:e2e
  ```
- **Desktop 侧运行**（在包根 `packages/dsh-e2e-desktop/` 执行）：
  ```bash
  pnpm run test:e2e                      # 只读用例（默认）
  DSH_DESKTOP_DEBUG_PORT=9333 pnpm run test:e2e   # 非默认调试端口
  ```
- **前置**：开发态 Desktop 已在运行（`DSH_HOME` 指向项目根 `.dsh`、profile 为
  `.dsh/profiles/desktop`、带 `DSH_DESKTOP_RENDERER_DEBUG_PORT`），本机 DSH Web 在跑
  （提供 Midscene 桥，端口以 `/v1/health` 为准）。
- **造现场不需要重启 Desktop**：宿主 `panelStatus()` 每次都重读凭据文件
  （`loadStorage` 与 `storageFileState` 均无内存缓存），改完立即生效；但要让界面重新取数，
  必须**完全离开插件面板**（切回会话页）再进入——面板里的「刷新」只刷账号数据，
  只切插件列表页宿主仍复用缓存。
- **TC-015b 与 TC-015c 的现场互斥**（一个是 `chmod 000`、一个是文件不存在），同一轮无法同时成立，
  而 CLI 无 `--case` 参数只能按文件选择，故两者分属不同文件，各自单独运行。
- **不覆盖的部分**：CDP 通道没有视觉判定，「两态肉眼是否可辨」按人工走查登记，不写成自动断言。

- **测试数据清理与 Desktop profile（本次执行的实际状态）**：凭据现场用工作区内的
  `.dsh/codebuddy-auth.json` 构造，跑完已复原为 `600`、内容字节数与账号数均未变
  （备份只在工作区 `tmp/auth-back/`，不留用户目录）；用例不发送消息、不新建持久会话，
  切换过会话的两条用例均在收尾切回原会话，共享包守卫测试强制这一点。
  测试用的 Desktop 为 `fork-pj/deepseek-harness` 开发态实例，`DSH_HOME` 指向项目根 `.dsh`、
  profile 为 `.dsh/profiles/desktop`（**未使用** `~/.dsh/profiles/desktop`）。
  按测试规范，测试结束后该实例应「交还全局 profile」；本次经使用者确认**暂不交还**
  （2026-10-15：使用者仍在使用该窗口，交还需重启实例，故保留现状并在此登记，
  以免读成收尾遗漏）。后续需要时按规范退出该实例并以缺省 `DSH_HOME` 重启即可。



## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| — | — | 尚无记录 | — | — | — |

## 测试结论

**整体结论：部分通过（本地自动化与双客户端界面走查均通过；仅剩真实 NAS 环境类待验收）。**

- 执行用例总数 **19**，通过 **12**，失败 **0**，未执行 **7**（[TC-006](/tests/FNOS-011-credential-permission-diagnostics) 真实 NAS ACL 卷现场、[TC-007~TC-012](/tests/FNOS-011-credential-permission-diagnostics) 对应功能已废弃），遗留 Bug **0**。
- **FNOS-011-01**（判定补全）：本地自动化通过（TC-001~TC-005）。真实 NAS 的 ACL 卷现场（TC-006）待执行。
- **FNOS-011-02/03**：功能**已废弃**（2026-10-10 经维护者确认——两者都需影响上游包 `@deepseek-ai/dsh-credentials-local`，不修改官方代码、不做排期）；对应 6 条用例（TC-007~TC-012）不再执行，保留原文与编号供追溯。
- **FNOS-011-04**（插件区分两态）：判定与载荷由本地单测覆盖（TC-013/TC-014），**界面渲染已在 DSH Web 与 DSH Desktop 两端用真实异常现场走查通过**——Web 侧 TC-013b/TC-014a、Desktop 侧 TC-015a/b/c 均在 `chmod 000` 与「文件不存在」两种现场下确认：不可读时报警示块并给出修复指引，不存在时呈现未登录且不报异常，两者可区分。唯一未由自动化覆盖的是「两态肉眼是否可辨」的视觉结论（CDP 通道无视觉判定），本轮为人工走查。
- **FNOS-011-05**（判定单点收敛）：源码扫描与回归均通过（TC-016~TC-018）。
- 待验收清单：仅剩 [TC-006](/tests/FNOS-011-credential-permission-diagnostics)（真实 NAS 的 ACL 卷现场，需在 fnOS 上执行）。TC-013 界面走查与 TC-015 的 Desktop 两态均已完成。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-09 | 初始登记 | 建立 FNOS-011 测试用例文档，覆盖 FNOS-011-01~05 共 18 条用例：判定三态与边界（TC-001~006，含 ACL 卷现场）、可诊断错误与凭据红线（TC-007~009）、降级不退出（TC-010~012）、插件两态区分（TC-013~015，Web/Desktop 双端）、单点收敛（TC-016~018）。现场构造与恢复约定按测试规范执行。 |
| 2026-10-10 | 执行结果按规范逐条回填 | 原表以「TC-001~005」等区间行合并登记、并使用规范未定义的「废弃」取值，不符合[执行结果表](/charter/tests-spec#执行结果与-bug-记录)要求；改为逐条 6 列（用例ID／功能点／执行环境／结果／执行日期／备注）、结果取值收敛为「通过／失败／阻塞／未执行」，废弃功能对应用例记为「未执行」并在备注说明废弃原因；补环境版本三元组与结论的用例计数。 |
| 2026-10-15 | Desktop 侧三态自动化补齐 | 新增 `packages/dsh-e2e-desktop/` 的 TC-015a/b/c（渲染进程 CDP 通道，不移动鼠标、不切前台），三态全部实跑通过，TC-015 由「部分执行」转为「通过」，FNOS-011-04 的界面走查遗留风险消除。纠正上一版的错误结论：造现场**无需重启 Desktop**——凭据文件在工作区内、Desktop 的 `DSH_HOME` 正指向它，且宿主每次请求都重读；真正的条件是要**完全离开插件面板**才会重新取数。同时补记四条实测坑：可点的是卡片内部的 `button`（祖先链无事件处理器）、「刷新」不刷凭据状态、页面内定时器在后台被节流约 8 倍、幂等守卫会跳过「离开」动作导致断言落在旧状态上；两条破坏性用例现按「记录原会话 + 收尾切回」不留痕（由共享包守卫测试强制） |
