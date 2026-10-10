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
| FNOS-010 | [三方搜索接入与官方兜底](/tests/FNOS-010-thirdparty-web-search-failover) | [PLAN-FNOS-010](/plans/PLAN-FNOS-010-thirdparty-web-search-failover) | 通过 | 单元、真实网络、会话内三层通过；DSH Web 与 DSH Desktop 双客户端验收通过；随插件 v0.2.0-rc.2.1 发布 |
| FNOS-011 | [凭据文件权限异常的可诊断性](/tests/FNOS-011-credential-permission-diagnostics) | [PLAN-FNOS-011](/plans/PLAN-FNOS-011-credential-permission-diagnostics) | 规划中 | 尚未执行 |
| FNOS-012 | [CodeBuddy 模型倍速展示与客户端版本更新](/tests/FNOS-012-codebuddy-model-speed-and-client-version) | [PLAN-FNOS-012](/plans/PLAN-FNOS-012-codebuddy-model-speed-and-client-version) | 规划中 | 尚未执行；FNOS-012-05 的缺口已在 FNOS-010 发布验收中发现并修复源码，线上包待随版本发布核对 |

新增测试用例文档先登记在本页，并在 `docs/.vitepress/config.mts` 的测试用例 sidebar 加入条目。
