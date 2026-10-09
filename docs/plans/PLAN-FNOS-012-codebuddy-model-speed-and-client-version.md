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
| 本轮功能 | FNOS-012-01（模型列表展示倍速）、FNOS-012-02（CLI `2.163.0` / WorkBuddy `5.77`）、FNOS-012-03（profile 移除 `minimumReleaseAgeExclude` 自愈） |
| 计划状态 | <Badge type="info" text="规划中" /> |

## 计划目标

实现 FNOS-012-01/02/03：`/model` 模型列表窗口中可见模型倍速；插件客户端版本指纹与官方当前版本一致；DSH web profile 安装/升级时自动移除 `minimumReleaseAgeExclude` 残留并重建依赖。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| 倍速展示 | `modelInfo()` 已把目录 `credits` 写入 `LlmModelInfo.description`；composer 模型选择组件只渲染 `name`，`description` 在 `/model` 列表窗口不可见 | 按 `description` 的官方语义让模型列表窗口展示倍速（官方 composer 组件不支持时，用插件可用的座位/补丁方式承载），展示位置与样式在实现时确定 | 仅展示层；模型路由、目录解析不变 |
| 版本指纹 | `CODEBUDDY_CLI_VERSION = '2.159.0'`、WorkBuddy `'5.6.2'`（`contracts/constants.ts`，进入 `risk-headers` 的 User-Agent 等指纹） | CLI `'2.163.0'`、WorkBuddy `'5.77'` | 常量替换；请求头指纹随常量生效；无数据迁移 |
| profile 豁免残留（FNOS-012-03） | 安装回调已统一以 `--config.minimum-release-age=0` 放行发布日期校验（`run_dsh_plugin_with_release_age`，提交 `b4d21cf`），但 profile 的 pnpm-workspace.yaml 仍可能残留历史 `minimumReleaseAgeExclude` 条目（项目 `.dsh/profiles/web` 实测残留 `@tnnevol/dsh-codebuddy@0.1.7-rc.2`，指向已失效版本） | 安装/升级链路检测 profile pnpm-workspace.yaml 是否存在 `minimumReleaseAgeExclude`；存在则移除该字段，随后删除该 profile 的 pnpm-lock.yaml 与 node_modules，并在 profile 目录重新执行 `pnpm install` 完成重建 | 检测与清理逻辑进入安装回调（或其 helper）；清理只作用于 profile 目录；触发时安装耗时增加（全量重装），无该字段的 profile 零开销 |

## 影响范围分析

| 需求功能 | 代码模块 | 配置/数据 | 测试 | 文档 | 目标环境 |
| --- | --- | --- | --- | --- | --- |
| FNOS-012-01 | `plugins/dsh-codebuddy-plugin`（模型信息展示相关 Client/Host 代码） | 无 | 倍速展示单测（有/无/`x0.00` 三态） | 如有用户可见说明则更新插件文档 | DSH Web、DSH Desktop |
| FNOS-012-02 | `plugins/dsh-codebuddy-plugin/src/contracts/constants.ts`、`host/risk-headers.ts` 消费处 | 无 | 版本常量断言与风控头指纹测试更新 | — | DSH Web、DSH Desktop |
| FNOS-012-03 | `apps/fn-deepseek-harness/cmd/install_callback`（或 `packages/fnos-gateway/src/install-callback-helper/` helper） | profile pnpm-workspace.yaml 移除字段；lockfile 与 node_modules 重建（均为可重建产物） | 检测/清理/重装分支的本地自动化断言 | 排错文档如涉及发布日期问题则更新 | 真实 fnOS NAS |

不涉及：DSH 官方源码、模型路由与预算逻辑、积分计费、登录流程与已保存凭据、其他插件、用户主目录 `~/.dsh` 与其他 profile。

## 分阶段任务

