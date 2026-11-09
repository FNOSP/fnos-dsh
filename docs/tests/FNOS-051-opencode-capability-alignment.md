---
id: FNOS-051
title: FNOS-051 测试用例
description: OpenCode 模型思考能力与上下文对齐真实接口的用例设计、执行结果与问题记录。
requirement: /requirements/FNOS-051-opencode-capability-alignment
plan: /plans/PLAN-FNOS-051-opencode-capability-alignment
status: 通过
lastVerified: 2026-11-09
verifiedAt: 2026-11-09
---

# FNOS-051 测试用例

被测对象是 OpenCode 模型目录的能力解析：思考档位与上下文窗口的来源与回落顺序，以及 `zen` → `console` 的命名统一。需求见 [FNOS-051](/requirements/FNOS-051-opencode-capability-alignment)。

## 测试范围与需求分析

| 编号 | 功能 | 关键风险点 |
| --- | --- | --- |
| [FNOS-051-01](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-01-思考档位取自账号接口) | 思考档位取自账号接口 | 解析失败退回旧行为；`supported: false` 被误判成 toggle |
| [FNOS-051-02](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-02-上下文窗口取自账号接口) | 上下文取自账号接口 | 被静态目录低估；同名模型在 zen/go 两段的取值混淆 |
| [FNOS-051-03](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-03-只有开关的模型不显示档位) | toggle 型不显示档位 | 返回 `undefined` 会让界面列出全套无效档位 |
| [FNOS-051-04](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-04-单档模型按内置口径处理) | 单档模型按内置口径 | 自创「单档等于开关」规则会与 pi-ai 不一致 |
| 命名统一 | zen → console | 遗漏导致运行时混用；旧偏好失配 |

## 测试环境

| 功能 | 环境 | 说明 |
| --- | --- | --- |
| 能力解析 | 单元测试 | `cd plugins/dsh-opencode-plugin && pnpm run test` |
| 真实接口对照 | 真实 OpenCode Go 订阅账号 | 只读拉取 `/go/v1/models` 与公开目录比对 |
| 真实调用 | 同上 | 验证上下文上限与档位实际效果 |

### 版本三元组

| 环境 | 记录项 | 实测值 |
| --- | --- | --- |
| 本地 | 插件版本 | `8.1.6` |
| 真实 OpenCode | Go 订阅账号 | rolling 20% / weekly 8% / monthly 75% |

## 测试用例

### FNOS-051-01 思考档位取自账号接口

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-051-01](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-01-思考档位取自账号接口) | 有档位的模型读出真实档位 | [AC-01](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-01-思考档位取自账号接口) | 清单含 `effort: [low,high,max]` | 解析 | 映射出这三个可用档位，其余标 null | P0 | 新增行为 |
| TC-002 | 同上 | 文档缺失的模型也能拿到能力 | AC-01 | 清单有、公开目录无 | 构建目录 | 上下文与档位均来自清单，不落默认值 | P0 | 新增行为 |
| TC-003 | 同上 | 明确不支持的模型不进映射表 | AC-01 | `supported: false` | 解析 | 该模型不出现思考设置 | P0 | 新增行为 |

### FNOS-051-02 上下文窗口取自账号接口

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-004 | [FNOS-051-02](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-02-上下文窗口取自账号接口) | 上下文不被静态目录低估 | [AC-02](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-02-上下文窗口取自账号接口) | 目录 262144、清单 1048576 | 构建目录 | 取 1048576 | P0 | 新增行为 |
| TC-005 | 同上 | 真实接口实测 `kimi-k3.1-pro` 超过 262K | AC-02 | Go 订阅 key | 发送 310,093 tokens | HTTP 200 成功 | P0 | 新增行为 |
| TC-006 | 同上 | 真实接口实测 `qwen3.8-max` 长输入 | AC-02 | 同上 | 发送约 9 万 tokens | HTTP 200 成功 | P1 | 新增行为 |

### FNOS-051-03 只有开关的模型不显示档位

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-007 | [FNOS-051-03](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-03-只有开关的模型不显示档位) | toggle 型所有档位标 null | [AC-03](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-03-只有开关的模型不显示档位) | `toggle: true` | 解析 | 六个档位全为 null，且不含 `off` 键 | P0 | 新增行为 |
| TC-008 | 同上 | budget 型连关闭也标 null | AC-03 | `budget` 有值 | 解析 | `off: null` | P1 | 新增行为 |

