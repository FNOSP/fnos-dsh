---
feature: FNOS-014-01
acceptance: FNOS-014-01-AC-01、FNOS-014-01-AC-02、FNOS-014-01-AC-03
environment: DSH Web 与 DSH Desktop
dshVersion: 0.2.1-rc.2
pluginVersion: 0.2.1-rc.2.0（源码链接形态）
appVersion: 5.7.7（未升版）
verifiedAt: 2026-10-18
status: passed
---

# FNOS-014 双客户端加载与插件功能验收（2026-10-18）

本记录是 FNOS-014 的 DSH Web 与 DSH Desktop 双客户端验收证据，覆盖 FNOS-014-01 至 FNOS-014-08 与 FNOS-014-10、FNOS-014-12 的本地可验部分。真实 fnOS NAS 相关项（FNOS-014-11 真机安装、FNOS-014-14）不在本记录范围内。

## 环境与前置

| 项 | 值 |
| --- | --- |
| 运行时 | `@deepseek-ai/dsh` `0.2.1-rc.2`（仓库 catalog 解析结果，`pnpm exec dsh --version` 输出 `0.2.1-rc.2`） |
| 模型底座 | `@earendil-works/pi-ai` `1.1.0` |
| 宿主框架 | `@deepseek-ai/cordis` `4.0.5`、`@deepseek-ai/schemastery` `3.18.5` |
| DSH Web | 仓库根 `.dsh` 作为 `DSH_HOME`，`dsh web --no-open --port 8070` |
| DSH Desktop | 上游源码检出 `fork-pj/deepseek-harness` 的开发态 Desktop（构建版本串 `0.2.1-rc.2-687f282`），`DSH_HOME` 指向项目 `.dsh`，渲染进程调试端口 `9333` |
| 被测插件 | `@tnnevol/dsh-codebuddy`、`@tnnevol/dsh-codex-auth`、`@tnnevol/dsh-failover-search`、`@tnnevol/dsh-midscene`、`@tnnevol/dsh-semi-ui-showcase`（均以 `link:` 源码形态装入 profile） |
| 装入口径 | 五个非 fnOS 插件链接进项目 `.dsh` 的 `web` 与 `desktop` 两个 profile |

## 一、插件加载与门禁（FNOS-014-01）

**操作**：在 DSH Web 打开插件页，逐个打开已安装插件详情；在 DSH Desktop 重复同一操作。

**预期**：插件管理页无「异常」与不兼容原因，组合包显示已启用；运行日志无模块未找到、插座未声明、行挂起。

**实际**：

- DSH Web「已安装插件」区块列出全部五个插件，逐个打开详情均进入详情页并渲染出「包含的组件」「来源信息」，无「异常」标记。
- DSH Desktop 同样列出五个插件，详情页均正常；页面顶部渲染版本串 `0.2.1-rc.2-687f282`。
- DSH Web 日志只有一行模型目录加载信息（`[llm-deepseek-account] model listing … loaded 2 model(s)`），无错误、无 pending。
- DSH Desktop 日志除 Electron 的 native 平台告警（上游构建产物，与被测插件无关）外，只有一条 Codex Auth 的模型自动同步正常信息。
- 浏览器控制台（DSH Web）`error` 与 `warn` 级别消息为空；页面 DOM 中按错误样式采样的元素数为 0。

**结论**：通过。FNOS-014-01-AC-01、AC-02、AC-03 成立。

## 二、CodeBuddy 宿主依赖适配（FNOS-014-02）

**背景**：本版 DSH 移除了浏览器信任配置的旧服务，仍注入它的插件行会永久等待。CodeBuddy 的组合声明原本注入该旧服务。

**操作**：打开 CodeBuddy 详情页，观察行状态与配置区块。

**实际**：DSH Web 与 DSH Desktop 上 CodeBuddy 均显示「运行中」，详情页完整渲染「账号管理」与「Token 统计」两个区块：6 个账号、可用账号 6/6、剩余额度 3765、积分包 360；Token 总览、活动热力图、趋势图与会话排名均渲染。DSH Desktop 上同样渲染出账号管理与 Token 统计区块。

**结论**：通过。FNOS-014-02-AC-01、AC-02 成立；插件行未出现挂起。

## 三、Codex Auth 在新模型底座上（FNOS-014-03）

**操作**：打开 Codex Auth 详情页，读登录状态、全局模型区块；通过 Midscene 桥接的模型目录间接核对底座模型可用性。

**实际**：

- DSH Web：状态显示「已登录」，「全局模型」区块渲染出模型级联选择器与「设置为全局模型」按钮。
- DSH Desktop：详情页渲染出「Codex Auth」与「全局模型」区块。
- Midscene 桥接健康检查返回 `providers` 含 `openai-codex`，模型目录中列出 `openai-codex/gpt-6-luna`、`openai-codex/gpt-5.6-terra`、`openai-codex/gpt-5.6-luna` 等条目，说明新底座上的 Codex 路由与模型目录可用。

**结论**：通过（登录态）。FNOS-014-03-AC-01、AC-02 在登录态下成立。未登录态（AC-03）与用量显示（AC-04）本轮未单独走查，登记为待补。

## 四、CodeBuddy 功能保持（FNOS-014-04）

**操作**：同第二节，另核对模型选择器中的 CodeBuddy 分组与额度条。

**实际**：账号列表、自动切换入口、额度与 Token 统计均可用；对话区输入条显示「CodeBuddy个人体验版 · 剩余: 20% · 重置 …」额度按钮；模型选择器显示 CodeBuddy 分组模型 `GLM-5.3-Flash · x0.06`，模型名称带倍速标识。

