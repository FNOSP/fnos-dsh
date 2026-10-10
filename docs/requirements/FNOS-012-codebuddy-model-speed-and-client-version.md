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
| npm 上四个插件的 `latest` dist-tag 全部停留在早期版本（`dsh-codex-auth` → `0.1.0-rc.7`、`dsh-codebuddy` → `0.1.2-rc.1.2`、`dsh-fnos` → `0.1.1-rc.2.0`、`dsh-semi-ui-showcase` → `0.1.2-rc.1`），新版本只挂在 `next`（`0.2.0-rc.2.0`）；`npm i` 不带 tag 会装到旧版 | npm registry `dist-tags` 实测（2026-10-09）；[Discussions #11](https://github.com/FNOSP/fnos-dsh/discussions/11) 社区同报 | FNOS-012-04 | 已核实 |
| `latest` 失效的直接原因：发布链路只发 `next`（`publish:next` 脚本固定 `--tag next`），从无维护 `latest` 的步骤；`latest` 停在各插件历史早期版本 | 插件 `package.json` 的 `publish:next` 脚本；`tooling/fnos-dsh-cli` publish 命令 | FNOS-012-04 | 已核实 |
| `latest` 的正确指向为各插件上一代最新版 `0.1.7-rc.2.2`（四个插件一致）；rc 版进 `latest` 会让普通用户提前装到预发布版，与 rc 阶段 pin 版本策略冲突 | npm 版本序列核对；维护者 rc 策略回复（Discussions #11） | FNOS-012-04 | 已核实 |
| `@tnnevol/dsh-failover-search` 的 `compatibility.json` 包清单长期停留在 10 个包；该插件实际依赖 16 个 `@deepseek-ai/dsh-*` 包——本轮新增的 `dsh-tools`（会话级门控）、`dsh-agent`（读 `exec.agent`）、`dsh-client-ui-conversation`（`conversation.input.left` 座位类型）、`dsh-web-fetch-http`（复用 `HttpFetchProvider`）均未声明 | 源码 import 扫描与 `package.json` peerDependencies 比对（2026-10-10） | FNOS-012-05 | 已核实 |
| 缺失后果：该清单约束宿主的兼容门禁提示，漏声明时「宿主缺包」不会被安装期拦下，要到编译或运行才失败；与 `latest` 问题同属**发布产物与实际不符** | `tooling/fnos-dsh-cli` 的 `keeps each compatibility package list aligned with source imports` 用例（从源码扫 import 与声明面比对） | FNOS-012-05 | 已核实 |
| 发布时序导致的漏网：清单修正（提交 `f86a7e7`）晚于 `v0.2.0-rc.2.1` 发布（`2026-10-10T05:45:38Z`）数十秒，因此该修正**不在已发布的包里**——源码已修但线上包仍是旧清单 | npm 发布时间与提交时间戳比对；已发布包解包核对 | FNOS-012-05 | 已核实（本次实例） |
| 同类问题的检测手段已有：`keeps each compatibility package list aligned with source imports` 会捕获清单与源码不一致；`keeps every documented install command on the released plugin version` 会捕获安装命令版本落后。但两者都**不校验已发布包的产物**——发布后源码再改就会漏网 | 两条用例的断言范围 | FNOS-012-05 | 已核实（改进方向） |

## 需求目标

- 用户打开 `/model` 模型列表窗口时，每个模型条目能看到自己的倍速，无需离开窗口查询。
- 插件对 CodeBuddy 服务端声明的客户端版本与官方当前版本一致，降低旧版本指纹带来的行为差异风险。
- DSH web profile 不再残留历史 `minimumReleaseAgeExclude` 规则，插件安装不再被旧豁免清单与 lockfile 残留阻塞。
- npm `latest` 标签与 rc 阶段发布策略一致，社区用户按默认方式安装不会误装早期版本或误降级（回应 [Discussions #11](https://github.com/FNOSP/fnos-dsh/discussions/11) 的 dist-tags 反馈）。

## 问题分析：npm latest 标签失效的原因与解决方式（FNOS-012-04）

### 现象

npm 上四个自有插件的 `latest` dist-tag 均停留在早期版本（如 `dsh-codex-auth` → `0.1.0-rc.7`），而适配 DSH `0.2.0-rc.2` 的新版本 `0.2.0-rc.2.0` 只发布在 `next` 标签。后果：`npm i @tnnevol/<插件>` 不带 tag 时安装到旧版；按 npm 默认规则检查更新的客户端工具误报「可更新」甚至误触发向旧版降级——即 [Discussions #11](https://github.com/FNOSP/fnos-dsh/discussions/11) 社区反馈的 dist-tags 问题。

### 原因

1. **发布链路只写 `next`**：各插件 `package.json` 的 `publish:next` 脚本固定 `pnpm publish --tag next`，CLI 的 publish 命令也只走该脚本；整条发布链路没有任何维护 `latest` 的步骤。
2. **`latest` 从未跟随迭代**：npm 的 `latest` 只在发布时不指定 tag 的情况下才会移动；自改为 `next` 发布后，`latest` 冻结在各插件最后一次无 tag 发布的版本（时间较早）。
3. **无校正机制**：rc 阶段刻意 pin 版本（rc 策略，见 Discussions #11 维护者回复），`next` 与 `latest` 的分层是合理的；缺的只是把 `latest` 校正到「上一代最新稳定候选」的一次性动作与后续约定。

### 解决方式

**`latest` 维护自动化进发布命令**：`tooling/fnos-dsh-cli` 的 publish 命令在发布循环中自动维护 `latest`——每个插件 `publish:next` 成功后按**代际规则**处理：

- **新代际首版**（如 `0.2.0-rc.2.0` 相对上一代 `0.1.7-*`）：把 `latest` 指向**上一代最新稳定版**——本次需要的一次性校正（`0.1.7-rc.2.2`）由该逻辑在下次发布时自动完成，无需单独手工执行。
- **同代际迭代版**（修订号递增，如 `0.2.0-rc.2.1`）：不动 `latest`，只更新 `next`。

无需每次发布后手动调整；发布输出中打印 `latest` 变更，可审计。

**dist-tag 设置的可用方式**（`npm dist-tag set` 并非有效子命令，实际命令体系如下）：

| 方式 | 命令 | 说明 |
| --- | --- | --- |
| 官方 CLI 子命令 | `npm dist-tag add <pkg>@<version> latest` | 标准做法；另有 `dist-tag rm <pkg> <tag>`、`dist-tag ls [<pkg>]`（`dist-tags` 是别名） |
| 发布时直接指定 | `pnpm publish --tag latest`（插件脚本已用 `--tag next`） | 发布那一刻就把版本挂到指定 tag；无需二次校正，但只对新发布的版本有效 |
| registry HTTP API | `PUT https://registry.npmjs.org/-/package/<pkg>/dist-tags`（body 为完整 dist-tags JSON） | 需 `Authorization: Bearer <token>`；适合脚本化批处理，自动化实现可选此路 |

自动化的实现三选一：`npm dist-tag add`（简单直接）、或 registry HTTP PUT（一次请求写全量 tags，避免 add/rm 交错）。选择在实现时定案并登记。

### 风险

- 校正 `latest` 后，已按 `latest` 安装 `0.1.0-rc.7` 等旧版的用户会收到「可更新到 0.1.7-rc.2.2」的提示——这是期望行为（把用户引向正确的上一代稳定版）。
- `npm dist-tag add` 立即生效且可重复执行、可随时再校正，无数据迁移与回滚成本。

## 功能列表

| 编号 | 优先级 | 功能 | 用户可观察结果 | 状态 |
| --- | --- | --- | --- | --- |
| FNOS-012-01 | P1 | 模型列表展示倍速 | `/model` 模型列表窗口中，有倍速的模型条目展示其倍速（如 `x3.33`）；目录未披露倍速的模型不编造数值、不显示倍速位 | <Badge type="info" text="规划中" /> |
| FNOS-012-02 | P1 | 客户端版本更新 | 插件请求携带的 CLI 版本为 `2.163.0`、WorkBuddy 版本为 `5.77`，登录与请求行为与官方客户端一致 | <Badge type="info" text="规划中" /> |
| FNOS-012-03 | P1 | profile 依赖重建自愈 | DSH web profile 安装/升级时检测 pnpm-workspace.yaml 中 `minimumReleaseAgeExclude` 条目指向的版本是否已失效（与清单版本不一致）；存在失效条目时清理 lockfile 与 node_modules 并在 profile 目录重新 `pnpm install`，使豁免规则与实际安装版本重新对齐，插件安装恢复正常 | <Badge type="info" text="规划中" /> |
| FNOS-012-04 | P1 | npm latest 标签校正 | 四个插件 npm 的 `latest` 指向 `0.1.7-rc.2.2`；`npm i @tnnevol/<插件>` 默认安装到上一代稳定版而非 `0.1.0-rc.7` 等早期版本；`0.2.0-rc.2.0` 继续通过 `next` 获取 | <Badge type="info" text="规划中" /> |
| FNOS-012-05 | P1 | 插件发布内容完整性校正 | `@tnnevol/dsh-failover-search` 的 `compatibility.json` 包清单与实际依赖一致（含本轮新增的 `dsh-tools`、`dsh-agent`、`dsh-client-ui-conversation`、`dsh-web-fetch-http`）；新发布的插件包内该清单不再落后于源码 | <Badge type="info" text="规划中" /> |
| FNOS-012-06 | P2 | 智能搜索控件改为药丸按钮样式 | `dsh-failover-search` 消息框左下角的「智能搜索」控件改为药丸按钮：开启时呈激活态样式、关闭时为普通态；移除 Switch，仅保留「智能搜索」文案（状态不进文案，只靠样式区分）；位置、会话级语义与默认开启不变 | <Badge type="info" text="规划中" /> |

## 行为约束

- 倍速只是展示信息：不得据此改变模型路由、预算或请求行为。
- 目录未披露倍速（`credits` 缺省或为空）的模型保持现状——不显示倍速，也不补 `x0.00` 之外的编造值；`x0.00` 的零倍率模型是有效事实，照常展示。
- 模型名称保持 CodeBuddy 自己的名称，倍速不拼进名称（倍率变化不应表现为模型改名）。
- 版本常量只影响客户端指纹与兼容性声明，不改变请求结构、业务逻辑和已保存凭据；用户数据不受影响。
- `minimumReleaseAgeExclude` 的**作用是让新发布的插件版本绕过 pnpm 发布冷静期正常安装，字段本身保留，不删除**；自愈只针对「豁免条目指向的版本与实际安装版本不一致」的失效状态：清理该 profile 的 lockfile 与 node_modules 并重新 `pnpm install`，使豁免规则与实际版本重新对齐。检测与重建只发生在 DSH web profile 的安装/升级链路内，不影响用户主目录 `~/.dsh` 与其他 profile；安装失败不得回滚或删除用户配置。
- 智能搜索控件（FNOS-012-06）只改视觉形态：会话级语义、默认开启、按会话独立与即时生效等行为全部沿用 [FNOS-010-12](/requirements/FNOS-010-thirdparty-web-search-failover#fnos-010-12) 的既有约定；样式使用 DSH 语义变量，亮暗主题下激活态与普通态均可读。**可见文案固定为「智能搜索」，状态不进文案**（不得出现「智能搜索已关」类文案）；可访问名称是例外——读屏用户无法感知样式，名称仍须含状态描述。
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

- `FNOS-012-03-AC-01`：web profile 的 pnpm-workspace.yaml 存在指向失效版本的 `minimumReleaseAgeExclude` 条目（版本与清单不一致）时，安装/升级链路自动清理该 profile 的 lockfile 与 node_modules，并在 profile 目录重新完成 `pnpm install`。
- `FNOS-012-03-AC-02`：豁免条目与清单版本一致（含不存在 `minimumReleaseAgeExclude` 的 profile）时不触发清理与重装，安装/升级流程与现状一致；`minimumReleaseAgeExclude` 字段本身不被删除。
- `FNOS-012-03-AC-03`：清理重装后，清单内的插件全部按清单版本安装成功，`NO_MATURE_MATCHING_VERSION` 类发布日期拦截不再出现。
- `FNOS-012-03-AC-04`：清理过程不删除、不改写用户的插件配置与凭据数据；`minimumReleaseAgeExclude` 的让新发布插件正常安装的能力保持可用。

### FNOS-012-04

- `FNOS-012-04-AC-01`：npm 上 `@tnnevol/dsh-codex-auth`、`@tnnevol/dsh-codebuddy`、`@tnnevol/dsh-fnos`、`@tnnevol/dsh-semi-ui-showcase` 四个包的 `latest` 标签指向 `0.1.7-rc.2.2`。
- `FNOS-012-04-AC-02`：`npm i @tnnevol/<插件>`（不带 tag）安装到 `0.1.7-rc.2.2`，不再落在 `0.1.0-rc.7` 等早期版本；`0.2.0-rc.2.0` 仍通过 `next` 标签获取。
- `FNOS-012-04-AC-03`：后续发布流程包含 `latest` 维护约定，避免 `latest` 再次长期滞留。

### FNOS-012-05

- `FNOS-012-05-AC-01`：`@tnnevol/dsh-failover-search` 的 `compatibility.json` 的 `dshPluginApi.packages` 与 `package.json` 的 `@deepseek-ai/dsh-*` peer 依赖集合一致（当前为 16 个包）——源码与声明面不再有缺口。
- `FNOS-012-05-AC-02`：修正随下一次插件版本发布进入线上包；下载该版本解包核对其 `compatibility.json` 已含全部依赖（不只看版本号）。
- `FNOS-012-05-AC-03`：发布链路对该类「源码已修、线上包未含」的漏网有约束——发布后源码发生与产物相关的改动时，要么随下次版本发布并在发布前复核产物，要么在发布前完成；不得让线上包与仓库源码长期不一致。

### FNOS-012-06

- `FNOS-012-06-AC-01`：消息框左下角的智能搜索控件为药丸按钮形态，仅含「智能搜索」文案，原 Switch 控件与「智能搜索已关」类状态文案不再出现。
- `FNOS-012-06-AC-02`：开启（默认）时药丸按钮呈激活态样式，关闭时呈普通态，两种状态仅通过样式区分且视觉可辨；点击切换行为与 [FNOS-010-12-AC-02/03](/requirements/FNOS-010-thirdparty-web-search-failover#fnos-010-12) 一致。
- `FNOS-012-06-AC-03`：亮色与暗色主题下激活态与普通态均清晰可辨，样式使用 DSH 语义变量；键盘可达与可访问名称保持——可访问名称仍含状态描述（读屏用户无法感知样式，需要靠它判断当前状态）。

### 验收环境范围

- FNOS-012-01 在 DSH Web 与 DSH Desktop 验收。
- FNOS-012-02 在 DSH Web 与 DSH Desktop 验收；涉及真实服务端交互的部分按既有网络/账号条件验证。
- FNOS-012-03 在真实 fnOS NAS 验收（安装/升级链路整体走通）；检测与清理分支由本地自动化覆盖。
- FNOS-012-04 在 npm registry 验收（dist-tags 查询与默认安装行为核对），由持有发布权限者执行。
- FNOS-012-06 在 DSH Web 与 DSH Desktop 验收（控件双端可用，亮暗主题样式核对）。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-09 | 初始登记 | 建立 FNOS-012：/model 模型列表补充倍速展示（目录 `credits` 字段已存在，composer 选择组件不渲染 description 为缺失原因）；CLI 版本 `2.159.0 → 2.163.0`、WorkBuddy `5.6.2 → 5.77`。关联 PLAN-FNOS-012。 |
| 2026-10-10 | 新增 FNOS-012-05 | 范围扩展：`@tnnevol/dsh-failover-search` 的 `compatibility.json` 包清单落后于实际依赖（10 → 应为 16 个包），本轮新增的 `dsh-tools`/`dsh-agent`/`dsh-client-ui-conversation`/`dsh-web-fetch-http` 均未声明。源码已在提交 `f86a7e7` 修正，但**晚于 `v0.2.0-rc.2.1` 发布数十秒，未进入线上包**。与 FNOS-012-04 同源（发布产物与实际不符），故并入本需求而非另立。依据：源码 import 与 peerDependencies 比对、npm 发布时间与提交时间戳核对、已发布包解包验证。 |
| 2026-10-10 | 新增 FNOS-012-06 | 范围扩展：`dsh-failover-search` 消息框左下角「智能搜索」控件样式优化——从 Switch+文案改为药丸按钮（开启呈激活态、关闭呈普通态），移除 Switch 仅保留文案；会话级语义与默认开启沿用 [FNOS-010-12](/requirements/FNOS-010-thirdparty-web-search-failover#fnos-010-12)。 |
| 2026-10-09 | 新增 FNOS-012-03 | 范围扩展：web profile 安装/升级链路检测 `minimumReleaseAgeExclude` 失效条目（版本与清单不一致），随后清理 lockfile 与 node_modules 并重新 `pnpm install` 自愈；字段保留不删除。依据：本地 profile 实测残留旧锚定；Discussions #11 证实 pnpm 豁免规则 First-Match-Wins 陷阱；字段的作用是让新发布插件正常安装，保留。 |
| 2026-10-09 | 修正 FNOS-012-03/04 表述 | 03 由「移除字段」修正为「失效条目触发依赖重建，字段保留」；04 命令修正为 `npm dist-tag add`（`dist-tag set` 非有效子命令），补充 `pnpm publish --tag` 与 registry HTTP PUT 两种方式。 |
| 2026-10-09 | 新增 FNOS-012-04 | 范围扩展：npm `latest` 标签校正。原因分析——发布链路只发 `next`、`latest` 从未跟随迭代且无校正机制，导致四个插件 `latest` 停在早期版本（`dsh-codex-auth` → `0.1.0-rc.7`）。解决方式——`latest` 维护自动化进 publish 命令（新代际首版发布时自动指向上一代最新稳定版 `0.1.7-rc.2.2`，同代际迭代不动 `latest`），并附应急手工校正命令；执行需 npm 发布权限（当前环境 token 失效，待权限恢复后执行）。 |
| 2026-10-10 | 新增 FNOS-012-05 | 范围扩展：`@tnnevol/dsh-failover-search` 的 `compatibility.json` 包清单落后于实际依赖（10 → 应为 16 个包），本轮新增的 `dsh-tools`/`dsh-agent`/`dsh-client-ui-conversation`/`dsh-web-fetch-http` 均未声明。源码已在提交 `f86a7e7` 修正，但**晚于 `v0.2.0-rc.2.1` 发布数十秒，未进入线上包**。与 FNOS-012-04 同源（发布产物与实际不符），故并入本需求而非另立。依据：源码 import 与 peerDependencies 比对、npm 发布时间与提交时间戳核对、已发布包解包验证。 |
