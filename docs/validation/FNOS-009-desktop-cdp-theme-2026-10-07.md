---
feature: FNOS-009-01, FNOS-009-04, FNOS-009-05
acceptance: FNOS-009-01-AC-01, FNOS-009-04-AC-01, FNOS-009-05-AC-01
environment: DSH Desktop（Electron 壳，CDP 驱动渲染进程取证）
fnosVersion: 不适用
appVersion: 0.2.0-rc.2
pluginVersion: 0.2.0-rc.2.0
verifiedAt: 2026-10-07
status: passed
---

# FNOS-009 DSH Desktop 补充验证记录：暗色主题、设置页与宿主差异点（2026-10-07）

本记录补充 [FNOS-009 插件重锚定 DSH Desktop 验证记录（2026-10-06）](/validation/FNOS-009-desktop-cdp-2026-10-06)，按其遗留问题清单逐项补齐 [UI 测试](/charter/tests-spec#ui-测试视觉与样式) 与 [DSH Desktop 测试](/charter/tests-spec#dsh-desktop-测试) 要求的覆盖。

## 环境

| 项 | 值 | 来源 |
| --- | --- | --- |
| 客户端 | DSH Desktop `0.2.0-rc.2`（Electron 44.0.0） | `[采集]` CDP `/json/version` UA |
| 内置 DSH 运行时 | `0.2.0-rc.2` | `[采集]` 应用自带运行时 `--version` |
| 被测插件 | `@tnnevol/dsh-codebuddy`、`@tnnevol/dsh-codex-auth`、`@tnnevol/dsh-semi-ui-showcase`，均 `0.2.0-rc.2.0` | `[采集]` 插件详情页版本徽章 |
| `DSH_HOME` | `<repo>/.dsh`（项目根，符合规范） | `[采集]` Desktop 进程环境变量 |
| profile | `.dsh/profiles/desktop` | `[采集]` `bundles` 含上述三个插件 |

## 执行方式

```bash
DSH_HOME="$PWD/.dsh" open -a "DeepSeek Harness" --args --remote-debugging-port=9333
curl -sS http://127.0.0.1:9333/json/version   # UA 含 @deepseek-ai/dsh-desktop/0.2.0-rc.2
```

界面为 `dsh-app://app/` 自定义协议，只能经 CDP 驱动。**操作注意（本轮踩坑记录）**：

- 侧边栏一级列表**没有**「设置」入口；设置位于**左下角用户头像菜单**内（项为「设置 ⌘,」）。
- Semi UI 的 portal 菜单、分栏与单选项对合成 `el.click()` 不响应，必须用 CDP 真实鼠标事件（`Input.dispatchMouseEvent` 的 mousePressed/mouseReleased）。用合成点击会得出「找不到设置」的错误结论。
- 外观选项是 `button[class*="themeCube"]`（内部含子节点），不能按「叶子文本节点」定位。

## 逐项结果

### UI 测试要求 1：亮色与暗色主题各执行一遍

`[采集]` 在「设置 → 通用设置 → 外观」中切换，取值为「浅色 / 深色 / 跟随系统」。切换前后的实测取色：

| 指标 | 浅色 | 深色 |
| --- | --- | --- |
| `color-scheme` | `light` | `dark` |
| 设置浮层背景 | `rgb(255, 255, 255)` | `rgb(44, 44, 46)` |
| 正文颜色 | `rgb(15, 17, 21)` | `rgb(249, 250, 251)` |
| 选中项 | 浅色 | 深色 |

`[采集]` **暗色下的功能核对**：插件页「异常」**0** 次，三个被测插件均在；CodeBuddy 详情页正常渲染（账号管理区可见 6 个账号、剩余额度、已签到标记）。暗色下插件自身 UI 取色：插件名 `rgb(249,250,251)` / 背景 `rgb(21,21,23)`，对比度 **17.45**。

`[采集]` 按真实像素取样（`Page.captureScreenshot` + canvas 解码）核对可读性：

| 采样区域 | 合成背景 | 文字色 | 对比度 | 判定 |
| --- | --- | --- | --- | --- |
| 侧边栏·工作区名 | `rgb(28,28,32)` | `rgb(249,250,251)` | 16.25 | 通过 AA |
| 主区·页面标题 | `rgb(21,21,23)` | `rgb(249,250,251)` | 17.45 | 通过 AA |
| 主区·分组标题 | `rgb(21,21,23)` | `rgb(249,250,251)` | 17.45 | 通过 AA |
| 主区·插件名 | `rgb(21,21,23)` | `rgb(249,250,251)` | 17.45 | 通过 AA |
| 主区·插件描述 | `rgb(21,21,23)` | `rgb(249,250,251)` | 17.45 | 通过 AA |

无需切换：所有采样项在两个主题下均满足 WCAG AA（≥4.5）。

`[采集]` 主题切换后所有自定义样式跟随，未发现残留亮色值或残留暗色值的元素。

**一处需要说明的观察（非缺陷）**：CDP `Page.captureScreenshot` 截图中侧边栏看起来比主内容区亮。经核实这是**截图工具的产物**：侧边栏容器使用半透明背景 `color(srgb 0.105 0.105 0.109 / 0.5)`，CDP 截图不会合成窗口自身的半透明底，因此截图上表现为偏亮；用 macOS 屏幕截图取得的实际窗口画面中，侧边栏与主内容区均为正确的深色。结论以实际窗口画面为准。

### UI 测试要求 2：间距叠加与 BFC

- `[采集]` 「账号管理」区块内的账号卡片按网格排列，相邻卡片间距一致，未见意外空隙或双倍间距。
- `[采集]` 设置浮层为 portal 到 body 的浮层，未被父容器裁剪，定位上下文正常。
- 未发现 margin 折叠或穿透导致的视觉缺陷。

### UI 测试要求 3：毛玻璃（backdrop-filter）

- `[采集]` 遍历页面全部元素，`backdrop-filter` 非 `none` 的元素数为 **0**。
- `[采集]` 侧边栏背景为半透明（alpha 0.5）且无 `backdrop-filter`。按 [插件 UI 规范](/charter/plugin-ui-standards) 的「一个视觉块只允许一条模糊链路」「只有透明背景、无任何模糊」判定口径，这属于**宿主自身 chrome**（`_6Qf49G_sidebarCol`、`_3WPZCG_newSession` 等类名），不属于本仓库插件；且实际窗口画面中未观察到看穿穿帮（其下层是窗口自身的深色底）。
- **被测插件未引入任何 `backdrop-filter`**，因此不涉及子元素重复叠加问题。

### DSH Desktop 测试要求：宿主差异点

| 差异点 | 实测结果 | 判定 |
| --- | --- | --- |
| 外部链接经系统默认浏览器打开（`setWindowOpenHandler` 语义） | `[验收]` 在 Desktop 内触发 `window.open('https://deepseek.com/')` 后，无新 CDP target 产生（应用内未新建窗口），且系统前台应用由 `DeepSeek Harness` 切换为 `Google Chrome` | **通过** |
| 设置页呈现 | `[采集]` 设置浮层正常打开，含分组「账号与余额 / 通用设置 / 模型 / 内置插件 / Agent 预设」，通用设置含权限、语言、外观、字号大小、工作步骤展示、显示代码工作视图、快捷键、网页链接默认打开方式、繁忙时的发送行为、性能与用量等项 | **通过** |
| OAuth 授权回流 | 未走查（需真实完成一次登录授权），见遗留问题 | 未覆盖 |

`[采集]` 「网页链接默认打开方式」当前取值为「应用内侧边栏」。以裸 `window.open()` 触发时仍交系统浏览器打开；因该项设置的作用域是「**对话中**网页链接的打开位置」，而本次未在真实对话内点击链接，**不据此判定缺陷**，列为遗留问题。

### 工作区与主题的关系

- `[采集]` 暗色与浅色下工作区列表（`harness debugger`、`测试猜想`、`技能安装`、`fnos-dsh`）均正常显示。

## 遗留问题

- **OAuth 授权回流未走查**：Desktop 与 Web 的宿主差异点之一，需真实完成一次登录授权流程；本轮未执行。
- **「网页链接默认打开方式」的两种取值未分别验证**：需在真实对话内点击链接才能覆盖「应用内侧边栏」路径。
- **Codex Auth 登录与用量**未在 Desktop 内复验。
- **真实 fnOS NAS 部分**仍未验收。

## 收尾

- `[采集]` 外观已恢复为**浅色**（与测试前一致），无残留浮层。
- `[采集]` 按 [DSH Desktop 测试](/charter/tests-spec#dsh-desktop-测试) 的强制收尾要求，退出带项目 `DSH_HOME` 的 Desktop 后以缺省 `DSH_HOME` 重启：全局 profile `~/.dsh/profiles/desktop` 恢复写入（收尾时刻 `10:42:41`），其 `bundles` 为 `dshmarket` 与实验特性组合、**不含**本次三个被测插件；项目 profile `<repo>/.dsh/profiles/desktop` 停止写入（停在 `10:25:00`）并保留供后续测试复用。
- 本次未在 Desktop 内产生新的测试账号或凭据，无需清理登录态。

## 结论

三个插件在 **DSH Desktop `0.2.0-rc.2` 真实 Electron 壳**、项目 `.dsh/profiles/desktop` profile 下，**亮色与暗色两个主题**均正常渲染：插件页与详情页无「异常」，可读性满足 WCAG AA，主题切换无残留样式，被测插件未引入多余的 `backdrop-filter`。
宿主差异点中「外部链接交系统浏览器打开」与「设置页呈现」**通过**；OAuth 授权回流与「网页链接默认打开方式」的对话内路径待补。

验收人：AI 代理（CDP 取证）