**结论**：通过。FNOS-014-04-AC-02 与 FNOS-014-04 的模型名称部分成立；新发起的浏览器授权登录（AC-01）未在本轮重做，沿用升级前已登录的 6 个账号验证账号管理路径。

## 五、Failover Search 功能保持（FNOS-014-05）

**操作**：打开 Failover Search 详情页；检查会话输入区的「智能搜索」开关。

**实际**：详情页完整渲染「平台账号」（TinyFish、Tavily 两个平台各含 key 输入与备注名）、「转移与均摊」（来源顺序显示 `TinyFish → Tavily → 官方搜索`、每来源超时 20000、同平台重试开关）、「用量展示与探测」（刷新间隔 5 分钟、请求前探测开关）与「平台用量」区块。会话输入区显示「智能搜索：已开启」开关。

本轮的配置区在升级后一度类型不可解析（详见变更记录中的 BUG-01），修复后该区块在 DSH Web 与 DSH Desktop 均正常渲染。

**结论**：通过（配置与界面层）。实际发起一次三方搜索并观察故障转移（AC-01）、抓取兜底（AC-02）本轮未执行真实网络调用，登记为待补。

## 六、Midscene 桥接（FNOS-014-06）

**操作**：读插件详情页；请求桥接健康端点与模型目录。

**实际**：详情页渲染出「接入密钥」「指定测试模型」「接入配置」三块。桥接健康端点返回 `status: ok`，`providers` 为 `deepseek-official`、`deepseek-account`、`openai-codex`、`opencode-go`、`codebuddy`（5 个），`models` 为 23，`attachments: true`，端口 8788。

**结论**：通过。FNOS-014-06-AC-01 成立，AC-02 的「目录随宿主提供方变化」由目录含 5 个提供方间接佐证，未做新增提供方的增量实验，登记为待补。

## 七、Semi UI Showcase 与主题契约（FNOS-014-07）

**操作**：DSH Web 打开 Semi UI 组件总览，切到暗色主题后截图；DSH Desktop 打开同一页面。

**实际**：

- DSH Web：总览页渲染出组件导航（基础类、输入类、导航类、数据展示类、布局与导航、反馈类、案例演示）与 Button 页的各展示区（按钮类型、主题与尺寸、状态、组合与浮层）及代码示例。
- 暗色主题：标题、正文、按钮与代码块对比清晰，浮层与边框可见，无穿透背景。
- DSH Desktop：同页渲染出 Button 页、代码示例与全部区块标记。

**结论**：通过。FNOS-014-07-AC-01、AC-02 成立。

## 八、插件界面契约（FNOS-014-08）

**操作**：逐个打开插件详情页，核对各插件区块只出现在自己的条目下；核对会话头部、输入区、侧栏元素。

**实际**：四个含客户端区块的插件在各自详情页只渲染自己的区块，未出现串页或重复；会话头部显示「打开 Semi UI 组件总览」按钮；输入区显示「智能搜索」开关、「CodeBuddy 额度」按钮与模型选择器；侧栏显示「插件」「自动化任务」两个全局面板入口。DSH Desktop 与 DSH Web 结论一致。

**结论**：通过。FNOS-014-08-AC-01、AC-02 成立。

## 九、基线同源（FNOS-014-10、FNOS-014-12）

**操作**：核对 catalog、插件同行依赖、兼容声明、构建校验常量与安装回调五处版本。

**实际**：

- `pnpm exec dsh --version` 输出 `0.2.1-rc.2`，与 catalog 的 `@deepseek-ai/dsh` 一致。
- 六个插件的 `compatibility.json` 的 `dshPluginApi.version` 全为 `0.2.1-rc.2`；Codex Auth 的 `piAi.version` 为 `1.1.0`。
- 构建校验常量、本地 profile 版本常量与安装回调的 `DSH_VERSION` 三处均为 `0.2.1-rc.2`。
- 仓库守卫测试（`pnpm run test`）全部 23 个任务通过，其中基线、兼容清单、catalog 声明、安装命令一致性与三方插件版本断言均通过。

**结论**：通过。FNOS-014-12-AC-01、AC-02 成立；FNOS-014-10 的声明侧成立，文档侧见测试用例文档。

## 遗留与下一步

- Codex Auth 未登录态（FNOS-014-03-AC-03）与对话区用量（AC-04）待补走查。
- Failover Search 的真实三方搜索故障转移与抓取兜底（FNOS-014-05-AC-01、AC-02）待真实网络条件下执行。
- Midscene 的「新增提供方后目录随之更新」（FNOS-014-06-AC-02）待补增量实验。
- FNOS-014-11（真机安装最后一步）与 FNOS-014-14（fnOS 插件真机功能）需在真实 fnOS NAS 上执行，不在本记录范围。

## 收尾

- 测试实例清理：停止 DSH Web（8070）、开发态 Desktop（渲染进程调试端口 9333）与桥接监听（8788）。用户日常实例（3080）未受影响，保持运行。
- Desktop 使用项目 `.dsh` 启动，未触碰 `~/.dsh/profiles/desktop`；本轮未启动系统安装的 Desktop 发行版壳，因此不需要把 Desktop 交还给全局 profile。
- 未新增或删除任何用户账号与凭据；验收过程中未改动授权目录与模型配置。

## 验收人

执行：DeepSeek Harness 会话代理（本仓库维护会话）。结论：通过（本地双客户端部分），NAS 部分待执行。
