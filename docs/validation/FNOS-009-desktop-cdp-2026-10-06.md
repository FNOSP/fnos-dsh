---
feature: FNOS-009-01, FNOS-009-04, FNOS-009-05
acceptance: FNOS-009-01-AC-01, FNOS-009-01-AC-02, FNOS-009-04-AC-01, FNOS-009-05-AC-01
environment: DSH Desktop（Electron 壳，CDP 驱动渲染进程取证）
fnosVersion: 不适用
appVersion: 0.2.0-rc.2
pluginVersion: 0.2.0-rc.2.0
verifiedAt: 2026-10-06
status: passed
---

# FNOS-009 插件重锚定 DSH Desktop 验证记录（2026-10-06）

本记录补充 [FNOS-009 插件重锚定 DSH Desktop 运行时验证记录（2026-09-30）](/validation/FNOS-009-desktop-runtime-2026-09-30)。

**为什么要另立一份**：前一份记录用的是隔离 `DSH_HOME` 探针，按 [DSH Desktop 测试](/charter/tests-spec#dsh-desktop-测试) 的 profile 位置约束（强制）**不构成 Desktop 结论**——它没有使用项目根 `.dsh/profiles/desktop`。本记录改用规范要求的项目 profile，并在**真实 Desktop 壳**内取证，替代前一份的 Desktop 结论。前一份记录按「证据只追加」原则保持原样。

## 环境

| 项 | 值 | 来源 |
| --- | --- | --- |
| 客户端 | DSH Desktop `0.2.0-rc.2`（Electron 44.0.0） | `[采集]` CDP `/json/version` 的 UA：`@deepseek-ai/dsh-desktop/0.2.0-rc.2 … Electron/44.0.0` |
| 内置 DSH 运行时 | `0.2.0-rc.2` | `[采集]` 应用自带运行时 `--version` |
| 被测插件 | `@tnnevol/dsh-codebuddy`、`@tnnevol/dsh-codex-auth`、`@tnnevol/dsh-semi-ui-showcase`，均 `0.2.0-rc.2.0` | `[采集]` 插件详情页版本徽章 |
| `DSH_HOME` | `<repo>/.dsh`（项目根，符合规范） | `[采集]` Desktop 进程环境变量 |
| profile | `.dsh/profiles/desktop` | `[采集]` `bundles` 含上述三个插件 |

**版本匹配前置检查**：Desktop 内置运行时 `0.2.0-rc.2` 与三个插件锚定的兼容范围一致，满足[客户端与基线版本记录](/charter/tests-spec#客户端与基线版本记录)的前置要求。

## 执行方式

Desktop 无法由本仓库 CLI 拉起，且 `desktop` 是 Electron 应用保留的 profile 名——`dsh` 一律拒绝对它操作：

```
$ dsh plugin --profile desktop list
error: profile "desktop" is managed exclusively by the Electron application
```

`desktop` 同时**不是**随发行版的 profile 模板（`dsh-app-boot` 的 `PROFILE_TEMPLATES` 只有 `acp`、`web`、`headless`、`sdk`、`sdk-minimal`），因此也无法用 `--from-default-profile desktop` 创建。实际采用的方式是让 Desktop 应用自己初始化项目 profile，再用 CDP 在其渲染进程内取值：

```bash
# 1. 以项目 DSH_HOME 启动，由应用创建 .dsh/profiles/desktop
DSH_HOME="$PWD/.dsh" open -a "DeepSeek Harness" --args --remote-debugging-port=9333

# 2. 确认连到的是 Desktop 壳（UA 含 @deepseek-ai/dsh-desktop/0.2.0-rc.2）
curl -sS http://127.0.0.1:9333/json/version

# 3. 页面为 dsh-app://app/ 自定义协议，浏览器无法直接打开，只能经 CDP 求值
curl -sS http://127.0.0.1:9333/json/list
```

## 逐项结果

### FNOS-009-01 插件在新运行时正常加载

- `[采集]` 插件页「已安装」分组显示 3 个插件：`@tnnevol/dsh-codebuddy`、`@tnnevol/dsh-codex-auth`、`@tnnevol/dsh-semi-ui-showcase`。
- `[采集]` 全页「异常」出现 **0** 次、「不兼容」出现 **0** 次。
- `[采集]` CodeBuddy 详情页：版本徽章 `v0.2.0-rc.2.0`，「包含的组件」显示「共 1 个 · 1 运行中」。
- 符合 `FNOS-009-01-AC-01` / `AC-02`。

### FNOS-009-04 CodeBuddy 功能保持

- `[采集]` 详情页「账号管理」区块正常渲染，账号 6 个（截图可见 4 个卡片），额度显示 1468 / 1609，均带「已签到」「今日已旅行」标记。
- `[采集]` 操作按钮（添加账号、完成任务、刷新、查看日志）与设置入口均在位。
- 符合 `FNOS-009-04-AC-01`（账号管理与额度显示部分）。

### FNOS-009-05 Semi UI Showcase 功能保持

- `[采集]` 插件加载并通过兼容门禁（见 FNOS-009-01），未出现加载期异常。
- 展示页逐组件渲染结论见 [本地 Web 验证记录](/validation/FNOS-009-local-web-2026-09-30)；Desktop 侧本次覆盖到加载与详情页层面。
- 符合 `FNOS-009-05-AC-01`（Desktop 部分）。

### 工作区

- `[采集]` 侧边栏工作区列表可见 `harness debugger`、`测试猜想`、`技能安装`、`fnos-dsh`，与项目 `.dsh` 的 workspace 注册一致。

## 截图

`/tmp/desktop-cdp.png` 为 CDP `Page.captureScreenshot` 取得的 Desktop 渲染结果，画面为 CodeBuddy 详情页（**亮色主题**），可见版本徽章 `v0.2.0-rc.2.0`、「1 运行中」与账号管理列表。该文件位于临时目录，不作为仓库产物留存。

## 遗留问题

- **暗色主题未覆盖**：本次只采集到亮色主题；按 [UI 测试](/charter/tests-spec#ui-测试视觉与样式) 要求，UI 用例应在亮暗两个主题下各执行一遍，暗色部分待补。
- **宿主差异点未覆盖**：规范要求的「外部链接经系统默认浏览器打开（`setWindowOpenHandler` 语义）、OAuth 授权回流、设置页呈现」本次未逐一走查。
- **Codex Auth 登录与用量**未在 Desktop 内复验。
- **桌面壳内人工操作未做**：本次经 CDP 求值取证，未在 Desktop 界面内实际点击登录、添加账号等真实交互。
- 真实 fnOS NAS 部分仍未验收（见相关需求状态）。

## 收尾

- Desktop 以项目 `DSH_HOME` 启动用于测试，测试完成后以缺省 `DSH_HOME` 重启一次，交还 `~/.dsh` 全局 profile（规则见 [DSH Desktop 测试](/charter/tests-spec#dsh-desktop-测试)）。
- `[采集]` 收尾执行结果：退出带项目 `DSH_HOME` 的 Desktop 后，以缺省环境重新启动；确认 `DSH_HOME` 未设置（回落 `~/.dsh`），全局 profile `~/.dsh/profiles/desktop` 恢复写入，其 `bundles` 为 `dshmarket` 与实验特性组合、不含本次三个被测插件。
- `[采集]` 项目 profile `<repo>/.dsh/profiles/desktop` 保留，供后续测试复用；本地 Web 实例未受影响。
- 本次未在 Desktop 内产生新的测试账号或凭据，无需清理登录态。

## 结论

三个插件在 **DSH Desktop `0.2.0-rc.2` 真实 Electron 壳**上、以规范要求的项目 `.dsh/profiles/desktop` 为 profile，通过加载门禁：插件页与详情页均无「异常」，CodeBuddy 账号管理区块正常渲染，工作区列表与项目注册一致。
`FNOS-009-01`（Desktop）、`FNOS-009-04`（账号管理与额度）、`FNOS-009-05`（Desktop 加载与详情页）**通过**；暗色主题与宿主差异点待补。

验收人：AI 代理（CDP 取证）
