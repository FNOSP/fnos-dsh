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
| 本轮功能 | FNOS-012-01（模型列表展示倍速）、FNOS-012-02（CLI `2.163.0` / WorkBuddy `5.77`）、FNOS-012-03（profile 依赖重建自愈：失效豁免触发 lockfile/node_modules 清理与重装）、FNOS-012-04（npm `latest` 标签校正） |
| 计划状态 | <Badge type="info" text="规划中" /> |

## 计划目标

实现 FNOS-012-01/02/03/04：`/model` 模型列表窗口中可见模型倍速；插件客户端版本指纹与官方当前版本一致；DSH web profile 在豁免条目与实际安装版本不一致时自动清理 lockfile/node_modules 并重建依赖；npm `latest` 标签校正到 `0.1.7-rc.2.2`。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| 倍速展示 | `modelInfo()` 已把目录 `credits` 写入 `LlmModelInfo.description`；composer 模型选择组件只渲染 `name`，`description` 在 `/model` 列表窗口不可见 | 按 `description` 的官方语义让模型列表窗口展示倍速（官方 composer 组件不支持时，用插件可用的座位/补丁方式承载），展示位置与样式在实现时确定 | 仅展示层；模型路由、目录解析不变 |
| 版本指纹 | `CODEBUDDY_CLI_VERSION = '2.159.0'`、WorkBuddy `'5.6.2'`（`contracts/constants.ts`，进入 `risk-headers` 的 User-Agent 等指纹） | CLI `'2.163.0'`、WorkBuddy `'5.77'` | 常量替换；请求头指纹随常量生效；无数据迁移 |
| profile 豁免残留（FNOS-012-03） | 安装回调已统一以 `--config.minimum-release-age=0` 放行发布日期校验（`run_dsh_plugin_with_release_age`，提交 `b4d21cf`），但 profile 的 pnpm-workspace.yaml 仍可能残留失效的 `minimumReleaseAgeExclude` 条目（项目 `.dsh/profiles/web` 实测残留 `@tnnevol/dsh-codebuddy@0.1.7-rc.2`，指向已失效版本）；字段本身是让新发布插件正常安装的机制，**保留不删除** | 安装/升级链路检测豁免条目是否指向失效版本（版本与清单不一致）；失效则删除该 profile 的 pnpm-lock.yaml 与 node_modules，并在 profile 目录重新执行 `pnpm install`，使豁免规则与实际安装版本重新对齐；字段与有效条目原样保留 | 检测与清理逻辑进入安装回调（或其 helper）；清理只作用于 profile 目录；触发时安装耗时增加（全量重装），无失效条目的 profile 零开销 |

## 影响范围分析

| 需求功能 | 代码模块 | 配置/数据 | 测试 | 文档 | 目标环境 |
| --- | --- | --- | --- | --- | --- |
| FNOS-012-01 | `plugins/dsh-codebuddy-plugin`（模型信息展示相关 Client/Host 代码） | 无 | 倍速展示单测（有/无/`x0.00` 三态） | 如有用户可见说明则更新插件文档 | DSH Web、DSH Desktop |
| FNOS-012-02 | `plugins/dsh-codebuddy-plugin/src/contracts/constants.ts`、`host/risk-headers.ts` 消费处 | 无 | 版本常量断言与风控头指纹测试更新 | — | DSH Web、DSH Desktop |
| FNOS-012-03 | `apps/fn-deepseek-harness/cmd/install_callback`（或 `packages/fnos-gateway/src/install-callback-helper/` helper） | 失效豁免条目触发 lockfile 与 node_modules 清理重建（均为可重建产物；`minimumReleaseAgeExclude` 字段保留） | 检测/清理/重装分支的本地自动化断言 | 排错文档如涉及发布日期问题则更新 | 真实 fnOS NAS |
| FNOS-012-04 | 无代码改动；npm registry 运维操作 | npm dist-tags（`latest` → `0.1.7-rc.2.2`） | dist-tags 查询核对 | npm registry | npm registry（操作者需发布权限） |

不涉及：DSH 官方源码、模型路由与预算逻辑、积分计费、登录流程与已保存凭据、其他插件、用户主目录 `~/.dsh` 与其他 profile。

