---
id: PLAN-FNOS-051
title: PLAN-FNOS-051 OpenCode 模型思考能力与上下文对齐真实接口
description: 把模型思考档位与上下文窗口改用账号接口的实时能力声明，并统一 console 命名的实施计划。
status: in-review
owner: tnnevol
planDate: 2026-11-09
targetVersion: 8.1.6
lastVerified: 2026-11-09
---

# PLAN-FNOS-051 OpenCode 模型思考能力与上下文对齐真实接口

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-051 |
| 计划日期 | 2026-11-09 |
| 对应需求 | [FNOS-051 OpenCode 模型思考能力与上下文对齐真实接口](/requirements/FNOS-051-opencode-capability-alignment) |
| 计划状态 | 待验收 |

## 计划目标

按 [FNOS-051](/requirements/FNOS-051-opencode-capability-alignment) 把模型能力来源从静态目录换到账号接口，并顺带完成 `zen` → `console` 的命名统一。

技术边界：只改 `plugins/dsh-opencode-plugin`；不改上游 OpenCode 协议，不改 DSH 侧思考等级语义。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 影响 |
| --- | --- | --- | --- |
| 思考档位来源 | Console → models.dev 目录 → pi-ai 内置 | **账号清单 → Console → 目录 → 内置** | 文档缺失的模型也能拿到真实档位 |
| 上下文来源 | Console → 目录 → 内置 → 默认 262144 | **账号清单 → Console → 目录 → 内置 → 默认** | 修正被低估的上下文 |
| toggle 型模型 | 返回 `undefined`（pi-ai 用默认档位，界面列出全套无效档位） | **所有档位标 `null`** | 不再显示无法生效的档位 |
| 单档模型 | 依赖内置目录 | 沿用内置口径：只把该档标为可用 | 与 pi-ai 一致 |
| plan 命名 | `zen` / `go` | **`console` / `go`** | 与 provider 显示名一致 |

## 关键约束

- **账号清单优先于静态目录**：实测（2026-11-09，Go 订阅账号）账号清单覆盖 30/30 个模型，公开目录只覆盖 26/30，且对 `minimax-m3`（512K vs 1M）、`qwen3.8-max`（262K vs 1M）低估。
- **`supported: false` 与 toggle 必须分开**：`readReasoning` 把两者都规约成 `effort: []`，因此在 `thinkingLevelMapFromReasoning` 入口必须先拦掉 `supported: false`，否则「明确不支持思考」会被当成 toggle。
- **改名会丢旧偏好**：用户已保存的 `zen:` 隐藏模型与 `endpointPlan: 'zen'` 在改名后失效。用户已确认「直接丢弃旧值」，因此不写迁移逻辑。
- **真实调用可验证档位生效，但不能验证档位名合法性**：发送无效档位 `bogus` 仍返回 200，说明上游不校验该字段。

## 实施任务

| 编号 | 任务 | 对应功能 | 写入范围 |
| --- | --- | --- | --- |
| T1 | 新增 `modelLimitFrom` / `modelReasoningFrom` 与 `rosterRows` | FNOS-051-01、02 | `src/host/catalog.ts` |
| T2 | roster 数据接入 `buildCatalog` 与 `CatalogEntryInput` | FNOS-051-01、02 | 同上 |
| T3 | 回落链调整为账号清单优先 | FNOS-051-01、02 | 同上 |
| T4 | toggle 型改为全部档位标 null；单档沿用内置口径 | FNOS-051-03、04 | 同上 |
| T5 | 补 `supported: false` 拦截，避免被误判成 toggle | FNOS-051-03 | 同上 |
| T6 | `zen` → `console` 改名（类型、前缀、偏好、文案、注释） | 命名统一 | 27 个文件 |
| T7 | 测试：新增 6 条覆盖账号清单优先与 toggle 语义 | 全部 | `tests/host/catalog.spec.ts` |

## 风险与回滚

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 账号清单结构与公开目录不同 | 解析失败 → 全部退回旧行为 | 两种响应形态（`data` / `models`）都接受；解析失败时不进映射表，回落链照常工作 |
| 旧偏好失效 | 用户隐藏的模型重现、端点重置 | 已确认按「丢弃旧值」处理 |
| toggle 判定影响既有模型 | 某些模型档位选项消失 | 与上游声明一致；单元测试钉住三种形态（有档位 / toggle / 不支持） |
| 改名遗漏 | 运行时混用两种命名 | 全仓 `grep zen` 复查；产物检查 `OpenCode Zen` 为 0 处 |

回滚：还原 `catalog.ts` 的回落链与 `identity.ts` 的 plan 类型即可；无数据迁移。

## 验证计划

| 层次 | 方式 |
| --- | --- |
| 单元 | `pnpm run test`（367 条，含新增 6 条） |
| 类型与构建 | `pnpm run typecheck`、`pnpm run build` |
| 真实接口 | 用 Go 订阅 key 拉 30 个模型，逐个对照 roster 与文档的上下文/档位差异 |
| 真实调用 | `kimi-k3.1-pro` 310,093 prompt tokens 成功；三档 `reasoning_content` 长度递增 |
| 产物 | 检查 `lib/*.js` 中 `OpenCode Zen` 为 0 处 |