### FNOS-051-04 单档模型按内置口径

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-009 | [FNOS-051-04](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-04-单档模型按内置口径处理) | 只有 `max` 的模型只保留该档 | [AC-04](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-04-单档模型按内置口径处理) | `effort: [max]` | 解析 | `max: 'max'`，其余 null | P0 | 基线：pi-ai 内置 `kimi-k3` |

### 命名统一

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-010 | 命名统一 | plan 类型与模型前缀改为 console | — | — | 检查类型与前缀 | `'console' \| 'go'`、`console:` 前缀 | P0 | 基线：原 `zen` |
| TC-011 | 命名统一 | 产物中不再出现旧名 | — | 已构建 | 检查 `lib/*.js` | `OpenCode Zen` 为 0 处 | P0 | 新增行为 |

## 测试执行结果

执行时间 2026-11-09，环境：本机单元测试 + 真实 OpenCode Go 订阅账号接口。

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-051-01 | 单元测试 | 通过 | 2026-11-09 | 三个档位可用，其余 null |
| TC-002 | FNOS-051-01 | 单元测试 | 通过 | 2026-11-09 | 构建目录取到 1048576 与真实档位 |
| TC-003 | FNOS-051-01 | 单元测试 | 通过 | 2026-11-09 | 不进映射表 |
| TC-004 | FNOS-051-02 | 单元测试 | 通过 | 2026-11-09 | 采信清单 1048576 |
| TC-005 | FNOS-051-02 | 真实接口 | 通过 | 2026-11-09 | `prompt_tokens: 310093`，HTTP 200 |
| TC-006 | FNOS-051-02 | 真实接口 | 通过 | 2026-11-09 | 360,115 字节请求体成功 |
| TC-007 | FNOS-051-03 | 单元测试 | 通过 | 2026-11-09 | 全 null 且无 `off` 键 |
| TC-008 | FNOS-051-03 | 单元测试 | 通过 | 2026-11-09 | `off: null` |
| TC-009 | FNOS-051-04 | 单元测试 | 通过 | 2026-11-09 | `max: 'max'` |
| TC-010 | 命名统一 | 源码核对 | 通过 | 2026-11-09 | 类型与前缀均为 console |
| TC-011 | 命名统一 | 产物核对 | 通过 | 2026-11-09 | `OpenCode Zen` 0 处、`OpenCode Console` 26 处 |

全量回归：单元测试 **367 条通过**，typecheck 与 build 均通过。

### 真实接口对照（30 个 Go 模型）

| 指标 | 数量 |
| --- | --- |
| 上下文与公开目录不一致 | **15/30** |
| 档位与公开目录不一致 | **20/30** |
| 公开目录完全缺失 | **13/30** |

被文档低估的典型：`minimax-m3` 512,000 → 实际 1,000,000；`qwen3.8-max` 262,144 → 实际 1,000,000。

档位实测（`kimi-k3.1-pro`）：

| 档位 | reasoning 内容长度 | completion tokens |
| --- | --- | --- |
| low | 198 | 73 |
| high | 287 | 110 |
| max | 145 | 128 |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | [TC-003](#fnos-051-01-思考档位取自账号接口) | `supported: false` 被误判成 toggle | P1 | 已修复 | `readReasoning` 把 `supported: false` 与「toggle 无档位」都规约成 `effort: []`，下游无法区分。初版改动让明确不支持的模型返回了全 null 映射（等于给了思考设置）。已在 `thinkingLevelMapFromReasoning` 入口先拦 `supported: false` |
| BUG-02 | [TC-004](#fnos-051-02-上下文窗口取自账号接口) | 测试取错 plan 条目导致误判缺陷 | P2 | 已修复 | 同名模型在 zen/go 两段各生成一条记录，初版测试取第一条（zen 段）得到旧值，误以为回落链失效。实际回落链正确，测试改为按 `plan === 'go'` 选取 |

## 测试结论

**结论：通过。** 11 条用例全部通过（另有 2 条 Bug 均为实现/测试期发现并修复）。

覆盖情况：

- [AC-01](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-01-思考档位取自账号接口) 至 [AC-04](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-04-单档模型按内置口径处理) 均有对应用例，命名统一另有 2 条。
- 真实接口与真实调用双重验证，不是仅靠构造数据。

遗留风险：

1. **档位名合法性无法用调用验证**：上游对 `reasoning_effort: "bogus"` 仍返回 200，说明不校验该字段。档位是否真正生效只能靠 `reasoning_content` 长度差异间接判断。
2. **未做 DSH 界面目视**：toggle 型模型「不显示档位」的最终效果需要在实际界面确认，单元测试只验证映射数据。
3. **旧偏好失效**：按用户决定不写迁移，已有用户的 zen 隐藏模型与端点偏好会重置。
