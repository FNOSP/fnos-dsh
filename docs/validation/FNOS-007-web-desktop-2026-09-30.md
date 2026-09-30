---
feature: FNOS-007
acceptance: FNOS-007-02, FNOS-007-04, FNOS-007-05, FNOS-007-06, FNOS-007-09, FNOS-007-12
environment: DSH Web 与 DSH Desktop（应用内使用）
fnosVersion: 不适用
appVersion: 5.4.3
pluginVersion: 5.4.3
verifiedAt: 2026-09-30
status: passed
---

# FNOS-007 Web/Desktop 验收记录（2026-09-30）

本记录覆盖需求 [`验收环境范围`](/requirements/FNOS-007-dsh-017-rc2-adaptation#验收环境范围)
中约定在 **DSH Web 与 DSH Desktop** 验收、**不要求真实 NAS** 的六项功能。

真实 NAS 部分见 [`FNOS-007-nas-2026-09-30`](/validation/FNOS-007-nas-2026-09-30)。

## 验收方式

用户（设备管理员）在实际使用的 DSH Web 与 DSH Desktop 客户端上完成功能验收并确认结果。
本记录登记该结论，并列出自本地自动化证据；不重复断言未经复核的细节。

## 逐项结论

### FNOS-007-02 插件兼容性门禁升级

- 应用以目标 `0.1.7-rc.2` 兼容基线运行，四个 DSH 插件（`dsh-fnos`、`dsh-codebuddy`、
  `dsh-codex-auth`、`dsh-semi-ui-showcase`）在 DSH Web 与 Desktop 下可加载、可注册座位。
- 结论：**通过**。

### FNOS-007-04 CodeBuddy 工具和图片能力兼容

- CodeBuddy 工具调用与图片输入在目标基线下工作；插件测试套件（896 条）覆盖工具与图片路径。
- 结论：**通过**。

### FNOS-007-05 Codex Auth 能力兼容

- Codex Auth 在目标基线下完成登录、模型列表、用量展示与全局模型选择；`gpt-6` 系列模型的
  思考等级与图文输入按真实能力呈现（见
  [`FNOS-007-35`](/validation/FNOS-007-35-local-automated-2026-09-29)、
  [`FNOS-007-36`](/validation/FNOS-007-36-local-automated-2026-09-29)）。
- 本记录撰写当日另修复未订阅账号的用量与模型列表问题（`plan_type: free` 的 30 天窗口不被
  任何选择器认领、客户端接口漏声明 `planType`、模型目录自动同步从未接线），详见需求变更记录。
- 结论：**通过**。

### FNOS-007-06 Semi UI 和总览插件兼容

- Semi UI 共享包主题与组件在目标基线下正常渲染；Semi UI Showcase 插件可用。
- 结论：**通过**。

### FNOS-007-09 设置页和图标资源兼容

- 设置页各分区与图标资源在 DSH Web 与 Desktop 下正常呈现。
- 结论：**通过**。

### FNOS-007-12 dshmarket 精确版本升级

- `dshmarket` 按清单版本收敛：缺失时安装、版本不一致时升级或降级、同版本保持。
- 结论：**通过**。

## 遗留问题

无阻塞项。
