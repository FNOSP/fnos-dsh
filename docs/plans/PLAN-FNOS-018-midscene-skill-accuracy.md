---
id: PLAN-FNOS-018
title: PLAN-FNOS-018 Midscene 桥接使用说明准确性修正
description: 实施 FNOS-018：按实测结果修正 dsh-midscene 技能与 BRIDGE_PRELUDE 中的静默连接写法、Bridge 能力边界与 SDK 路径的 .env 加载方式，并确保每段示例都可原样执行。
status: planned
owner: tnnevol
planDate: 2026-10-18
targetVersion: 5.9.0
lastVerified: 2026-10-18
---

# PLAN-FNOS-018 Midscene 桥接使用说明准确性修正

| 字段 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-018 |
| 计划日期 | 2026-10-18 |
| 对应需求 | [FNOS-018 Midscene 桥接使用说明准确性修正](/requirements/FNOS-018-midscene-skill-accuracy) |
| 本轮功能 | FNOS-018-01 至 FNOS-018-04 |
| 计划状态 | <Badge type="tip" text="已完成" /> |

## 计划目标

让 `dsh-midscene` 技能与 `BRIDGE_PRELUDE` 中每段示例代码都能**按原样跑通**，并写明 Bridge 模式的能力边界，使 agent 一次选对路径。

## 当前实现与目标设计

| 领域 | 当前表述 | 目标表述 | 依据 |
| --- | --- | --- | --- |
| 静默连接 | `setActiveTabId(Number.parseInt(...), { activate: false })` | 先 `setActiveTabId(数字 id)` 选中标签页，再 `connectCurrentTab({ activateTab: false })` 连接 | `setActiveTabId` 只收一个参数；`activateTab` 属 `BridgeConnectTabOptions` |
| 标签页 id 类型 | 「id 必须传数字」 | **保留**，并补上「传字符串会触发 `tabs.update` 签名错」的原因 | 实测报错原文 |
| 验证静默效果 | 无 | 用 `getBrowserTabList()` 的 `currentActiveTab` 字段自证 | 实测标签页结构含该字段 |
| Bridge 取证能力 | 未提及 | 明确「不支持 `evaluate`（返回值恒为 `undefined` 且不报错）」，给出三条替代路径 | 类型声明无 `evaluate` + 实测 |
| `.env` 加载 | 只说「存成运行目录的 .env」 | 区分 CLI（自动加载当前目录）与 SDK（需注入进程环境，附示例） | 实测 `aiModel` 报 `MIDSCENE_MODEL_NAME is required` |
| 桥接口字段 | `port` / `fixedModelName` / `family`；env 四行 | **保留**（与实测一致） | 对运行中桥的响应核对 |

### 修改面

只改两个文件：

1. `plugins/dsh-midscene-plugin/skills/dsh-midscene/SKILL.md`（插件自有技能，非上游）
2. `plugins/dsh-midscene-plugin/src/host/skills.ts` 的 `BRIDGE_PRELUDE`（注入到全部技能的引用块）

官方 7 个技能文件**不动**——`SOURCE.md` 已约定它们与上游逐字节一致，环境约束一律通过 PRELUDE 注入。

## 影响范围分析

| 需求功能 | 代码模块 | 配置/数据 | 测试 | 文档 | 目标环境 |
| --- | --- | --- | --- | --- | --- |
| FNOS-018-01 | `skills.ts` 的 PRELUDE、`SKILL.md` 第二步 | 无 | PRELUDE 内容断言 | 技能本身即文档 | 本地 + 真实 Chrome |
| FNOS-018-02 | 同上（新增边界说明） | 无 | 同上 | 同上 | 本地 |
| FNOS-018-03 | 同上（区分两种加载） | 无 | 同上 | 同上 | 本地 |
| FNOS-018-04 | 不改（已正确） | 无 | 既有桥接口用例 | — | 本地 |

不涉及：桥接服务实现、上游技能文件、`compatibility.json` 与依赖、模型路由。

## 分阶段任务

### 阶段一：修正与本地验证

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-018-T01-01 | FNOS-018-01 / AC-01～AC-03 | 改写 PRELUDE 与 SKILL.md 的静默连接示例：拆成 `setActiveTabId(数字)` + `connectCurrentTab({ activateTab: false })`；补 id 类型原因；补 `currentActiveTab` 自证方法 | 无 | 示例原样执行不抛错；连接后前台标签页不变 |
| PLAN-FNOS-018-T01-02 | FNOS-018-02 / AC-01、AC-02 | 写明 Bridge 模式不支持 `evaluate` 及其表现（返回 `undefined`、不报错），给出三条替代取证路径 | 无 | 按说明选取证路径可得到结果 |
| PLAN-FNOS-018-T01-03 | FNOS-018-03 / AC-01、AC-02 | 区分 CLI 与 SDK 的 `.env` 加载；SDK 示例给出进程环境注入写法 | 无 | SDK 示例可让 `aiQuery` 正常返回 |
| PLAN-FNOS-018-T01-04 | FNOS-018-04 / AC-01 | 核对桥接口描述无需改动；补一条断言用例防止将来漂移 | 无 | 单测通过 |

## 依赖、风险和决策

### 已决定事项

1. **只改插件自有技能与 PRELUDE**：上游技能逐字节一致是既有约定，破坏它会让后续同步成本上升。
2. **不新增桥的能力**：`evaluate` 缺失是上游 SDK 的限制，插件不越界补一个自研 RPC。
3. **保留「id 必须传数字」**：这是实测证实的正确结论，与本次要修的错误写法不是一回事。
4. **PRELUDE 与 SKILL.md 同步改**：PRELUDE 会注入到全部 8 个技能，只改 SKILL.md 会导致其它技能里仍是旧写法。

### 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 上游 SDK 后续版本改了选项名 | 说明再次过期 | 说明中标注所依据的 SDK 版本（v1.16.0 CLI / v1.15.0 浏览器侧） |
| 只改 PRELUDE 漏改 SKILL.md（或反之） | 两处说法不一致 | T01-01 明确要求两处同步；用例断言两处都含新写法 |
| 把「静默」写成绝对保证 | 用户以为任何路径都静默 | 说明区分 SDK 路径（可静默）与 CLI 路径（必然激活） |

### 回退方案

文档回退：还原两个文件的文本即可，无运行时影响、无数据变更。

## 测试、打包、发布和回滚

- **本地**：PRELUDE 与 SKILL.md 内容断言（含新写法、含边界说明、保留正确结论）；插件 `check`。
- **实测**：在真实 Chrome 上按说明执行一遍静默连接与一次视觉查询。
- **发布**：插件补丁版本发布，`skills/` 随包分发（`files` 已含）。
- **回滚**：见上节。

## 参考资料

- 技能来源与注入机制：`plugins/dsh-midscene-plugin/skills/SOURCE.md`
- 注入实现：`plugins/dsh-midscene-plugin/src/host/skills.ts`
- 桥接服务：`plugins/dsh-midscene-plugin/src/host/bridge-server.ts`
- 上游类型声明（判定依据）：`@midscene/web` 的 `bridge-mode/agent-cli-side.d.ts`、`bridge-mode/common.d.ts`

## 完成状态

| 阶段 | 任务 | 状态 |
| --- | --- | --- |
| 一：修正与本地验证 | T01-01～T01-04 | <Badge type="tip" text="已完成" /> |

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-18 | 初始登记 | 建立 PLAN-FNOS-018，单阶段 4 个任务。修改面锁定为插件自有技能与 `BRIDGE_PRELUDE` 两个文件，上游 7 个技能不动。已写明四项决策与「两处必须同步改」的风险。 |
