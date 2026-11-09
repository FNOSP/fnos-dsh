---
id: FNOS-051
title: FNOS-051 OpenCode 模型思考能力与上下文对齐真实接口
description: 把 OpenCode 模型的思考档位与上下文窗口改用账号接口的实时能力声明，取代静态文档目录，并让只有开关没有档位的模型不再显示思考等级切换。
status: in-review
owner: tnnevol
targetVersion: 8.1.6
lastVerified: 2026-11-09
---

# FNOS-051 OpenCode 模型思考能力与上下文对齐真实接口

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-051 |
| 提出日期 | 2026-11-09 |
| 需求状态 | 待验收 |
| 关联计划 | [PLAN-FNOS-051 模型能力对齐](/plans/PLAN-FNOS-051-opencode-capability-alignment) |
| 适用范围 | `plugins/dsh-opencode-plugin` 的目录构建（`host/catalog.ts`）与思考等级映射 |
| 明确排除 | DSH 侧的思考档位语义；其它插件（Codex / ZCode）的模型能力来源 |

## 需求背景

模型的「思考档位」与「上下文窗口」此前主要取自静态目录 `models.opencode.ai/api.json`，缺失时才回落到 pi-ai 内置目录与固定默认值。

实测（2026-11-09，Go 订阅账号）发现该来源不可靠：

- **覆盖率不足**：Go 侧 30 个模型里，公开目录只收录 26 个。`kimi-k3.1-pro`、`minimax-m3.1-flash`、`iceman-contributor-free`、`hy4` 四个**完全查不到**，最终落到默认上下文 262,144、思考能力判为不支持。
- **数据过时**：`minimax-m3` 目录写 512,000，账号接口写 1,000,000；`qwen3.8-max` 目录写 262,144，账号接口写 1,000,000。
- **账号接口才是权威**：`GET /inference/go/v1/models` 对 30/30 个模型都返回 `capabilities.reasoning` 与 `limit.context`，且反映当前账号真实可用的模型集合。

真实调用实测（同一 Go 订阅 key）：

| 验证项 | 结果 |
| --- | --- |
| `kimi-k3.1-pro` 处理 310,093 prompt tokens | HTTP 200 成功 —— 远超默认值 262,144，证明真实上限是账号接口声明的 1,048,576 |
| `qwen3.8-max` 处理约 9 万 tokens | HTTP 200 成功 |
| `kimi-k3.1-pro` 的 `low` / `high` / `max` | `reasoning_content` 长度分别为 198 / 287 / 145，completion 分别为 73 / 110 / 128 —— 档位真实改变思考深度 |
| 发送无效档位 `bogus` | 仍返回 HTTP 200 —— 上游**不校验**档位名，无法靠报错探测 |

第二类问题是档位显示与实际能力不符：只有「开关」没有档位分级的模型（如 `mimo-v2.6-pro` 的 `toggle`）当前会显示完整的 `minimal/low/medium/high/xhigh/max` 档位，但上游只支持开关，用户选了也不会生效。

## 需求目标

| 编号 | 功能 | 用户可观察结果 |
| --- | --- | --- |
| FNOS-051-01 | 思考档位取自账号接口 | 有档位分级的模型显示真实档位；文档缺失的模型也能显示 |
| FNOS-051-02 | 上下文窗口取自账号接口 | 上下文显示真实上限，长对话不再被提前压缩 |
| FNOS-051-03 | 只有开关的模型不显示档位 | `toggle` 型模型不再出现无法生效的档位选项 |
| FNOS-051-04 | 单档模型按内置口径处理 | 只有一档的模型只把该档标为可用，其余不受支持 |

### FNOS-051-01 思考档位取自账号接口

新增从模型清单读取 `capabilities.reasoning` 的能力：`{ supported: true, effort: [...] }` 的 `effort` 数组即真实档位。回落链改为**账号接口 → Console → 公开目录 → pi-ai 内置 → 默认值**。

### FNOS-051-02 上下文窗口取自账号接口

新增从模型清单读取 `limit.context` 与 `limit.output`，插入同一回落链首位。实测已证明公开目录低估了至少 3 个模型。

### FNOS-051-03 只有开关的模型不显示档位

上游返回 `{ supported: true }` 且不带 `effort` 时（`toggle` 型），不再返回「未定义」交给 pi-ai 默认档位，而是把所有档位显式标为不支持。pi-ai 的语义是：缺省键用 provider 默认等级，`null` 表示该等级不受支持——因此要让选择器不出现档位切换，必须显式标 `null`，而不是留空。

### FNOS-051-04 单档模型按内置口径处理

只有一个档位的模型（如 `kimi-k3` 的 `effort: ["max"]`）沿用 pi-ai 内置目录的既有做法：只把该档映射为可用，其余档位标为不支持。不新增「单档等于开关」的特殊规则。

## 验收条件

| 编号 | 验收条件 | 判定方式 |
| --- | --- | --- |
| [AC-01](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-01-思考档位取自账号接口) | 文档缺失的 4 个模型能读到真实档位 | 单元测试 + 真实接口核对 |
| [AC-02](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-02-上下文窗口取自账号接口) | 上下文不再被公开目录低估 | 单元测试 + 真实接口核对 |
| [AC-03](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-03-只有开关的模型不显示档位) | toggle 型模型所有档位标为不支持 | 单元测试 |
| [AC-04](/requirements/FNOS-051-opencode-capability-alignment#fnos-051-04-单档模型按内置口径处理) | 单档模型只保留该档 | 单元测试 |

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-09 | 建立需求：以真实接口与真实调用证据确立「账号接口优先」的口径，并明确 toggle 型的档位处理 |
