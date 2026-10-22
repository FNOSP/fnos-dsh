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
| FNOS-011 | [凭据文件权限异常的可诊断性](/tests/FNOS-011-credential-permission-diagnostics) | [PLAN-FNOS-011](/plans/PLAN-FNOS-011-credential-permission-diagnostics) | 通过 | 验收通过（2026-10-16）：有效用例 12/12；6 条未执行全部因功能废弃。插件已发布 `0.2.0-rc.2.6` |
| FNOS-012 | [CodeBuddy 模型倍速展示与客户端版本更新](/tests/FNOS-012-codebuddy-model-speed-and-client-version) | [PLAN-FNOS-012](/plans/PLAN-FNOS-012-codebuddy-model-speed-and-client-version) | 通过 | 验收通过（2026-10-18）：28 条通过、0 失败、6 条未执行为环境或权限限制；TC-025 已解包核对线上 `0.2.1-rc.2.2` 产物确认修复 |
| FNOS-013 | [Midscene 浏览器自动化桥接插件](/tests/FNOS-013-midscene-browser-automation-bridge) | [PLAN-FNOS-013](/plans/PLAN-FNOS-013-midscene-browser-automation-bridge) | 通过 | 验收通过（2026-10-18）：58 条通过；2 条失败（TC-042/043）测的是 `@midscene/cli` 运行器，正式用例已改用 `@midscene/test` 不经过该路径，遗留 Bug 0 |
| FNOS-014 | [DSH 0.2.1-rc.2 插件适配与新能力支持](/tests/FNOS-014-dsh-021-rc2-adaptation) | [PLAN-FNOS-014](/plans/PLAN-FNOS-014-dsh-021-rc2-adaptation) | 部分通过 | 52 条中 38 通过、0 失败、5 阻塞（需真实 fnOS NAS）、9 未执行；DSH Web 与 DSH Desktop 双客户端通过 |
| FNOS-015 | [主题缓存写入死循环修复](/tests/FNOS-015-theme-cache-write-loop) | [PLAN-FNOS-015](/plans/PLAN-FNOS-015-theme-cache-write-loop) | 规划中 | 尚未执行（用例已登记 15 条） |
| FNOS-016 | [插件市场索引与插件元数据](/tests/FNOS-016-plugin-market-index) | [PLAN-FNOS-016](/plans/PLAN-FNOS-016-plugin-market-index) | 通过（双客户端） | 19 条全部通过；DSH Web 与 DSH Desktop 的发现页、详情页与兼容性判定均实测正常 |
| FNOS-017 | [fnOS 插件路由 403 误拒修复](/tests/FNOS-017-fnos-route-403) | [PLAN-FNOS-017](/plans/PLAN-FNOS-017-fnos-route-403) | 部分通过 | 10 条中 7 通过、3 待真机 |
| FNOS-018 | [Midscene 桥接使用说明准确性修正](/tests/FNOS-018-midscene-skill-accuracy) | [PLAN-FNOS-018](/plans/PLAN-FNOS-018-midscene-skill-accuracy) | 通过 | 9 条全部通过；发现并修正 4 处与 SDK 实际不符的表述 |
| FNOS-019 | [FPK 版本方案固定前缀与插件基线小尾巴](/tests/FNOS-019-fpk-version-scheme) | [PLAN-FNOS-019](/plans/PLAN-FNOS-019-fpk-version-scheme) | 通过 | 17 条全部通过；含真实 fnOS NAS 设备升级（同基线迭代号覆盖安装、裸 5.9.0 升级路径） |
| FNOS-020 | [CodeBuddy 瞬时 400 终止整轮修复](/tests/FNOS-020-codebuddy-transient-400) | [PLAN-FNOS-020](/plans/PLAN-FNOS-020-codebuddy-transient-400) | 通过 | 11 条全部通过；DSH Web 与 DSH Desktop 双客户端均已验证重试生效与首次 400 后自动恢复 |
| FNOS-021 | [Midscene 库能力对齐与接入简化](/tests/FNOS-021-midscene-library-integration) | [PLAN-FNOS-021](/plans/PLAN-FNOS-021-midscene-library-integration) | 规划中 | 尚未执行（用例已登记 69 条） |
| FNOS-024 | [CodeBuddy 403 纳入账号切换](/tests/FNOS-024-codebuddy-403-failover) | [PLAN-FNOS-024](/plans/PLAN-FNOS-024-codebuddy-403-failover) | 通过 | 9 条全部通过；桩 403 触发换号并完成，提示文本正确 |
| FNOS-023 | [CodeBuddy 受限账号触发自动切换](/tests/FNOS-023-codebuddy-restricted-account-failover) | [PLAN-FNOS-023](/plans/PLAN-FNOS-023-codebuddy-restricted-account-failover) | 通过 | 15 条全部通过；真实受限账号触发自动切换且提示可见；第二轮受限失败 0 次 |
| FNOS-022 | [CodeBuddy 模型调用被内容审核拦截修复](/tests/FNOS-022-codebuddy-content-block-fix) | [PLAN-FNOS-022](/plans/PLAN-FNOS-022-codebuddy-content-block-fix) | 通过 | 17 条全部通过；DSH Web 与 DSH Desktop 双客户端模型调用正常；本地桩注入验证只失败一次、不重试、不换号 |
| FNOS-025 | [CodeBuddy 插件下架](/tests/FNOS-025-codebuddy-plugin-delisting) | [PLAN-FNOS-025](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) | 部分通过 | 18 条中 16 条已通过（分发清单、文档站、仓库追踪、发布链路、升级清理五条链路）；真实 NAS 安装与升级验收 2 条待执行 |

新增测试用例文档先登记在本页，并在 `docs/.vitepress/config.mts` 的测试用例 sidebar 加入条目。
