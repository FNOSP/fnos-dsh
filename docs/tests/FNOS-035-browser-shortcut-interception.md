---
id: FNOS-035
title: FNOS-035 测试用例
description: FNOS-035 fnOS iframe 内拦截浏览器快捷键的测试用例与执行结果。
requirement: /requirements/FNOS-035-browser-shortcut-interception
plan: /plans/PLAN-FNOS-035-browser-shortcut-interception
status: 通过
lastVerified: 2026-10-30
verifiedAt: 2026-10-30
---

# FNOS-035 测试用例

## 测试范围与需求分析

被测对象是两组被浏览器抢占的快捷键在 **fnOS iframe 内**的处理：刷新三键（`F5` / `Ctrl+R` / `Cmd+R`）与「打开设置」（`Ctrl/Cmd + ,`，含 Web 的带 `Alt` 形态）。两条路径的处理方式不同——刷新自己 `reload`，设置只转发给官方命令——两者的识别边界必须互不侵占。

执行任务见 [PLAN-FNOS-035](/plans/PLAN-FNOS-035-browser-shortcut-interception)，覆盖[需求功能](/requirements/FNOS-035-browser-shortcut-interception#功能列表)：

| 覆盖功能 | 关键风险点 |
| --- | --- |
| [FNOS-035-01](/requirements/FNOS-035-browser-shortcut-interception#fnos-035-01) 刷新快捷键只刷新 DSH Web | 是否误抢设置组合；是否漏掉 `Ctrl+R` 或 `Cmd+R` |
| [FNOS-035-02](/requirements/FNOS-035-browser-shortcut-interception#fnos-035-02) 设置快捷键不被浏览器吞掉 | 是否自己开面板（绕过状态机）；补发是否无限递归；带 `Shift` 是否被误抢 |

## 测试环境

| 环境 | 用途 | 是否作为验收依据 |
| --- | --- | --- |
| 包级测试（vitest） | 两组 matcher 的识别边界、源码契约与反向断言 | **是**（逻辑层） |
| FPK + 真实 fnOS NAS | 按键在真实浏览器里的拦截效果与面板开合 | **是**（验收依据） |

::: warning 本地 DSH Web 不作为验收依据
`@tnnevol/dsh-fnos` 的快捷键拦截以 `isEmbeddedFnosFrame()` 为前提，脱离 fnOS 宿主时守卫直接返回空卸载函数，本地 DSH Web 里按这两个组合只会看到浏览器自身的反应，无法说明拦截是否成立。本需求的验收一律以 **FPK 在真实 NAS 安装后**在浏览器里的表现为准。
:::

包级：`pnpm --filter @tnnevol/dsh-fnos run check`（typecheck + vitest 369 条）。

## 测试用例

### FNOS-035-01 刷新快捷键只刷新 DSH Web

| ID | 用例 | 预期 | 层级 |
| --- | --- | --- | --- |
| TC-001 | 三键都识别为刷新 | `F5`、`Ctrl+R`、`Cmd+R` 判定为真 | 包级 |
| TC-002 | 普通键与无关组合不算刷新 | 单纯按键、其它修饰键组合判定为假 | 包级 |
| TC-003 | 不认领设置组合 | `Ctrl/Cmd + ,` 不被判成刷新 | 包级 |
| TC-004 | 源码契约：走共享快捷键组件并 `reload` 当前文档 | 注册 `F5`/`Control`/`Meta`，命中后 `preventDefault` 且调用 `window.location.reload()` | 包级（源码） |

### FNOS-035-02 设置快捷键不被浏览器吞掉

| ID | 用例 | 预期 | 层级 |
| --- | --- | --- | --- |
| TC-005 | 识别 `Ctrl + ,` | 判定为真 | 包级 |
| TC-006 | 识别 `Cmd + ,` | 判定为真 | 包级 |
| TC-007 | 识别 `Ctrl + Alt + ,` | 判定为真 | 包级 |
| TC-008 | 识别 `Cmd + Alt + ,` | 判定为真 | 包级 |
| TC-009 | 单独逗号不算快捷键 | 判定为假 | 包级 |
| TC-010 | 不抢 `Ctrl/Cmd + Shift + ,` | 判定为假 | 包级 |
| TC-011 | 只认逗号键 | 同修饰键下的 `k`、`.` 判定为假 | 包级 |
| TC-012 | 源码契约：拦截并转发 | 先 `preventDefault`，再 `dispatchEvent` 补发等价事件 | 包级（源码） |
| TC-013 | 反向断言：不得自实现开面板 | 源码不含 `openSettingsDocument` 与 `sidebarRight` | 包级（源码） |
| TC-014 | 重入保护 | 源码含 `if (forwarding) return` | 包级（源码） |
| TC-101 | 真实 NAS：按 `Ctrl/Cmd + ,` 打开设置 | DSH 设置面板打开 | 真机 |
| TC-102 | 真实 NAS：再按一次关闭 | 设置面板关闭（由官方状态机决定） | 真机 |
| TC-103 | 真实 NAS：`F5` / `Ctrl+R` 只刷新 DSH Web | DSH 界面重载，不跳出 fnOS 宿主页面 | 真机 |

## 测试执行结果

### 已执行（包级）

| ID | 结果 | 日期 | 证据 |
| --- | --- | --- | --- |
| TC-001 | 通过 | 2026-10-29 | `browser-refresh-shortcut.spec.ts`「recognizes browser refresh shortcuts」 |
| TC-002 | 通过 | 2026-10-29 | 同文件「does not treat ordinary or unrelated shortcuts as refresh」 |
| TC-003 | 通过 | 2026-10-29 | 同文件「does not claim the settings shortcut」 |
| TC-004 | 通过 | 2026-10-29 | `package-contract.spec.ts`「keeps the fnOS authorization card on the plugin detail page」中的刷新契约断言 |
| TC-005 ~ TC-008 | 通过 | 2026-10-29 | `settings-shortcut.spec.ts`「识别 %s」四条参数化用例 |
| TC-009 | 通过 | 2026-10-29 | 同文件「不把单独的逗号当快捷键」 |
| TC-010 | 通过 | 2026-10-29 | 同文件「不抢 Ctrl/Cmd + Shift + ,（那是 DSH 的另一个命令）」 |
| TC-011 | 通过 | 2026-10-29 | 同文件「只认逗号键，不误伤同修饰键的其它键」 |
| TC-012 | 通过 | 2026-10-29 | `package-contract.spec.ts` 中 `event.preventDefault()` 与 `target.dispatchEvent(forwarded)` 两条断言 |
| TC-013 | 通过 | 2026-10-29 | 同文件 `not.toContain('openSettingsDocument')`、`not.toContain('sidebarRight')` |
| TC-014 | 通过 | 2026-10-29 | 同文件 `toContain('if (forwarding) return')` |
| TC-015 | 通过 | 2026-10-29 | 同文件 `toContain('altKey: true')`；对应 BUG-01 |

包级总量：39 个测试文件 / 369 条全绿（`pnpm --filter @tnnevol/dsh-fnos run check`）。

### 已执行（真实 NAS）

| ID | 结果 | 日期 | 证据 |
| --- | --- | --- | --- |
| TC-101 ~ TC-103 | 通过 | 2026-10-30 | 6.1.15 FPK 在真实 NAS 安装后，提出人确认 `Ctrl/Cmd + ,` 能打开并关闭 DSH 设置面板、刷新快捷键仍只作用于内嵌页面。逐条细节未单独截图取证 |

## Bug 记录

| ID | 现象 | 原因 | 修复 | 回归 |
| --- | --- | --- | --- | --- |
| BUG-01 | fnOS 应用内按 `Ctrl/Cmd + ,`，浏览器自身的设置不再弹出（说明拦截生效），但 DSH 设置弹框也不出现 | 官方 `settings.open` 的默认绑定按运行时区分：Desktop 是 `primary + Comma`，**Web 是 `primary + alt + Comma`**。fnOS 应用跑在 iframe 里、运行时为 Web，而补发事件沿用了用户实际按键、没带 `alt`，于是官方两组绑定都命中不了；原事件又已被 `stopPropagation`，表现就是「什么都不发生」 | 补发事件统一置 `altKey: true`，命中 Web 那组绑定；修饰键沿用用户实际按键，保证 macOS 用 `meta`、Windows 用 `control` 都能对上 `primary` | `package-contract.spec.ts` 增加 `altKey: true` 断言；`settings-shortcut.spec.ts` 的识别用例不变 |

## 未覆盖与后续验证

| 项 | 原因 | 后续动作 |
| --- | --- | --- |
| 浏览器是否真的会把事件让出来 | 包级只能验证识别与转发逻辑，无法模拟浏览器自身对 `Ctrl/Cmd + ,` 的抢占 | 按 TC-101 在真实 NAS 上验证 |
| 面板「已打开则关闭」的往返 | 依赖官方状态机与真实弹层 | 按 TC-101、TC-102 连续按两次验证 |
| `isEmbeddedFnosFrame()` 守卫的实际生效 | 需要非 iframe 承载环境做反例 | 未自动化；由代码守卫保证，后续可在 DSH Desktop 侧抽查 |
| macOS 上 `Cmd + ,` 的浏览器抢占 | 需真实 macOS 浏览器 | 按 TC-101 在 macOS 上验证 |

## 最终结论

包级 11 条用例全部通过；**真机验收于 2026-10-30 通过**（提出人在真实 NAS 上确认 6.1.15）：设置键能正常开合设置面板，刷新快捷键仍只刷新内嵌页面。本地 DSH Web 的观感不作为验收依据。
