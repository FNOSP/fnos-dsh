---
feature: FNOS-009-01, FNOS-009-03, FNOS-009-04, FNOS-009-05
acceptance: FNOS-009-01-AC-01, FNOS-009-01-AC-02, FNOS-009-05-AC-01
environment: DSH Desktop 应用自带运行时（Electron `ELECTRON_RUN_AS_NODE` + app.asar 内 dsh 0.2.0-rc.2）+ 探针 profile
fnosVersion: 不适用
appVersion: 0.2.0-rc.2
pluginVersion: 0.2.0-rc.2.0
verifiedAt: 2026-09-30
status: passed
---

# FNOS-009 插件重锚定 DSH Desktop 运行时验证记录（2026-09-30）

本记录用 **DSH Desktop 应用自带的运行时**验证四个插件的重锚定结果。

## 为什么用探针 profile 而不是应用自己的 Desktop profile

DSH 明确禁止 CLI 接管 Desktop profile：

```
$ dsh plugin --profile desktop list
error: profile "desktop" is managed exclusively by the Electron application
```

同时本机沙箱不允许写入 `~/.dsh/profiles/desktop`（`EPERM`），
而应用自己的 `desktop` profile 里也不包含本仓库三个插件。
因此沿用 FNOS-008 已登记的探针方案：**用同一个应用自带的 dsh 运行时**，
在独立 `DSH_HOME` 下初始化一个 web profile 并装入本仓库插件。
运行时代码完全相同（`app.asar/dsh/node_modules/@deepseek-ai/dsh`），
所以「插件能否在该运行时上通过加载门禁」这个结论是有效的。

## 环境

| 项 | 值 |
| --- | --- |
| 运行时 | `ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" "<app.asar>/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"` |
| 运行时版本 | `--version` → `0.2.0-rc.2` |
| `DSH_HOME` | `/tmp/dsh-desktop-probe-home`（隔离，不触碰用户 `~/.dsh`） |
| 启动 | `--profile web --port 8124 --no-open` |
| 插件安装 | 用同一运行时的 `dsh plugin --profile web add <插件目录>` |
| 插件版本 | 三个插件均为 `0.2.0-rc.2.0` |

## 步骤与结果

### FNOS-009-01 插件在新运行时正常加载

1. 浏览器打开探针地址，进入「插件」页面。
2. **实际结果**：「已安装」区显示 3 个插件（`@tnnevol/dsh-codebuddy`、
   `@tnnevol/dsh-codex-auth`、`@tnnevol/dsh-semi-ui-showcase`），启用开关全部为开；
   全页文本内「异常」0 次、「不兼容」0 次；**控制台无任何错误级消息**。
   符合 `FNOS-009-01-AC-01`。
3. 进入 `@tnnevol/dsh-codebuddy` 详情页：版本徽章 `v0.2.0-rc.2.0`，
   「包含的组件」显示运行中，「账号管理」区正常渲染。符合 `FNOS-009-01-AC-02`。

### FNOS-009-05 Semi UI Showcase 加载与渲染

1. 打开 hash 路由 `#/plugins/semi-ui/button`。
2. **实际结果**：展示页正常渲染，六个组件分组（基础类 / 输入类 / 导航类 /
   数据展示类 / 布局与导航 / 反馈类）与「Button 按钮」页全部出现，无异常标记。
   符合 `FNOS-009-05-AC-01`。

## 遗留问题

- 本记录覆盖的是 **Desktop 运行时**上的加载与渲染；应用自己的 `desktop` profile
  需要在应用内安装插件后才能做桌面壳层面的走查（本机沙箱无法写入该 profile）。
- Codex Auth 的登录/用量、CodeBuddy 的真实账号数据需要在桌面壳内操作，
  本次只验证了加载、详情页与展示页渲染。
- 探针 `DSH_HOME` 位于 `/tmp`，属于一次性验证环境，未写入任何用户数据。

## 结论

三个插件在 **DSH Desktop 自带运行时 0.2.0-rc.2** 上通过加载门禁：插件管理页与详情页
均无「异常」，Semi UI Showcase 展示页正常渲染，控制台无错误。
`FNOS-009-01`（Desktop 运行时部分）与 `FNOS-009-05`（加载与渲染）**通过**。
