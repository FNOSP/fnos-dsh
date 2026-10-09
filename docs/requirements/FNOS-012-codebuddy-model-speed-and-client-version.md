---
id: FNOS-012
title: FNOS-012 CodeBuddy 模型倍速展示与客户端版本更新
description: CodeBuddy 插件的 /model 指令模型列表窗口补充展示模型倍速字段，并将 CLI 客户端版本更新为 2.163.0、WorkBuddy 客户端版本更新为 5.77，使模型选择信息完整且与官方客户端保持一致。
status: planned
owner: tnnevol
targetVersion: 5.7.0
lastVerified: 2026-10-09
---

# FNOS-012 CodeBuddy 模型倍速展示与客户端版本更新

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-012 |
| 提出日期 | 2026-10-09 |
| 需求状态 | <Badge type="info" text="规划中" /> |
| 关联计划 | [PLAN-FNOS-012 CodeBuddy 模型倍速展示与客户端版本更新](/plans/PLAN-FNOS-012-codebuddy-model-speed-and-client-version) |
| 适用范围 | `dsh-codebuddy` 插件、CodeBuddy 模型选择与请求头指纹 |

## 需求背景

CodeBuddy 插件通过 `/model` 指令打开模型列表窗口选择模型。用户在窗口中只能看到模型名称，看不到每个模型的**倍速字段**（积分倍率，如 `x3.33`、`x0.05`）——倍速决定一次调用消耗多少积分，是用户在相似模型之间做选择的关键信息，缺失时用户只能离开窗口去查询倍率再回来。

同时，CodeBuddy 官方客户端已迭代：CLI 版本当前为 `2.163.0`、WorkBuddy 版本为 `5.77`。插件请求中携带的客户端版本指纹落后于官方，存在与官方客户端行为不一致或被服务端按旧版本对待的风险。

## 调研结论

