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
| FNOS-021 | [Midscene 库能力对齐与接入简化](/tests/FNOS-021-midscene-library-integration) | [PLAN-FNOS-021](/plans/PLAN-FNOS-021-midscene-library-integration) | 通过 | 整体验收通过（64/75 条通过、11 条未执行且不阻塞；详见测试记录） |
| FNOS-024 | [CodeBuddy 403 纳入账号切换](/tests/FNOS-024-codebuddy-403-failover) | [PLAN-FNOS-024](/plans/PLAN-FNOS-024-codebuddy-403-failover) | 通过 | 9 条全部通过；桩 403 触发换号并完成，提示文本正确 |
| FNOS-023 | [CodeBuddy 受限账号触发自动切换](/tests/FNOS-023-codebuddy-restricted-account-failover) | [PLAN-FNOS-023](/plans/PLAN-FNOS-023-codebuddy-restricted-account-failover) | 通过 | 15 条全部通过；真实受限账号触发自动切换且提示可见；第二轮受限失败 0 次 |
| FNOS-022 | [CodeBuddy 模型调用被内容审核拦截修复](/tests/FNOS-022-codebuddy-content-block-fix) | [PLAN-FNOS-022](/plans/PLAN-FNOS-022-codebuddy-content-block-fix) | 通过 | 17 条全部通过；DSH Web 与 DSH Desktop 双客户端模型调用正常；本地桩注入验证只失败一次、不重试、不换号 |
| FNOS-025 | [CodeBuddy 插件下架](/tests/FNOS-025-codebuddy-plugin-delisting) | [PLAN-FNOS-025](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) | 通过 | 15 条全部通过；覆盖应用分发、文档站、仓库追踪与发布工具链四条链路 |
| FNOS-026 | [OpenCode Zen 与 OpenCode Go 模型接入及套餐用量](/tests/FNOS-026-dsh-opencode-plugin) | [PLAN-FNOS-026](/plans/PLAN-FNOS-026-dsh-opencode-plugin) | 实施中 | 47 条用例；2026-10-24 合并供应商口径实测已回填（5 条部分通过），完整用例待执行 |
| FNOS-027 | [ZCode Start Plan 模型接入与账号额度](/tests/FNOS-027-dsh-zcode-plugin) | [PLAN-FNOS-027](/plans/PLAN-FNOS-027-dsh-zcode-plugin) | 功能验收 | 37 条用例；2026-10-25 自研 HTTP 通道在 DSH Web 与 DSH Desktop 均实测通过（纯文本 4 秒、工具调用带审批、多轮工具结果、图文、智能体团队、思考等级、限流退避），15 条通过 / 7 条部分通过 / 15 条未执行；插件未发布，市场条目与发布相关项未执行 |
| FNOS-028 | [项目与插件版本统一及发布链路 dsh 基线标注](/tests/FNOS-028-unified-project-version-bumpp) | [PLAN-FNOS-028](/plans/PLAN-FNOS-028-unified-project-version-bumpp) | 验收通过 | 24 条用例（22 通过 / 2 未执行为发布后动作）；2026-10-25 提出人验收通过：版本统一 5.10.0、版本命令直接调用 bumpp（原生菜单+execute 同步钩子）、单条 release 提交实测；4 个实施缺陷已修复回归 |
| FNOS-029 | [DSH 0.2.1-rc.3 插件适配与基线迁移](/tests/FNOS-029-dsh-021-rc3-adaptation) | [PLAN-FNOS-029](/plans/PLAN-FNOS-029-dsh-021-rc3-adaptation) | 执行中 | 22 条用例；覆盖基线迁移、八插件副本、双客户端回归；TC-020/TC-016 已先行通过 |
| FNOS-030 | [飞牛 iOS App 打开 DSH 空白修复](/tests/FNOS-030-app-shell-blank-page) | [PLAN-FNOS-030](/plans/PLAN-FNOS-030-app-shell-blank-page) | 通过 | 15 条用例：包级 10 条全过；真实 NAS 4 通过 / 1 未执行（TC-014 未登录拒绝未单独取证）。2026-10-26 真机装成 v6.0.1，网关产物含 UpstreamSession 且旧 Token 注入为 0，首页 1 次请求即 200、无 token=、浏览器无 dsh-auth-*；**iOS App 实机由提出人验证正常访问** |
| FNOS-031 | [升级迁移 cwd 提示词变量引用](/tests/FNOS-031-cwd-prompt-variable-migration) | [PLAN-FNOS-031](/plans/PLAN-FNOS-031-cwd-prompt-variable-migration) | 部分通过 | 13 条用例：包级 10 条全过（网关 147 条测试全绿）；真机 TC-012 通过（6.0.3／6.0.4 两次安装均记录迁移步骤）、TC-013 部分通过（内容 md5 一致、无备份；mtime 由既有插件重装步骤改写）、TC-006 未执行（SSH 禁令，改由包级覆盖）。同时修复安装自动化 BUG-03/04 |
| FNOS-032 | [OpenCode 辅助调用补齐会话头](/tests/FNOS-032-opencode-aux-session-header) | [PLAN-FNOS-032](/plans/PLAN-FNOS-032-opencode-aux-session-header) | 执行中 | 6 条用例：包级 5 条全过（兜底、会话优先、空串、显式头、真实请求路径）；Auto 权限预设真实会话 1 条待执行 |
| FNOS-033 | [用量胶囊按当前选择即时显隐](/tests/FNOS-033-usage-capsule-selection) | [PLAN-FNOS-033](/plans/PLAN-FNOS-033-usage-capsule-selection) | 通过 | 6 条包级全部通过（opencode 208 条、zcode 169 条）；DSH Web 与 DSH Desktop 各两个切换方向均即时显隐（未发送消息）；BUG-01 已修复，BUG-02（线上 6.0.6 旧构建）按决定改本地打包交付 |
| FNOS-034 | [fnOS 授权目录选择器改为输入卡片宽浮层](/tests/FNOS-034-fnos-input-dock-picker) | [PLAN-FNOS-034](/plans/PLAN-FNOS-034-fnos-input-dock-picker) | 通过 | 52 条用例：包级 36 条全过（369 条测试全绿，含层级、去搜索、新建条目校验、气泡省略判定、取消静默）；真机 2026-10-30 在真实 NAS 验收通过（6.1.15，提出人确认） |
| FNOS-035 | [fnOS iframe 内拦截浏览器快捷键](/tests/FNOS-035-browser-shortcut-interception) | [PLAN-FNOS-035](/plans/PLAN-FNOS-035-browser-shortcut-interception) | 通过 | 11 条用例：包级 11 条全过（369 条测试全绿；含识别边界、只转发不自实现、重入保护）；真机 2026-10-30 在真实 NAS 验收通过（6.1.15，提出人确认） |

新增测试用例文档先登记在本页，并在 `docs/.vitepress/config.mts` 的测试用例 sidebar 加入条目。
