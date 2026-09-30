---
id: FNOS-009
title: FNOS-009 测试用例
description: FNOS-009 DSH 0.2.0-rc.2 插件适配的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-009-dsh-020-rc2-adaptation
plan: /plans/PLAN-FNOS-009-dsh-020-rc2-adaptation
status: 规划中
lastVerified: 2026-09-30
verifiedAt: 2026-09-30
---

# FNOS-009 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-009 |
| 关联需求 | [FNOS-009 DSH 0.2.0-rc.2 插件适配](/requirements/FNOS-009-dsh-020-rc2-adaptation) |
| 关联计划 | [PLAN-FNOS-009 DSH 0.2.0-rc.2 插件适配](/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation) |
| 测试状态 | <Badge type="info" text="规划中" /> |

## 测试范围与需求分析

覆盖 [功能列表](/requirements/FNOS-009-dsh-020-rc2-adaptation#功能列表) 中 FNOS-009-01 至 FNOS-009-11 全部功能：

- 版本重锚定后四插件在 DSH `0.2.0-rc.2` 的加载（[FNOS-009-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-01)）与各插件功能保持（[02](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-02)、[03](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-03)、[04](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-04)、[05](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-05)、[07](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-07)）。
- 用户数据兼容（[FNOS-009-06](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-06)）与文档基线（[FNOS-009-08](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-08)）。
- 授权目录列表持久化与权限校验剔除（[FNOS-009-09](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09)、[FNOS-009-10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10)）。
- 「插入 NAS 文件或目录」选择树父子勾选解耦（[FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11)）。

关键风险点：受控 `value` 与 Semi TreeSelect 内部状态的同步边界；fnOS SDK 授权接口在不同宿主（iframe/独立浏览器/扩展桥）上的行为差异。

❓ 待确认：`@trimjs/web-app` 授权接口在真实 NAS Flutter 壳上的返回形态（[FNOS-009-10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) 执行前确认）。

## 测试环境

目标环境按 [需求的验收环境范围](/requirements/FNOS-009-dsh-020-rc2-adaptation#验收环境范围) 划分：

| 功能 | 目标环境 |
| --- | --- |
| [01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-01)、[03](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-03)、[04](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-04)、[05](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-05)、[07](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-07) | DSH Web、DSH Desktop |
| [02](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-02)、[06（fnOS 部分）](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-06)、[09](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09)、[10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10) | DSH Web + 真实 fnOS NAS |
| [06（其他）](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-06)、[08](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-08) | DSH Web/Desktop、文档站构建环境 |
| [11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | DSH Web |

## 测试用例

### [FNOS-009-11 插入 NAS 引用的父子选择解耦](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11)

实现与核实背景见 [PLAN-FNOS-009 阶段六](/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation#阶段六插入选择树父子解耦t06-01t06-03)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 取消父目录保留已选子项 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 输入框无引用 | 1.打开「插入 NAS 文件或目录」选择树 2.展开一个授权目录 3.勾选父目录与其下一个子项 4.确认子项引用已插入 5.取消父目录勾选 | 父目录引用被移除，子项引用保留且子项仍处于选中状态 | P0 |
| TC-002 | [FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 先选子项后取消父目录 | [AC-02](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 输入框无引用 | 1.打开选择树 2.先只勾选子项 3.再勾选父目录 4.取消父目录 | 子项引用保留、选中状态不变，仅父目录引用移除 | P1 |
| TC-003 | [FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 取消子项不影响父目录 | [AC-03](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 父目录与子项均已选中 | 1.打开选择树 2.取消子项勾选 | 子项引用移除，父目录引用与选中状态保持 | P1 |
| TC-004 | [FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 解耦后重复勾选一致 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | TC-001 执行完成 | 1.重新勾选已取消的父目录 2.再次取消 | 每次操作只影响父目录自身，子项始终保留 | P2 |
| TC-005 | [FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 深层父子链解耦 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 存在三层目录 | 1.勾选第一层与第三层 2.取消第一层 | 第三层引用保留，仅第一层移除 | P2 |

### [FNOS-009-09](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09)/[10 授权目录持久化与权限校验](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10)（规划中，随阶段五回填）

用例随 [T05-01–T05-04](/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation#阶段五授权目录持久化与权限校验t05-01t05-05) 完成后回填，覆盖：持久化写入/读取/失败保留（[09-AC-01~03](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09)）、逐项校验剔除与降级（[10-AC-01~04](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10)）。

### [FNOS-009-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-01)~[08 版本适配与功能保持](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-08)（规划中，随阶段一~三回填）

用例随 [阶段一~三任务](/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation#分阶段任务) 完成后回填，覆盖插件加载、四插件功能回归、升级数据兼容与文档基线。

## 测试执行结果

> 执行后回填；不修改上方用例定义。

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | 尚未执行 |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| — | — | 尚无记录 | — | — | — |

## 测试结论

**尚未执行。** 用例登记后，随 [PLAN-FNOS-009 各阶段](/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation#完成状态) 完成逐步执行；真实 NAS 部分的执行证据登记 `docs/validation/`，本页结论引用该证据。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-09-30 | 初始登记 | 建立 FNOS-009 测试用例文档；先登记 FNOS-009-11 父子解耦用例（对应计划任务已完成实现部分），其余章节随阶段任务回填。 |
| 2026-09-30 | 上下文关联改造 | 功能点、验收条件、计划任务的纯文本表达改为指向需求/计划文档锚点的 markdown 链接。 |