| 结论 | 出处 | 影响的功能 | 状态 |
| --- | --- | --- | --- |
| 模型目录的每个模型已带倍速字段 `credits`（网络值即已格式化的倍率字符串，如 `x3.33`；可能缺省或为空） | `dsh-codebuddy` 插件 `CodeBuddyModel.credits` 类型定义；`dsh-codebuddy` 适配器 `modelInfo()` 已读取该字段 | FNOS-012-01 | 已核实 |
| 适配器把 `credits` 写入模型条目的 `description`（`LlmModelInfo.description` 为官方模型信息上的可选展示字段），但 composer 的模型选择组件只渲染 `name`，`description` 在 `/model` 模型列表窗口中**不可见**——这是倍速缺失的直接原因 | `LlmModelInfo.description` 字段定义（`dsh-llm` 0.2.0-rc.2 类型注释“user-facing distinction from otherwise similar models”）；适配器内既有注释记录“composer ModelSelect 只渲染 `model.name`” | FNOS-012-01 | 已核实 |
| 客户端版本指纹由常量表统一维护：`CODEBUDDY_CLI_VERSION` 当前为 `2.159.0`，WorkBuddy 版本当前为 `5.6.2`，两者进入请求头 User-Agent（`WorkBuddy/<版本> CLI/<版本>`）等指纹 | `dsh-codebuddy` 插件 `contracts/constants.ts`、`host/risk-headers.ts` | FNOS-012-02 | 已核实 |
| 官方客户端当前版本：CLI `2.163.0`、WorkBuddy `5.77` | 用户提供的官方版本信息 | FNOS-012-02 | 已核实 |
| 本地 web profile 的 pnpm-workspace.yaml 残留 `minimumReleaseAgeExclude: ['@tnnevol/dsh-codebuddy@0.1.7-rc.2']`，而插件清单已是 `0.2.0-rc.2.0`——旧豁免条目指向失效版本，属于历史锚定残留 | 项目 `.dsh/profiles/web/pnpm-workspace.yaml` 实测 | FNOS-012-03 | 已核实 |
| pnpm 的 `minimumReleaseAgeExclude` 采用首项命中即返回（First-Match-Wins）：同一包多版本按行分列时后续条目被短路忽略，触发 `NO_MATURE_MATCHING_VERSION` 拦截非交互安装；社区已实测该机制并给出单行 `\|\|` 联合的规避写法 | [Discussions #11（discussioncomment-18833751）](https://github.com/FNOSP/fnos-dsh/discussions/11#discussioncomment-18833751) | FNOS-012-03 | 已核实 |
| 安装回调已统一以 `--config.minimum-release-age=0` 放行发布日期校验（自有与三方一致），profile 级 `minimumReleaseAgeExclude` 的豁免职责已被取代，残留只带来维护负担 | `cmd/install_callback` 的 `run_dsh_plugin_with_release_age`；提交 `b4d21cf` | FNOS-012-03 | 已核实 |

## 需求目标

- 用户打开 `/model` 模型列表窗口时，每个模型条目能看到自己的倍速，无需离开窗口查询。
- 插件对 CodeBuddy 服务端声明的客户端版本与官方当前版本一致，降低旧版本指纹带来的行为差异风险。
- DSH web profile 不再残留历史 `minimumReleaseAgeExclude` 规则，插件安装不再被旧豁免清单与 lockfile 残留阻塞。

## 功能列表

| 编号 | 优先级 | 功能 | 用户可观察结果 | 状态 |
| --- | --- | --- | --- | --- |
| FNOS-012-01 | P1 | 模型列表展示倍速 | `/model` 模型列表窗口中，有倍速的模型条目展示其倍速（如 `x3.33`）；目录未披露倍速的模型不编造数值、不显示倍速位 | <Badge type="info" text="规划中" /> |
| FNOS-012-02 | P1 | 客户端版本更新 | 插件请求携带的 CLI 版本为 `2.163.0`、WorkBuddy 版本为 `5.77`，登录与请求行为与官方客户端一致 | <Badge type="info" text="规划中" /> |
| FNOS-012-03 | P1 | profile 移除 minimumReleaseAgeExclude 自愈 | DSH web profile 安装/升级时检测 pnpm-workspace.yaml 中的 `minimumReleaseAgeExclude` 残留并移除；移除后清理 lockfile 与 node_modules 并在 profile 目录重新 `pnpm install`，插件安装不再受旧豁免规则影响 | <Badge type="info" text="规划中" /> |

## 行为约束

- 倍速只是展示信息：不得据此改变模型路由、预算或请求行为。
- 目录未披露倍速（`credits` 缺省或为空）的模型保持现状——不显示倍速，也不补 `x0.00` 之外的编造值；`x0.00` 的零倍率模型是有效事实，照常展示。
- 模型名称保持 CodeBuddy 自己的名称，倍速不拼进名称（倍率变化不应表现为模型改名）。
- 版本常量只影响客户端指纹与兼容性声明，不改变请求结构、业务逻辑和已保存凭据；用户数据不受影响。
- `minimumReleaseAgeExclude` 的检测与移除只在 DSH web profile 的安装/升级链路内进行，不影响用户主目录 `~/.dsh` 与其他 profile；清理动作（删 lockfile、删 node_modules、重装）只作用于该 profile 目录，安装失败不得回滚或删除用户配置。
- 实现方式与展示位置由对应计划决定；不改 DSH 官方源码。

## 不在本次范围内

- 不改变模型选择器的交互结构（排序、分组、搜索等）。
- 不调整 CodeBuddy 积分计费逻辑或额度显示。
- 不更新除 CLI/WorkBuddy 版本指纹之外的风控头、设备指纹。

## 验收条件与完成状态

### FNOS-012-01

- `FNOS-012-01-AC-01`：`/model` 模型列表窗口中，目录披露了倍速的模型条目可见其倍速值，值与模型目录一致。
- `FNOS-012-01-AC-02`：目录未披露倍速的模型条目不显示倍速，无编造数值；`x0.00` 模型正常展示 `x0.00`。
- `FNOS-012-01-AC-03`：亮色与暗色主题下倍速文本可读，布局不与模型名称、选中态重叠。

### FNOS-012-02

- `FNOS-012-02-AC-01`：插件发出的请求中 CLI 版本为 `2.163.0`、WorkBuddy 版本为 `5.77`（请求头指纹与常量表一致）。
- `FNOS-012-02-AC-02`：版本更新后登录、对话、用量与账号管理行为与更新前一致，既有登录凭据继续有效。

### FNOS-012-03

- `FNOS-012-03-AC-01`：web profile 的 pnpm-workspace.yaml 存在 `minimumReleaseAgeExclude` 时，安装/升级链路自动移除该字段，移除后 profile 的 lockfile 与 node_modules 被清理并重新完成 `pnpm install`。
- `FNOS-012-03-AC-02`：不存在 `minimumReleaseAgeExclude` 的 profile 不触发清理与重装，安装/升级流程与现状一致。
- `FNOS-012-03-AC-03`：清理重装后，清单内的插件全部按清单版本安装成功，`NO_MATURE_MATCHING_VERSION` 类发布日期拦截不再出现。
- `FNOS-012-03-AC-04`：清理过程不删除、不改写用户的插件配置与凭据数据。

### 验收环境范围

- FNOS-012-01 在 DSH Web 与 DSH Desktop 验收。
- FNOS-012-02 在 DSH Web 与 DSH Desktop 验收；涉及真实服务端交互的部分按既有网络/账号条件验证。
- FNOS-012-03 在真实 fnOS NAS 验收（安装/升级链路整体走通）；检测与清理分支由本地自动化覆盖。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-09 | 初始登记 | 建立 FNOS-012：/model 模型列表补充倍速展示（目录 `credits` 字段已存在，composer 选择组件不渲染 description 为缺失原因）；CLI 版本 `2.159.0 → 2.163.0`、WorkBuddy `5.6.2 → 5.77`。关联 PLAN-FNOS-012。 |
| 2026-10-09 | 新增 FNOS-012-03 | 范围扩展：web profile 安装/升级链路检测并移除 pnpm-workspace.yaml 的 `minimumReleaseAgeExclude` 残留，随后清理 lockfile 与 node_modules 并重新 `pnpm install` 自愈。依据：本地 profile 实测残留旧锚定；Discussions #11 证实 pnpm 豁免规则 First-Match-Wins 陷阱；安装回调已用 `--config.minimum-release-age=0` 统一放行，profile 级豁免已被取代。 |