## 分阶段任务

### 阶段一：实现与验证（T01-01–T01-07）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-012-T01-01 | FNOS-012-01 / AC-01、AC-02 | 让 `/model` 模型列表窗口可见倍速：优先复用 `description` 已承载的 `credits` 值确定展示路径（官方组件能力核实后在计划变更记录登记结论）；保持无倍速条目不显示、`x0.00` 照常展示 | T01-02 或并行 | 单测三态断言；本地 Web 走查 |
| PLAN-FNOS-012-T01-02 | FNOS-012-01 / AC-03 | 展示样式：DSH 语义变量、亮暗主题下可读、不与名称/选中态重叠 | 无 | Web 走查（亮/暗各一遍） |
| PLAN-FNOS-012-T01-03 | FNOS-012-02 / AC-01、AC-02 | `CODEBUDDY_CLI_VERSION` → `'2.163.0'`、WorkBuddy → `'5.77'`；更新受影响的指纹断言测试 | 无 | 常量/指纹单测通过；真实账号回归登录、对话、用量 |
| PLAN-FNOS-012-T01-04 | FNOS-012-03 / AC-01、AC-02 | 安装/升级链路新增 profile 自愈步骤：检测 web profile 的 pnpm-workspace.yaml 中 `minimumReleaseAgeExclude` 条目是否指向失效版本（与清单版本不一致）；失效则删除该 profile 的 pnpm-lock.yaml 与 node_modules，并在 profile 目录重新 `pnpm install`；条目有效或字段不存在时跳过全部清理（字段保留，不删除） | 无 | 本地自动化：三态断言（失效条目→清理重装、有效/无字段→跳过、重装后插件清单版本齐平） |
| PLAN-FNOS-012-T01-05 | FNOS-012-03 / AC-03、AC-04 | 自愈与插件安装顺序核对：清理重装发生在插件安装之前，`NO_MATURE_MATCHING_VERSION` 不再出现；清理过程不触碰用户配置与凭据文件 | T01-04 | 本地 profile 模拟残留场景端到端走查；失败时不回滚用户数据 |
| PLAN-FNOS-012-T01-06 | FNOS-012-04 / AC-01、AC-02 | **`latest` 校正自动化进发布命令**：`tooling/fnos-dsh-cli` 的 `runPublish` 在每个插件 `publish:next` 成功后，读取该包 `package.json` 的 `version`，按代际规则自动维护 `latest`——新代际首版（如 `0.2.0-rc.2.0` 相对上一代 `0.1.7-*`）发布时把 `latest` 指向**上一代最新稳定版**；同代际迭代版（如 `0.2.0-rc.2.1`）不动 `latest`。上一代最新版通过 `npm view <name> versions` 解析预发布代际后取最大序，或在发布前缓存 dist-tags 后计算；写入方式实现时三选一：`npm dist-tag add <name>@<version> latest`（标准子命令，无 `set`）、registry HTTP `PUT /-/package/<pkg>/dist-tags`（全量写）、或改插件脚本 `pnpm publish --tag <tag>` 直接指定。本次需要的一次性校正（`0.1.7-rc.2.2`）由同一段逻辑在下次发布时自动完成，无需单独手工执行 | npm 发布权限（当前环境 token 失效 401，执行前需 `npm login`） | CLI 单测：代际判定逻辑（新代际→动 latest、同代际→不动）；真实发布后 `pnpm view <包> dist-tags` 核对 |
| PLAN-FNOS-012-T01-07 | FNOS-012-04 / AC-03 | 把「`latest` 由发布命令自动维护」的约定写入 [发布流程](../build/release.md)：`pnpm run publish` 完成后自动处理，无需每次发布后手动设置 dist-tag；文档说明代际规则、可用命令（`npm dist-tag add/rm/ls`）与应急校正方式 | T01-06 | 文档构建通过；下次发布验证自动化生效 |

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
| 决策：保留 `minimumReleaseAgeExclude` 字段，自愈只清理依赖产物 | 字段的作用是让新发布插件绕过 pnpm 发布冷静期正常安装，机制本身有效（FNOS-009-12 统一放行的是安装回调内的调用路径，字段仍是 profile 级豁免的载体）；问题不在字段而在失效条目导致 lockfile/依赖树不一致，因此自愈=清 lockfile + node_modules + 重装 | — |
| 决策：`latest` 校正到 `0.1.7-rc.2.2` 而非 `0.2.0-rc.2.0` | rc 版进 `latest` 会让默认安装的普通用户装到预发布版，与 rc 阶段 pin 策略冲突；`0.2.0-rc.2.0` 继续走 `next`，出稳定版后整体切换（Discussions #11 维护者策略回复） | — |
| 决策：`latest` 维护自动化进 `pnpm run publish` 命令，而非每次发布后手动执行 | 发布是本地 CLI 操作（`runPublish` 串行执行 `publish:next`），npm 凭据与发布时机天然可得；手动 dist-tag 易漏（本次四包全部滞留即为证据）。规则：新代际首版发布时把 `latest` 指向上一代最新稳定版，同代际迭代版不动 `latest`——与 rc pin 策略一致且无需人工记忆 | 代际判定逻辑进 CLI 单测；发布输出中打印 latest 变更，可审计 |
| 风险：代际判定规则在特殊版本号下误判 | 当前版本形态固定为 `<上游版本>.<修订>`（如 `0.2.0-rc.2.0`），代际 = 去掉最后修订段的前缀；规则覆盖现有全部版本序列 | CLI 单测覆盖既有 21 个历史版本形态；出现新版本形态时先补规则再发布 |
| 风险：`latest` 校正后旧版用户收到更新提示 | `0.1.0-rc.7` 等旧版用户会提示更新到 `0.1.7-rc.2.2`——期望行为（引向正确的上一代稳定版） | `npm dist-tag add` 立即生效、可重复执行、可随时再校正，无回滚成本 |
| 回滚 | 常量回退到 `2.159.0`/`5.6.2`；展示改动按插件独立回退；自愈步骤回退即移除检测逻辑（已清理的 profile 无需恢复字段）；`latest` 可随时再 `npm dist-tag add` 校正回来 | 无数据风险 |

