---
id: PLAN-FNOS-050
title: PLAN-FNOS-050 fnOS 插件「依赖修复」
description: 依赖修复的实施计划：环境推导、只读诊断、三步修复、详情页卡片与 tip 气泡，以及安全边界与验证方式。
status: in-review
owner: tnnevol
planDate: 2026-11-07
targetVersion: 8.1.4
lastVerified: 2026-11-07
---

# PLAN-FNOS-050 fnOS 插件「依赖修复」

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-050 |
| 计划日期 | 2026-11-07 |
| 对应需求 | [FNOS-050 fnOS 插件增加「依赖修复」](/requirements/FNOS-050-dependency-repair) |
| 计划状态 | 待验收 |

## 计划目标

按 [FNOS-050](/requirements/FNOS-050-dependency-repair) 的四个功能编号，在 fnOS 插件详情页落地「依赖修复」：只读诊断先行、一键修复须二次确认，tip 气泡同时说明用途与安全边界。

技术边界：只改 `plugins/dsh-fnos-plugin`（新增契约、宿主诊断与修复、路由、卡片、文案）；不改 pnpm 策略，不改上游 DSH。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 影响 |
| --- | --- | --- | --- |
| 入口 | 无 | 详情页 `plugins.detail.section` 新增卡片（`order: 50`，排在授权目录之后） | 排障有明确去处 |
| 用途说明 | 无 | 标题旁 info 图标 + tip 气泡 | 用户知道何时该用、也不用担心丢数据 |
| 诊断 | 无 | 只读解析 `minimumReleaseAgeExclude` 与发布清单比对 | 先看问题再决定 |
| 修复 | 只能手工执行四条命令 | 清失效条目 → `pnpm clean --lockfile` → `pnpm install` → 装回清单内插件 | 一条路径一个按钮 |
| 环境定位 | 无 | 从 `DSH_HOME`、`NPM_CONFIG_PREFIX`、`TRIM_APPDEST` 推导 | 不扫描目录、不猜测路径 |

## 关键约束

- **只读优先**：诊断不写文件、不调 pnpm。合并成一步会让排障变成盲目的破坏性按钮。
- **只动可重建产物**：`pnpm-lock.yaml` 与 `node_modules`；`isRebuildableArtifact` 按 basename 守卫。
- **不替用户维护清单外的插件**：诊断只对发布清单内的包判定失效；修复第 3 步也只装清单内的插件。用户自己装的插件与其豁免条目不碰。
- **错误码不进句子**：本插件的翻译函数只做静态键查表，没有占位符替换，因此动态值（版本号、耗时、失败原因）作为独立片段拼接，不引入第二套文案机制。
- **同源校验**：两条路由都拒绝跨站请求——修复会删 `node_modules`，不能让外部页面触发。

## 实施任务

| 编号 | 任务 | 对应功能 | 写入范围 |
| --- | --- | --- | --- |
| T1 | 契约：路由常量、诊断/修复结果类型 | 全部 | `src/contracts/dependency-repair-contract.ts` |
| T2 | 宿主：环境推导、解析、失效判定、删行、修复执行 | FNOS-050-02、03、04 | `src/host/dependency-repair.ts` |
| T3 | 路由：诊断（POST/GET）与修复（POST），同源校验 | FNOS-050-02、03 | `src/host/dependency-repair-routes.ts` |
| T4 | 客户端调用层 | 全部 | `src/client/services/dependency-repair-client.ts` |
| T5 | 卡片：tip 气泡、检查/修复两步、二次确认弹窗、结果明细 | FNOS-050-01、03 | `src/components/DependencyRepairCard.tsx` |
| T6 | 接线与九语言文案 | 全部 | `src/index.ts`、`src/client/index.ts`、`src/client/locales*.ts` |
| T7 | 单元测试：环境推导、解析、判定、删行、只读性、守卫 | FNOS-050-02、04 | `tests/host/dependency-repair.spec.ts` |
| T8 | Manifest 的 `desc` 与 `changelog` 同步（九语言） | 全部 | `apps/fn-deepseek-harness/i18n/*` |

## 风险与回滚

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 误删用户数据 | 不可接受 | 只走 `pnpm clean --lockfile`（自带 basename 校验）；单元测试钉住守卫与「诊断不改文件」 |
| 修复中途失败 | 依赖树处于中间态 | 分步记录状态，前一步失败不再继续；已成功的清条目步骤本身无害，可重试 |
| 重建期间应用不可用 | 短暂不可用 | 确认弹窗明确告知 |
| 清单外的插件被卷进来 | 覆盖用户选择 | 第 3 步只读清单内的包；诊断同样只判清单内的包 |
| 非 fnOS 环境误显示 | 用户困惑 | 无 `DSH_HOME` 时诊断返回 `fnos-host-unavailable`，卡片显示可读原因而非报错 |

回滚：移除卡片注册与路由注册即可；契约与宿主模块可一并删除，无数据迁移。

## 验证计划

| 层次 | 方式 |
| --- | --- |
| 单元 | `pnpm run test`（含新增 20 条） |
| 类型与构建 | `pnpm run typecheck`、`pnpm run build` |
| 文案一致性 | 九语言键数一致（各 157） |
| 界面 | DSH Web 走查：tip 气泡、检查结果、确认弹窗 |
| 真机 | 构建 FPK → 应用中心正常安装 → 在详情页点「检查」，确认能报出真实失效条目（只读，不改 NAS 文件） |
