---
id: PLAN-FNOS-012
title: PLAN-FNOS-012 CodeBuddy 模型倍速展示与客户端版本更新
description: 实施 FNOS-012，为 /model 模型列表窗口补充倍速展示，并将 CLI/WorkBuddy 客户端版本指纹更新到官方当前版本。
status: planned
owner: tnnevol
planDate: 2026-10-09
targetVersion: 5.7.0
lastVerified: 2026-10-09
---

# PLAN-FNOS-012 CodeBuddy 模型倍速展示与客户端版本更新

| 字段 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-012 |
| 计划日期 | 2026-10-09 |
| 对应需求 | [FNOS-012 CodeBuddy 模型倍速展示与客户端版本更新](/requirements/FNOS-012-codebuddy-model-speed-and-client-version) |
| 本轮功能 | FNOS-012-01（模型列表展示倍速）、FNOS-012-02（CLI `2.163.0` / WorkBuddy `5.77`） |
| 计划状态 | <Badge type="info" text="规划中" /> |

## 计划目标

实现 FNOS-012-01 与 FNOS-012-02：`/model` 模型列表窗口中可见模型倍速；插件客户端版本指纹与官方当前版本一致。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| 倍速展示 | `modelInfo()` 已把目录 `credits` 写入 `LlmModelInfo.description`；composer 模型选择组件只渲染 `name`，`description` 在 `/model` 列表窗口不可见 | 按 `description` 的官方语义让模型列表窗口展示倍速（官方 composer 组件不支持时，用插件可用的座位/补丁方式承载），展示位置与样式在实现时确定 | 仅展示层；模型路由、目录解析不变 |
| 版本指纹 | `CODEBUDDY_CLI_VERSION = '2.159.0'`、WorkBuddy `'5.6.2'`（`contracts/constants.ts`，进入 `risk-headers` 的 User-Agent 等指纹） | CLI `'2.163.0'`、WorkBuddy `'5.77'` | 常量替换；请求头指纹随常量生效；无数据迁移 |

## 影响范围分析

| 需求功能 | 代码模块 | 配置/数据 | 测试 | 文档 | 目标环境 |
| --- | --- | --- | --- | --- | --- |
| FNOS-012-01 | `plugins/dsh-codebuddy-plugin`（模型信息展示相关 Client/Host 代码） | 无 | 倍速展示单测（有/无/`x0.00` 三态） | 如有用户可见说明则更新插件文档 | DSH Web、DSH Desktop |
| FNOS-012-02 | `plugins/dsh-codebuddy-plugin/src/contracts/constants.ts`、`host/risk-headers.ts` 消费处 | 无 | 版本常量断言与风控头指纹测试更新 | — | DSH Web、DSH Desktop |

不涉及：DSH 官方源码、模型路由与预算逻辑、积分计费、登录流程与已保存凭据、其他插件。

## 分阶段任务

### 阶段一：实现与验证（T01-01–T01-03）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-012-T01-01 | FNOS-012-01 / AC-01、AC-02 | 让 `/model` 模型列表窗口可见倍速：优先复用 `description` 已承载的 `credits` 值确定展示路径（官方组件能力核实后在计划变更记录登记结论）；保持无倍速条目不显示、`x0.00` 照常展示 | T01-02 或并行 | 单测三态断言；本地 Web 走查 |
| PLAN-FNOS-012-T01-02 | FNOS-012-01 / AC-03 | 展示样式：DSH 语义变量、亮暗主题下可读、不与名称/选中态重叠 | 无 | Web 走查（亮/暗各一遍） |
| PLAN-FNOS-012-T01-03 | FNOS-012-02 / AC-01、AC-02 | `CODEBUDDY_CLI_VERSION` → `'2.163.0'`、WorkBuddy → `'5.77'`；更新受影响的指纹断言测试 | 无 | 常量/指纹单测通过；真实账号回归登录、对话、用量 |

### 阶段二：目标环境验收（T02-01）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-012-T02-01 | FNOS-012-01、02 全部 AC | DSH Desktop 验收：模型列表倍速可见、版本指纹一致、既有凭据继续有效 | 阶段一完成 | Desktop 走查证据登记 `docs/validation/` |

## 数据、权限和错误处理

- 不新增持久化、不改凭据与用户数据；版本常量变更不影响已保存登录态。
- 倍速仅为展示元数据，不参与路由与预算。

## 依赖、风险和决策

| 项 | 内容 | 应对 |
| --- | --- | --- |
| 风险：composer 官方模型选择组件不渲染 `description` 且无座位可注入 | 已核实「只渲染 `name`」为缺失原因；具体展示路径（官方能力 vs 插件座位/补丁）在 T01-01 核实后定案 | 无法走官方能力时，用插件已有接缝承载展示并登记决策；不修改 DSH 官方源码 |
| 风险：版本指纹更新触发服务端风控行为差异 | 版本为官方当前在用版本，与官方客户端对齐 | T01-03 真实账号回归；异常时回退常量 |
| 决策：版本值取用户提供的官方当前版本 | CLI `2.163.0`、WorkBuddy `5.77` | — |
| 回滚 | 常量回退到 `2.159.0`/`5.6.2`；展示改动按插件独立回退 | 无数据风险 |

## 测试、打包、发布和回滚

- 包级：`dsh-codebuddy` typecheck、单测、构建；倍速三态与版本指纹断言。
- DSH Web：`pnpm run start -- --web` 本地走查模型列表（亮/暗主题各一遍）。
- DSH Desktop：按[测试用例文档规范](../charter/tests-spec.md#dsh-desktop-测试)使用项目 `.dsh/profiles/desktop`。
- 回滚：单插件回退，无用户数据影响。

## 参考资料

- 需求调研结论：[FNOS-012 调研结论](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#调研结论)
- `CodeBuddyModel.credits` 类型：`plugins/dsh-codebuddy-plugin/src/types/host/types.d.ts`
- `modelInfo()` 倍速映射与既有注释：`plugins/dsh-codebuddy-plugin/src/host/adapter.ts`
- 版本常量与指纹：`plugins/dsh-codebuddy-plugin/src/contracts/constants.ts`、`plugins/dsh-codebuddy-plugin/src/host/risk-headers.ts`

## 完成状态

| 阶段 | 状态 |
| --- | --- |
| 阶段一：实现与验证 | <Badge type="info" text="规划中" /> |
| 阶段二：目标环境验收 | <Badge type="info" text="规划中" /> |

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-09 | 初始计划 | 建立 PLAN-FNOS-012，覆盖 FNOS-012-01/02；倍速字段与版本常量位置已在插件源码核实，composer 渲染路径核实为 T01-01 前置任务。 |