## 测试、打包、发布和回滚

- 包级：`dsh-codebuddy` typecheck、单测、构建；倍速三态与版本指纹断言。
- DSH Web：`pnpm run start -- --web` 本地走查模型列表（亮/暗主题各一遍）。
- DSH Desktop：按[测试用例文档规范](../charter/tests-spec.md#dsh-desktop-测试)使用项目 `.dsh/profiles/desktop`。
- FNOS-012-03：本地 profile 模拟三态（有字段/无字段/重装后）自动化断言；真实 NAS 上按[真实 NAS 测试](../charter/tests-spec.md#真实-nas-测试)走完整安装/升级链路。
- FNOS-012-04：npm registry 上核对 dist-tags 与默认安装行为；属运维操作，需发布权限。
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
| 2026-10-09 | 新增 FNOS-012-03（T01-04/T01-05） | web profile 安装/升级链路检测 `minimumReleaseAgeExclude` 失效条目（版本与清单不一致），随后删 lockfile 与 node_modules 并在 profile 目录重新 `pnpm install` 自愈；字段保留不删除（其作用是让新发布插件正常安装）。同步更新目标设计、影响矩阵、风险与参考资料。 |
| 2026-10-09 | 修正 03/04 表述 | FNOS-012-03 由「移除字段」修正为「失效条目触发依赖重建，字段保留」（字段是让新发布插件正常安装的机制，不删）；FNOS-012-04 命令修正为 `npm dist-tag add`（`dist-tag set` 非有效子命令），并补充 `pnpm publish --tag` 与 registry HTTP PUT 两种可用方式。 |
| 2026-10-09 | 新增 FNOS-012-04（T01-06/T01-07） | npm `latest` 校正到 `0.1.7-rc.2.2`（四包一致，运维操作需发布权限；当前环境 npm token 失效 401，执行前需 `npm login`）；并把「发布后维护 `latest`」约定写入发布流程文档防复发。原因分析与命令登记在需求文档「问题分析」章节。 |