### 阶段一：实现与验证（T01-01–T01-05）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-012-T01-01 | FNOS-012-01 / AC-01、AC-02 | 让 `/model` 模型列表窗口可见倍速：优先复用 `description` 已承载的 `credits` 值确定展示路径（官方组件能力核实后在计划变更记录登记结论）；保持无倍速条目不显示、`x0.00` 照常展示 | T01-02 或并行 | 单测三态断言；本地 Web 走查 |
| PLAN-FNOS-012-T01-02 | FNOS-012-01 / AC-03 | 展示样式：DSH 语义变量、亮暗主题下可读、不与名称/选中态重叠 | 无 | Web 走查（亮/暗各一遍） |
| PLAN-FNOS-012-T01-03 | FNOS-012-02 / AC-01、AC-02 | `CODEBUDDY_CLI_VERSION` → `'2.163.0'`、WorkBuddy → `'5.77'`；更新受影响的指纹断言测试 | 无 | 常量/指纹单测通过；真实账号回归登录、对话、用量 |
| PLAN-FNOS-012-T01-04 | FNOS-012-03 / AC-01、AC-02 | 安装/升级链路新增 profile 自愈步骤：检测 web profile 的 pnpm-workspace.yaml 是否含 `minimumReleaseAgeExclude`；存在则移除该字段、删除该 profile 的 pnpm-lock.yaml 与 node_modules，并在 profile 目录重新 `pnpm install`；字段不存在时跳过全部清理 | 无 | 本地自动化：三态断言（有字段→清理重装、无字段→跳过、重装后插件清单版本齐平） |
| PLAN-FNOS-012-T01-05 | FNOS-012-03 / AC-03、AC-04 | 自愈与插件安装顺序核对：清理重装发生在插件安装之前，`NO_MATURE_MATCHING_VERSION` 不再出现；清理过程不触碰用户配置与凭据文件 | T01-04 | 本地 profile 模拟残留场景端到端走查；失败时不回滚用户数据 |

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
| 风险：自愈清理触发全量重装，NAS 上安装耗时明显增加 | 仅在检测到 `minimumReleaseAgeExclude` 残留时触发一次，重装完成后字段不再出现、后续安装零开销 | T01-04 记录本地重装耗时；NAS 验收（T02-01）观察真实耗时；日志中输出「检测到残留并重建」提示，用户可理解等待 |
| 风险：清理误删用户数据 | 清理范围严格限定 profile 内的 pnpm-lock.yaml 与 node_modules 两个重建产物；配置、凭据、用户层 patch 不在清理清单 | T01-05 端到端走查核对清理前后用户文件不变；失败时 fail_install 且不回滚数据 |
| 决策：版本值取用户提供的官方当前版本 | CLI `2.163.0`、WorkBuddy `5.77` | — |
| 决策：移除 `minimumReleaseAgeExclude` 而非改写为单行 `||` 联合 | 安装回调已用 `--config.minimum-release-age=0` 统一放行发布日期校验，profile 级豁免职责已被取代；残留条目指向失效版本，维护负担大于收益（Discussions #11 的 First-Match-Wins 陷阱随字段移除一并消失） | — |
| 回滚 | 常量回退到 `2.159.0`/`5.6.2`；展示改动按插件独立回退；自愈步骤回退即移除检测逻辑（已清理的 profile 无需恢复字段） | 无数据风险 |

## 测试、打包、发布和回滚

- 包级：`dsh-codebuddy` typecheck、单测、构建；倍速三态与版本指纹断言。
- DSH Web：`pnpm run start -- --web` 本地走查模型列表（亮/暗主题各一遍）。
- DSH Desktop：按[测试用例文档规范](../charter/tests-spec.md#dsh-desktop-测试)使用项目 `.dsh/profiles/desktop`。
- FNOS-012-03：本地 profile 模拟三态（有字段/无字段/重装后）自动化断言；真实 NAS 上按[真实 NAS 测试](../charter/tests-spec.md#真实-nas-测试)走完整安装/升级链路。
- 回滚：单插件回退，无用户数据影响。

## 参考资料

- 需求调研结论：[FNOS-012 调研结论](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#调研结论)
- 社区实测：[Discussions #11 minimumReleaseAgeExclude 的 First-Match-Wins 陷阱](https://github.com/FNOSP/fnos-dsh/discussions/11#discussioncomment-18833751)
- 安装回调统一放行：`apps/fn-deepseek-harness/cmd/install_callback` 的 `run_dsh_plugin_with_release_age`（提交 `b4d21cf`）
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
| 2026-10-09 | 新增 FNOS-012-03（T01-04/T01-05） | web profile 安装/升级链路检测并移除 `minimumReleaseAgeExclude` 残留，随后删 lockfile 与 node_modules 并在 profile 目录重新 `pnpm install` 自愈；决策为移除而非改写单行联合（安装回调已统一 `--config.minimum-release-age=0` 放行）。同步更新目标设计、影响矩阵、风险与参考资料。 |
