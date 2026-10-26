---
id: FNOS-032
title: FNOS-032 测试用例
description: FNOS-032 OpenCode 辅助调用补齐会话头的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-032-opencode-aux-session-header
plan: /plans/PLAN-FNOS-032-opencode-aux-session-header
status: 执行中
lastVerified: 2026-10-26
verifiedAt: 2026-10-26
---

# FNOS-032 测试用例

## 测试范围与需求分析

被测对象是 `@tnnevol/dsh-opencode` 插件新增的会话头兜底：`src/host/provider.ts` 的 `ensureOpenCodeSessionHeader` 与 `withOpenCodeSessionFallback`，以及四个协议族的接线。执行任务见 [PLAN-FNOS-032](/plans/PLAN-FNOS-032-opencode-aux-session-header)，覆盖[需求功能](/requirements/FNOS-032-opencode-aux-session-header#功能列表)：

| 覆盖功能 | 关键风险点 |
| --- | --- |
| [FNOS-032-01](/requirements/FNOS-032-opencode-aux-session-header#fnos-032-01) 辅助调用不再因缺会话头中断 | 兜底值是否稳定；是否真的进入 HTTP 请求头；自动审查路径是否仍带不上头 |
| [FNOS-032-02](/requirements/FNOS-032-opencode-aux-session-header#fnos-032-02) 主对话会话头语义不变 | 是否会覆盖真实会话 id；是否会覆盖调用方已显式设置的头；是否只影响 OpenCode 路由 |

❓ 资料缺口：Auto 权限预设下的审查调用依赖真实 DSH 运行时与真实 OpenCode 账号，包级只能覆盖到「header 进入请求」；「审查请求成功返回」需真实会话验证。

## 测试环境

| 功能 | 目标环境 | 说明 |
| --- | --- | --- |
| FNOS-032-01 | 包级测试 ＋ DSH Web（Auto 权限预设） | 头注入可包级断言；审查成功需真实会话 |
| FNOS-032-02 | 包级测试 | 会话优先、显式头保留、两条 stream 路径 |

包级测试环境：插件工作区，`pnpm --filter @tnnevol/dsh-opencode run check`。

## 测试用例

### FNOS-032-01 辅助调用不再因缺会话头中断

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-001 | FNOS-032-01-AC-01 | 对没有 `sessionId` 的选项调用 `ensureOpenCodeSessionHeader` | 返回的 headers 含 `x-opencode-session`，值为 `OPENCODE_FALLBACK_SESSION_ID` | 包级 |
| TC-002 | FNOS-032-01-AC-01；FNOS-032-02-AC-01 | 通过 provider 的 `stream` 发一次真实请求（假 fetch 捕获头），第一次不带 `sessionId`，第二次带 `sessionId: 'session-z'` | 第一次头值等于兜底常量；第二次头值等于 `session-z` | 包级 |
| TC-006 | FNOS-032-01-AC-02 | DSH Web 切到 Auto 权限预设，会话模型选 `dsh-opencode` 的任一模型，触发一次工具调用 | 不再出现 `MissingSessionID`，工具调用继续执行 | DSH Web（待执行） |

### FNOS-032-02 主对话会话头语义不变

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-003 | FNOS-032-02-AC-01 | 对带 `sessionId: 'session-a'` 的选项调用补齐 | 头值为 `session-a`，不被兜底值替换 | 包级 |
| TC-004 | FNOS-032-02-AC-02 | 对已含 `X-OPEncode-Session: given` 的选项调用补齐 | 原头保留；不新增小写同名头 | 包级 |
| TC-005 | FNOS-032-02-AC-03、AC-04 | 空串 `sessionId` 走兜底；`stream` 与 `streamSimple` 两条路径分别验证；原 options 对象不被修改 | 空串用兜底；两条路径都补齐；原对象无 `headers` 新增 | 包级 |

## 测试执行结果

| ID | 结果 | 执行日期 | 证据/备注 |
| --- | --- | --- | --- |
| TC-001 | 通过 | 2026-10-26 | `provider.spec.ts`「无会话身份时补稳定兜底值」 |
| TC-002 | 通过 | 2026-10-26 | `provider.spec.ts`「真实请求路径：无会话身份时请求头包含兜底值」：假 fetch 捕获到兜底值与 `session-z` |
| TC-003 | 通过 | 2026-10-26 | 「有会话 id 时优先使用会话 id」 |
| TC-004 | 通过 | 2026-10-26 | 「调用方已有的头（大小写不敏感）不被覆盖」 |
| TC-005 | 通过 | 2026-10-26 | 「空会话 id 视为缺失」「stream 与 streamSimple 两条路径都会补齐」「不改写原 options 对象」 |
| TC-006 | 未执行 | — | 需 DSH Web 切 Auto 权限预设并真实触发工具调用；建议在插件更新后由提出人验证 |

包级汇总：插件 `check` 通过；`tests/host/provider.spec.ts` 19 条通过，插件全量 **16 个文件 / 207 条用例** 通过。

## Bug 记录

本需求包级验证未发现缺陷。

## 测试结论

包级验证完成：兜底值、会话优先、显式头保留与真实请求路径均通过。真实会话（Auto 权限预设）验证待执行，因此结论记为「执行中」，不以包级通过替代运行时验收。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-26 | 建立测试用例文档 | 6 条用例：5 条包级（已执行并通过）、1 条真实会话（待执行） |
