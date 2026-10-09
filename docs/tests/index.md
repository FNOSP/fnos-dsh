---
title: 测试用例
description: fnOS DSH 需求测试用例、执行结果与最终测试结论的索引。
---

# 测试用例

这里记录各需求的测试用例文档。测试用例文档与需求同编号（`FNOS-###`），关联对应的需求和计划，包含用例定义、执行结果、Bug 记录和最终测试结论；规范统一维护在[开发指南 → 章程规范 → 测试用例文档规范](/charter/tests-spec)。

## 回填规则

- 计划任务完成后，在同一变更中回填对应 `FNOS-###` 测试用例文档。
- 先登记用例，执行后只回填执行结果、Bug 与结论。
- 计划文档不再包含测试用例表，用例只维护在本板块。

## 测试用例文档

| 编号 | 需求 | 关联计划 | 测试状态 | 最终结论 |
| --- | --- | --- | --- | --- |
| FNOS-009 | [DSH 0.2.0-rc.2 插件适配](/tests/FNOS-009-dsh-020-rc2-adaptation) | [PLAN-FNOS-009](/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation) | 规划中 | 尚未执行 |
| FNOS-010 | [三方搜索接入与官方兜底](/tests/FNOS-010-thirdparty-web-search-failover) | [PLAN-FNOS-010](/plans/PLAN-FNOS-010-thirdparty-web-search-failover) | 部分通过 | 单元与真实网络两层通过；同平台多账号分摊、会话卡片走查、禁用回落与 DSH Desktop 待验收 |

新增测试用例文档先登记在本页，并在 `docs/.vitepress/config.mts` 的测试用例 sidebar 加入条目。
