---
id: FNOS-018
title: FNOS-018 测试用例
description: FNOS-018 Midscene 桥接使用说明准确性修正的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-018-midscene-skill-accuracy
plan: /plans/PLAN-FNOS-018-midscene-skill-accuracy
status: 通过
lastVerified: 2026-10-18
verifiedAt: 2026-10-18
---

# FNOS-018 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-018 |
| 关联需求 | [FNOS-018 Midscene 桥接使用说明准确性修正](/requirements/FNOS-018-midscene-skill-accuracy) |
| 关联计划 | [PLAN-FNOS-018 Midscene 桥接使用说明准确性修正](/plans/PLAN-FNOS-018-midscene-skill-accuracy) |
| 测试状态 | <Badge type="tip" text="通过（9 条全部通过）" /> |

## 测试范围与需求分析

覆盖 [功能列表](/requirements/FNOS-018-midscene-skill-accuracy#功能列表) 中 FNOS-018-01 至 FNOS-018-04。

这类「文档缺陷」的测试有个特殊难点：**文本看起来合理不代表能跑通**。因此用例分两层：

- **内容层**：断言说明里出现了正确写法、且不再出现错误写法（可自动化、防回归）。
- **执行层**：把说明里的示例**原样**跑一遍，看实际结果（必须真机，无法 mock）。

只做内容层会漏掉「写对了但跑不通」；只做执行层则无法防后续回归。

第二个难点是「静默」的判定：它不是可读的属性，只能通过 `getBrowserTabList()` 的 `currentActiveTab` 字段观察连接前后是否变化。

❓ 待核实项：上游 SDK 后续版本若改名（`activateTab` → 其它），本说明需同步；用例中的版本标注用于暴露这种漂移。

## 测试环境

| 功能 | 目标环境 |
| --- | --- |
| [FNOS-018-01](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-01) | 本地 + 真实 Chrome（Bridge 模式） |
| [FNOS-018-02](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-02)、[FNOS-018-03](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-03) | 本地命令行（运行中的桥 + 视觉查询） |
| [FNOS-018-04](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-04) | 本地构测环境 |

版本基线：`@midscene/web` v1.16.0（CLI 侧）/ v1.15.0（浏览器扩展侧）；桥端口以 `/v1/health` 的 `port` 为准。

## 测试用例

### [FNOS-018-01 静默连接写法修正](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-018-01](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-01) | 说明中的静默示例可原样执行 | AC-01 | Chrome 已装扩展并完成桥配置；存在目标标签页 | 1.按说明原样执行示例 2.观察是否抛错 | 不抛错，成功连到目标标签页 | P0 | 缺陷场景 |
| TC-002 | [FNOS-018-01](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-01) | 连接不改变用户前台标签页 | AC-02 | 用户当前正看着某个标签页 | 1.记录连接前 `currentActiveTab` 2.执行连接 3.再读一次 | 两次 `currentActiveTab` 相同 | P0 | 缺陷场景 |
| TC-003 | [FNOS-018-01](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-01) | 说明保留 id 必须传数字 | AC-03 | — | 检查说明文本 | 仍写明 id 传数字并说明原因（字符串会触发 `tabs.update` 签名错） | P1 | 实测结论 |

### [FNOS-018-02 Bridge 能力边界写明](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-004 | [FNOS-018-02](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-02) | 说明明确不支持 evaluate | AC-01 | — | 检查说明文本 | 写明 Bridge 模式无 `evaluate`，且其返回值为 `undefined` 不报错 | P0 | 实测结论 |
| TC-005 | [FNOS-018-02](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-02) | 替代取证路径可用 | AC-02 | 桥运行中 | 1.按说明用视觉 Agent 查询页面 2.按说明从目标环境日志核对 | 两种方式都能得到可断言的结果 | P0 | 实测结论 |

### [FNOS-018-03 SDK 路径 .env 加载](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-006 | [FNOS-018-03](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-03) | 说明区分 CLI 与 SDK | AC-01 | — | 检查说明文本 | 明确指出 CLI 自动加载当前目录 `.env`，SDK 不加载 | P1 | 实测结论 |
| TC-007 | [FNOS-018-03](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-03) | SDK 注入写法可用 | AC-02 | 已取到四行配置 | 1.按说明把四行注入进程环境 2.执行 `aiQuery` | 返回结果，不报 `MIDSCENE_MODEL_NAME is required` | P0 | 缺陷场景 |

### [FNOS-018-04 桥接口说明保持准确](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-008 | [FNOS-018-04](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-04) | 桥接口字段与说明一致 | AC-01 | 桥运行中 | 1.请求 `/v1/health` 与 `/v1/midscene-env` 2.对照说明 | `port`/`fixedModelName`/`family` 存在；env 恰为四行非注释内容 | P2 | 实测结论 |
| TC-009 | [FNOS-018-04](/requirements/FNOS-018-midscene-skill-accuracy#fnos-018-04) | 两处文案同时更新 | — | — | 断言 `BRIDGE_PRELUDE` 与 `SKILL.md` 都含新写法、都不含 `activate: false` | 两处一致，无残留旧写法 | P0 | 回归要求 |

## 测试执行结果

| 用例范围 | 总数 | 通过 | 失败 | 阻塞 | 未执行 |
| --- | --- | --- | --- | --- | --- |
| TC-001～TC-003（FNOS-018-01） | 3 | 3 | 0 | 0 | 0 |
| TC-004～TC-005（FNOS-018-02） | 2 | 2 | 0 | 0 | 0 |
| TC-006～TC-007（FNOS-018-03） | 2 | 2 | 0 | 0 | 0 |
| TC-008～TC-009（FNOS-018-04） | 2 | 2 | 0 | 0 | 0 |
| **合计** | **9** | **9** | **0** | **0** | **0** |

## Bug 记录

| Bug ID | 关联用例 | 现象 | 根因 | 状态 |
| --- | --- | --- | --- | --- |
| BUG-01 | TC-001、TC-002 | 按说明写 `setActiveTabId(id, { activate: false })`，不报错但静默开关无效 | `setActiveTabId` 只接受一个参数，第二参数被静默忽略；静默字段实际是 `connectCurrentTab` 的 `activateTab` | 已修复：说明改为单步 `connectCurrentTab({ activateTab: false })` |
| BUG-02 | TC-001 | 按初版修复方案写「先 `setActiveTabId` 再 `connectCurrentTab`」，报 `Active tab id is already set` | 已连接状态下再设同一 tab 被拒绝；两者不是可串联的两步，`connectCurrentTab` 本身就完成连接 | 已修复：说明改为单步写法，并明确劝阻两步式 |
| BUG-03 | TC-005 | 用 `agent.page.evaluate(...)` 取页面数据返回 `undefined`，不抛错 | Bridge 模式的类型声明里没有 `evaluate`，调用静默失败 | 已修复：说明写明该限制并给出三条替代取证路径 |
| BUG-04 | TC-007 | 把四行写进运行目录 `.env` 后 `aiQuery` 仍报 `MIDSCENE_MODEL_NAME is required` | CLI 路径才自动加载当前目录 `.env`，SDK 路径需注入进程环境 | 已修复：说明区分两种加载方式并给出注入命令 |

## 测试结论

9 条用例全部通过。

内容层（TC-003、TC-004、TC-006、TC-008）与执行层（TC-001、TC-002、TC-005、TC-007）均成立，TC-009 确认 `BRIDGE_PRELUDE` 与 `SKILL.md` 两处说法一致。

实测数据：修正后的静默连接不抛错，连接前后 `currentActiveTab` 均为 `http://127.0.0.1:3080/`（用户前台标签页未被夺走）；视觉查询正常返回「适配 v0.2.1-rc.2 插件升级」。

**过程中发现的额外缺陷**：按需求阶段的分析，原本只登记了三处不符。实测修正后的写法时又暴露了第四处——「先 `setActiveTabId` 再 `connectCurrentTab`」的两步式组合会报 `Active tab id is already set`，两个调用不可串联。这说明这类文档缺陷无法靠通读发现，必须逐段执行验证；已作为 BUG-02 登记。

上游 7 个技能文件保持逐字节一致（`SOURCE.md` 哈希用例通过），本次修改只落在插件自有的 `dsh-midscene` 技能与 `BRIDGE_PRELUDE`。
