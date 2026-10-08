---
title: 真实环境验收记录
description: fnOS Apps 的 NAS、FPK、安装升级和发布环境验收记录规范。
---

# 真实环境验收记录

本目录保存真实 fnOS NAS、FPK 安装升级和发布环境的验收证据。它不是测试用例目录，也不能用本地构建结果替代目标环境结论。

## 记录模板

复制以下字段创建 `<功能 ID>-<环境>-YYYY-MM-DD.md`：

```yaml
---
feature: FNOS-001-10
acceptance: FNOS-001-10-AC-01
environment: fnOS NAS
fnosVersion: <版本>
appVersion: <FPK 版本>
pluginVersion: <插件版本>
verifiedAt: YYYY-MM-DD
status: passed|failed|blocked
---
```

正文至少记录：

1. 设备架构、用户角色、安装/升级方式和前置配置；
2. 操作步骤、预期结果和实际结果；
3. 日志、截图、失败复现或外部链接；
4. 遗留问题、回滚方式和下一步；
5. 验收人和最终结论。

当前 FNOS-001 的真实 NAS 记录应按功能 ID 分开，完成后回写对应需求和计划状态。

## 证据只追加，不修改

本目录下的验收记录是历史证据，**写入后不再修改**：它们记录的是「当时在哪个环境、按哪个版本验了什么」，事后改写会让结论失去依据。

- 需要补充结论、复验或修正时，追加一份新的记录文件，并在正文中链接被取代的旧记录与差异。
- 旧记录中过时的版本号、功能 ID 或结论保持在原位不动。
- 状态徽章的回写发生在需求与计划文档中；对应需求已完成时，按 [SDD 规格驱动维护规范](/charter/sdd-workflow#已完成的需求和计划不再变更) 登记到当前开发中的需求，不回改已完成文档。

## 当前记录

- [FNOS-009 DSH Desktop 补充验证记录：暗色主题、设置页与宿主差异点（2026-10-07）](/validation/FNOS-009-desktop-cdp-theme-2026-10-07)
- [FNOS-009-13 node-pty 免编译安装真机验收记录（2026-10-08）](/validation/FNOS-009-node-pty-prebuilds-2026-10-08)
- [FNOS-009 插件重锚定 DSH Desktop 验证记录（2026-10-06）](/validation/FNOS-009-desktop-cdp-2026-10-06)
- [FNOS-009-09 授权目录持久化运行时验证记录（2026-09-30）](/validation/FNOS-009-09-persistence-runtime-2026-09-30)
- [FNOS-009 插件重锚定 DSH Desktop 运行时验证记录（2026-09-30）](/validation/FNOS-009-desktop-runtime-2026-09-30)
- [FNOS-009-12 插件安装放行本地端到端验证记录（2026-09-30）](/validation/FNOS-009-12-release-age-local-2026-09-30)
- [FNOS-009 插件重锚定本地 DSH Web 验证记录（2026-09-30）](/validation/FNOS-009-local-web-2026-09-30)
- [FNOS-007/008 v5.5.0 真实 NAS 安装复验记录（2026-09-30）](/validation/FNOS-007-008-nas-v550-2026-09-30)
- [FNOS-007 真实 NAS 验收记录（2026-09-30）](/validation/FNOS-007-nas-2026-09-30)
- [FNOS-007 Web/Desktop 验收记录（2026-09-30）](/validation/FNOS-007-web-desktop-2026-09-30)
- [FNOS-008-01 fnOS 授权目录真实 NAS 验收记录（2026-09-30）](/validation/FNOS-008-01-nas-2026-09-30)
- [FNOS-007-19 终端 Shell 与字符集环境真机复核记录（2026-09-30）](/validation/FNOS-007-19-nas-restart-2026-09-30)
- [FNOS-002 NAS 浏览器验收记录（2026-09-01）](/validation/FNOS-002-nas-2026-09-01)
- [FNOS-004-08 DSH 客户端验收记录（2026-09-13）](/validation/FNOS-004-08-dsh-client-2026-09-13)
- [FNOS-007 本地自动化验证记录（2026-09-27）](/validation/FNOS-007-local-automated-2026-09-27)
- [FNOS-007-33 三方插件 API 反代配置保存修复本地验证记录（2026-09-28）](/validation/FNOS-007-33-local-automated-2026-09-28)
- [FNOS-007-34 气泡浮层磨砂背景修复本地验证记录（2026-09-29）](/validation/FNOS-007-34-local-automated-2026-09-29)
- [FNOS-007-35 Codex 模型能力元数据补全本地验证记录（2026-09-29）](/validation/FNOS-007-35-local-automated-2026-09-29)
- [FNOS-007-36 Codex 模型能力单一来源与历史覆盖自愈本地验证记录（2026-09-29）](/validation/FNOS-007-36-local-automated-2026-09-29)
- [FNOS-008-01 fnOS 授权目录迁入插件详情页本地验证记录（2026-09-29）](/validation/FNOS-008-01-fnos-detail-section-local-2026-09-29)
- [FNOS-008-01 fnOS 授权目录上限与 proxy 说明微调本地验证记录（2026-09-29）](/validation/FNOS-008-01-fnos-path-list-tip-local-2026-09-29)
- [FNOS-008-02 CodeBuddy 详情页与设置浮层本地验证记录（2026-09-29）](/validation/FNOS-008-02-codebuddy-detail-ui-local-2026-09-29)
- [FNOS-008-02 CodeBuddy Token 统计移除折叠本地验证记录（2026-09-29）](/validation/FNOS-008-02-codebuddy-token-section-local-2026-09-29)
- [FNOS-008-06 CodeBuddy Desktop 适配本地验证记录（2026-09-28）](/validation/FNOS-008-06-codebuddy-desktop-local-2026-09-28)
- [FNOS-008-06 CodeBuddy Desktop 运行时复验记录（2026-09-29）](/validation/FNOS-008-06-codebuddy-desktop-runtime-2026-09-29)
- [FNOS-008-03 Codex Auth 配置迁入插件详情页本地验证记录（2026-09-28）](/validation/FNOS-008-03-codex-bundle-config-local-2026-09-28)
- [FNOS-008-07 Codex Auth Desktop 登录修复本地验证记录（2026-09-28）](/validation/FNOS-008-07-codex-desktop-local-2026-09-28)
- [FNOS-008-08 Desktop 安装后激活失败本地验证记录（2026-09-29）](/validation/FNOS-008-08-desktop-install-activation-local-2026-09-29)
