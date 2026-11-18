---
id: FNOS-054
title: FNOS-054 测试用例
description: FNOS-054 侧栏底部飞牛 OS 入口、下拉菜单与独立浏览器页面能力对齐的测试用例、执行结果与遗留项。
requirement: /requirements/FNOS-054-fnos-footer-entry-standalone
status: 部分通过
lastVerified: 2026-11-12
verifiedAt: 2026-11-12
---

# FNOS-054 测试用例
关联需求：[FNOS-054](/requirements/FNOS-054-fnos-footer-entry-standalone)｜关联计划：[PLAN-FNOS-054 侧栏底部飞牛 OS 入口](/plans/PLAN-FNOS-054-fnos-footer-entry-standalone)


## 测试范围与需求分析

被测对象是两件互相牵连的事：入口换位置（视觉与交互）与运行环境判据换口径（能力可用性）。执行任务见 [FNOS-054](/requirements/FNOS-054-fnos-footer-entry-standalone)。

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-054-01](/requirements/FNOS-054-fnos-footer-entry-standalone#功能拆解) | 入口座位与几何 | 与设置行不等高，视觉上像两套控件 |
| [FNOS-054-02](/requirements/FNOS-054-fnos-footer-entry-standalone#功能拆解) | 下拉菜单三项与键盘 | 菜单被裁切、或方向键走不通 |
| [FNOS-054-03](/requirements/FNOS-054-fnos-footer-entry-standalone#功能拆解) | 旧入口清理 | 同一动作出现在两处，改一处漏一处 |
| [FNOS-054-04](/requirements/FNOS-054-fnos-footer-entry-standalone#环境判据为什么改用-base) | 三态识别 | 判据混淆导致独立浏览器被当成本地开发（本次故障根因） |
| [FNOS-054-05](/requirements/FNOS-054-fnos-footer-entry-standalone#功能拆解) | 独立页面回显与能力分级 | 报「可用」却点不动，比不显示更糟 |
| [FNOS-054-06](/requirements/FNOS-054-fnos-footer-entry-standalone#授权回调页由网关提供) | 授权回调链路 | 回调页不存在或跨源，授权在最后一步断掉 |

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-054-01 ~ 03 | 包级（Node / vitest） | 源码契约断言 + `tsdown` 产物检查 |
| FNOS-054-04 | 包级单测 | `tests/client/environment.spec.ts` 六种输入 |
| FNOS-054-05 ~ 06 | 包级单测 | `tests/client/app-auth-callback.spec.ts`、`packages/fnos-gateway/tests/app-auth-callback.spec.ts` |
| FNOS-054-01 ~ 02 | 本地 DSH Web | 槽位探针插件实测（已完成，见执行结果） |
| FNOS-054-01 ~ 06 | 真实 fnOS NAS | 装 FPK 后目视与操作（**未执行**） |

## 测试用例

### FNOS-054-01 入口座位与几何

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-054-01 | 注册到 `sidebar.footer.action` | AC-01 | 源码 | 1.断言 `inject('sidebar.footer.action'` 2.断言 `id: 'dsh-fnos-footer-entry'` | 都在 | P0 | 需求 AC-01 |
| TC-002 | FNOS-054-01 | 展开态几何对齐设置行 | AC-01 | 源码 | 1.检查 `.dsh-fnos-footer-trigger` 的 `height` 与圆角 | 42px、`--dsw-radius-md` | P0 | 官方 `SettingsRoot.module.css` |
| TC-003 | FNOS-054-01 | 折叠态为 36×36 | AC-01 | 源码 | 1.检查 `--rail` 修饰类 | `width/height: 36px` | P0 | 官方 `.trigger.rail` |
| TC-004 | FNOS-054-01 | 折叠态有可访问名 | AC-01 | 源码 | 1.检查 `aria-label` | 存在（图标按钮无可见文字） | P1 | 读屏可用性 |

### FNOS-054-02 下拉菜单

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-005 | FNOS-054-02 | 复用官方 Menu 原语 | AC-02 | 源码 | 1.断言 `Menu` + `MenuItemButton` 2.断言 `side="top"` | 都在 | P0 | 与「更多」菜单同一套实现 |
| TC-006 | FNOS-054-02 | 三个菜单项 | AC-02 | 源码 | 1.断言设置/刷新/重启三条 | 都存在 | P0 | 需求 AC-02 |
| TC-007 | FNOS-054-02 | 菜单宽度对齐「更多」 | AC-02 | 源码 | 1.检查 `.dsh-fnos-footer-menu` | 288px | P1 | 官方 `.moreMenu` |
| TC-008 | FNOS-054-02 | 先关菜单再开弹框 | AC-02 | 源码 | 1.检查 `openConfig` 内顺序 | `dismiss()` 在 `set(true)` 之前 | P1 | 浮层抢焦点 |
| TC-009 | FNOS-054-02 | 无宿主桥时不渲染刷新/重启 | AC-02 | 源码 | 1.检查 `getFnosWebActions()` 的判据 | 走 `isGatewayHosted()` | P0 | 本地开发没有可重启的进程 |

### FNOS-054-03 旧入口清理

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-010 | FNOS-054-03 | 「更多」菜单不再有飞牛 OS/刷新/重启 | AC-03 | 源码 | 1.断言源码无 `inject('sidebar.panellist.actions'` | 无 | P0 | 需求 AC-03 |
| TC-011 | FNOS-054-03 | 会话头部菜单不再有刷新/重启 | AC-03 | 源码 | 1.断言无 `id: 'refresh'` / `id: 'restart'` / `restartWeb` | 都无 | P0 | 避免同一动作两处入口 |
| TC-012 | FNOS-054-03 | 旧组件已删除 | AC-03 | 源码 | 1.检查 `FnosConfigMenuEntry` / `FnosWebActionsMenuEntry` | 均已删除 | P1 | 不留死代码 |

### FNOS-054-04 三种运行环境识别

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-013 | FNOS-054-04 | base 命中 + iframe = embedded | AC-04 | 单测 | 1.调用 `detectFnosEnvironment()` | `embedded`，宿主桥可用 | P0 | 应用中心内嵌 |
| TC-014 | FNOS-054-04 | base 命中 + 非 iframe = standalone | AC-04 | 单测 | 1.调用 `detectFnosEnvironment()` | `standalone`，属于 fnOS 但**无**宿主桥 | P0 | 本次故障根因 |
| TC-015 | FNOS-054-04 | base 未命中 = none | AC-04 | 单测 | 1.调用 `detectFnosEnvironment()` | `none` | P0 | 本地 `dsh web` |
| TC-016 | FNOS-054-04 | base 不指向 `/app/` 不算 fnOS | AC-04 | 单测 | 1.给一个别的子路径 base | `none` | P1 | 别的部署也可能注入 base |
| TC-017 | FNOS-054-04 | base 非法 URL 降级不抛错 | AC-04 | 单测 | 1.给 `not a url` | `none` | P1 | 畸形输入 |
| TC-018 | FNOS-054-04 | 无 document 不抛错 | AC-04 | 单测 | 1.stub `document = undefined` | `none` | P1 | SSR / 测试环境 |

### FNOS-054-05 独立浏览器页面能力分级

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-019 | FNOS-054-05 | 座位注册按「属于 fnOS」 | AC-05 | 源码 | 1.检查 `client/index.ts` 的 gate | `isFnosHosted()` | P0 | 混用判据即本次故障 |
| TC-020 | FNOS-054-05 | 具体动作按「有无宿主桥」 | AC-05 | 源码 | 1.检查 `FnosOpenInHeaderAction` / `FnosSettingsDocumentAction` | `hasFnosHostBridge()` | P0 | 无桥时点击必然失败 |
| TC-021 | FNOS-054-05 | 文件打开在 standalone 明确失败 | AC-05 | 单测 | 1.`isStandaloneWeb: true` 调 `openFnosEntry` | 抛错且文案点明 standalone | P0 | 静默失败最难查 |
| TC-022 | FNOS-054-05 | 路径打开不回落原生 opener | AC-05 | 单测 | 1.standalone 环境调 `openPath` | 报错且**不**调用原生实现 | P0 | NAS 容器里没有 xdg-open |
| TC-023 | FNOS-054-05 | `present.host` 无桥时报不可用 | AC-05 | 单测 | 1.standalone 环境请求 `/api/present.host` | `available: false` | P1 | 先显示按钮再失败更糟 |

### FNOS-054-06 授权回调链路

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-024 | FNOS-054-06 | standalone 下走 `openAppAuth` | AC-06 | 源码 | 1.检查选择器分支顺序 | 授权分支在直调之前 | P0 | 直调必抛错 |
| TC-025 | FNOS-054-06 | 授权页打开后不误报成功 | AC-06 | 源码 | 1.检查两个调用方都处理 `authorization-pending` | 卡片与面板都返回 | P0 | 早前会谎报「已授权」 |
| TC-026 | FNOS-054-06 | 回调页由网关提供且在转发之前 | AC-07 | 单测 | 1.断言 `app.use(appAuthCallback())` 早于 `createProxyHandler` | 顺序正确 | P0 | 否则被转到上游 DSH |
| TC-027 | FNOS-054-06 | 回调页只响应自己的路径 | AC-07 | 单测 | 1.派发三个路径 | 只有回调路径被接管 | P0 | 不能兜底劫持 |
| TC-028 | FNOS-054-06 | 回调页禁止缓存 | AC-07 | 单测 | 1.检查响应头 | `no-store` | P1 | 缓存会串用上一次结果 |
| TC-029 | FNOS-054-06 | redirectUri 同源相对路径 | AC-07 | 单测 | 1.调 `appAuthRedirectUri()` | 以 `/` 开头、无协议主机 | P0 | 跨源则 postMessage 失效 |
| TC-030 | FNOS-054-06 | 回调校验 origin 与 state | AC-07 | 源码 | 1.检查监听实现 | 两者都比对 | P0 | 防伪造授权结果 |

## 测试执行结果

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 ~ 003 | FNOS-054-01 | 本地单测 | 通过 | 2026-11-12 | `tests/client/config-dialog.spec.ts` |
| TC-004 | FNOS-054-01 | 本地单测 | 通过 | 2026-11-12 | 同上，`aria-label` / `aria-haspopup` |
| TC-005 ~ 009 | FNOS-054-02 | 本地单测 | 通过 | 2026-11-12 | 同上 |
| TC-010 ~ 011 | FNOS-054-03 | 本地单测 | 通过 | 2026-11-12 | `package-contract.spec.ts`、`session-log-menu.spec.ts` |
| TC-012 | FNOS-054-03 | 源文件检查 | 通过 | 2026-11-12 | 两组件已删除，无残留引用 |
| TC-013 ~ 018 | FNOS-054-04 | 本地单测 | 通过 | 2026-11-12 | `environment.spec.ts` 六条 |
| TC-019 ~ 020 | FNOS-054-05 | 本地单测 | 通过 | 2026-11-12 | 源码契约断言 |
| TC-021 ~ 022 | FNOS-054-05 | 本地单测 | 通过 | 2026-11-12 | `file-opener.spec.ts`、`path-opener.spec.ts` |
| TC-023 | FNOS-054-05 | 本地单测 | 通过 | 2026-11-12 | `present-open.spec.ts` |
| TC-024 ~ 030 | FNOS-054-06 | 本地单测 | 通过 | 2026-11-12 | `app-auth-callback.spec.ts`（插件）与网关同名用例（3 条） |
| TC-001 ~ 009 | FNOS-054-01/02 | 本地 DSH Web（槽位探针） | 通过 | 2026-11-12 | 探针插件实测 `sidebar.footer.action` 等五个座位均正常渲染；探针已卸载 |
| TC-001 ~ 030 | 全部 | 真实 fnOS NAS | **未执行** | — | 需装 FPK 后在应用中心内嵌与独立浏览器页面各走一遍 |
| TC-014、TC-024 ~ 029 | FNOS-054-04/06 | 真实 fnOS NAS | **未执行** | — | 授权回调链路必须在真机上验证 `redirectUri` 真正被系统带上结果跳回 |

**包级汇总**：插件 748 条、网关 182 条测试全绿；类型检查与 lint 均无错误。

## Bug 记录

| 编号 | 现象 | 根因 | 处置 |
| --- | --- | --- | --- |
| BUG-01 | 独立浏览器页面下会话头部入口与设置入口整支消失，无报错 | 用 `isEmbeddedFnosFrame()` 判「是否在 fnOS 里」，非 iframe 被当成本地开发 | 改用 `<base>` 判据；注册与能力分级分开 |
| BUG-02 | 授权页刚打开就提示「已授权」，列表无新目录 | 选择器新增 `authorization-pending` 后，面板未处理该分支，直接走到刷新 + 成功提示 | 两处调用方都显式返回 |
| BUG-03 | 独立浏览器页面点「打开目录」报技术性错误 | 错误文案区分不了「SDK 未初始化」与「该环境不提供」 | 按环境细分文案 |
| BUG-04 | 路径打开在独立浏览器页面回落到原生 opener | 判据同上 | 改为「不在 fnOS 才回落」，fnOS 内一律明确报错 |

## 遗留与说明

1. **独立浏览器页面无法「打开文件/文件管理器」。** 实测 `/app/trim.file-manager` 在已登录的真实浏览器里返回 `Not Found`；fnOS 的文件管理器是桌面 SPA 的内部路由，点它不改变 URL，**没有可外链的稳定地址**。因此不做 URL 拼接，改为明确提示「请在 fnOS 应用内使用」。
2. **独立浏览器页面不跟随 fnOS 主题/语言。** `$on` 与 `getPlatformConfig()` 在 standalone 下都抛错，属平台限制。
3. **真实 NAS 全项未执行**，尤其是授权回调链路——`redirectUri` 是否真的被系统带上结果跳回，只有真机能证。

## 最终结论

包级覆盖完整（30 条用例，插件 748 + 网关 182 条测试全绿），本地 DSH Web 已用槽位探针实测入口渲染。**真机验收待进行**，状态记为「部分通过」。
