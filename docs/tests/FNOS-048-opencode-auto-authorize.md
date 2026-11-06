---
id: FNOS-048
title: FNOS-048 测试用例
description: OpenCode 登录授权页自动打开的用例设计、执行结果与问题记录。
requirement: /requirements/FNOS-048-opencode-auto-authorize
plan: /plans/PLAN-FNOS-048-opencode-auto-authorize
status: 通过
lastVerified: 2026-11-06
verifiedAt: 2026-11-06
---

# FNOS-048 测试用例

被测对象是 `plugins/dsh-opencode-plugin` 账号卡片的开窗编排、复制授权地址与相关文案。需求见 [FNOS-048](/requirements/FNOS-048-opencode-auto-authorize)，执行任务见 [PLAN-FNOS-048](/plans/PLAN-FNOS-048-opencode-auto-authorize)。

## 测试范围与需求分析

| 编号 | 功能 | 关键风险点 |
| --- | --- | --- |
| [FNOS-048-01](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-01-自动打开授权页) | 自动打开授权页 | 开窗必须在用户手势的同步栈内；Desktop 壳对 `about:` 与 `https:` 处置不同，`null` 句柄不等于失败 |
| [FNOS-048-02](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-02-授权页自动预填验证码) | 自动预填验证码 | 必须取 `verification_uri_complete` 而非 `verification_uri` |
| [FNOS-048-03](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-03-去掉多余入口) | 去掉多余入口 | 旧链接残留在窄侧栏里会与新按钮重复 |
| [FNOS-048-04](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-04-复制失败可兜底) | 复制失败兜底 | 只报失败而不给地址等于把用户堵死 |

**兼容基线**：本插件按[测试用例文档规范](/charter/tests-spec#测试环境执行方式)需覆盖 DSH Web 与 DSH Desktop 两个客户端。开窗差异正是这两个客户端的分界点，因此两条路径都必须在用例中出现。

## 测试环境

| 功能 | 环境 | 说明 |
| --- | --- | --- |
| FNOS-048-01 ~ 04 | 单元测试 | `cd plugins/dsh-opencode-plugin && pnpm run test`，注入假开窗器 |
| FNOS-048-01 | DSH Web / DSH Desktop | 点登录观察授权页是否自动打开（Desktop 由壳交给系统浏览器） |
| FNOS-048-03、04 | 源码级断言 | 组件接线检查，避免视觉回归依赖人工目视 |

### 版本三元组

| 环境 | 记录项 | 实测值 |
| --- | --- | --- |
| DSH Web / Desktop | DSH 运行时版本 | `0.2.2-rc.1` |
| 插件 | 插件构建版本 | `8.1.2` |

## 测试用例

### FNOS-048-01 自动打开授权页

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-048-01](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-01-自动打开授权页) | 浏览器路径：占位页开出后导航到授权地址 | [AC-01](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-01-自动打开授权页) | 假开窗器返回窗口 | 开占位页 → 导航 | 只开一次占位页；`location.href` 被写成授权地址 | P0 | 基线：FNOS-026「点链接才打开」 |
| TC-002 | 同上 | Desktop 路径：占位页被 deny 后直接开真实地址 | AC-01 | 假开窗器恒返回 `null` | 开占位页 → 导航失败 → 直接开窗 | 依次尝试 `about:blank` 与真实地址，且不等同失败 | P0 | 基线：Codex 插件 Desktop 开窗结论 |
| TC-003 | 同上 | `null` 句柄不得当作「被拦截」 | AC-01 | 假开窗器返回 `null` | 调用直接开窗 | 不抛错、不阻断登录流程 | P0 | 基线：[FNOS-027](/requirements/FNOS-027-dsh-zcode-plugin) 同类结论 |
| TC-004 | 同上 | 占位页必须在登录请求之前打开 | AC-01 | 组件源码 | 检查调用顺序 | `openAuthorizationPlaceholder()` 出现在 `await startDeviceLogin()` 之前 | P0 | 新增行为，无回归基线 |
| TC-005 | 同上 | 窗口已被用户关闭时导航失败并回落 | AC-01 | 假窗口 `closed=true` | 导航 | 返回 false 且不写入 `location` | P1 | 新增行为，无回归基线 |
| TC-006 | 同上 | 开窗能力抛错时不冒泡 | AC-01 | 注入抛错的 opener | 开占位页 / 直接开窗 | 均返回 `null` / 静默，不抛异常 | P0 | 新增行为，无回归基线 |
| TC-007 | 同上 | 取消登录时收回占位页 | AC-01 | 占位页窗口存在 | 点取消 | 调用 `close()` 并清空句柄 | P1 | 新增行为，无回归基线 |
| TC-008 | 同上 | 登录请求失败时关掉空白标签 | AC-01 | 登录接口报错 | 点登录 | 占位页被关闭，错误正常展示 | P1 | 新增行为，无回归基线 |

### FNOS-048-02 授权页自动预填验证码

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-009 | [FNOS-048-02](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-02-授权页自动预填验证码) | 优先取带验证码的完整地址 | [AC-02](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-02-授权页自动预填验证码) | 上游同时返回两个字段 | 解析设备码响应 | 使用 `verification_uri_complete` | P0 | 基线：FNOS-026 设备码解析 |
| TC-010 | 同上 | 真实上游地址确实带 `user_code` | AC-02 | 真实 Console 设备码接口 | 只读请求一次 | `verification_uri_complete` 含 `user_code` 查询参数 | P1 | 新增行为，无回归基线 |

### FNOS-048-03 去掉多余入口

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-011 | [FNOS-048-03](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-03-去掉多余入口) | 组件不再引用「打开验证页面」 | [AC-03](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-03-去掉多余入口) | — | 源码检查 | 不含 `accountOpenVerification`，改为复制按钮 | P0 | 基线：FNOS-026 卡片布局 |
| TC-012 | 同上 | 旧文案键已从九语言移除 | AC-03 | — | 遍历九份字典 | 均不含该键，键集合保持一致 | P1 | 基线：[FNOS-045](/requirements/FNOS-045-app-plugin-i18n) 键集合约束 |

### FNOS-048-04 复制失败可兜底

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-013 | [FNOS-048-04](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-04-复制失败可兜底) | 复制成功后按钮短暂显示「已复制」 | [AC-04](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-04-复制失败可兜底) | 剪贴板可用 | 点「复制授权地址」 | 文案切换为已复制并在 2 秒后复原 | P1 | 新增行为，无回归基线 |
| TC-014 | 同上 | 复制失败时显示地址原文供手动选中 | AC-04 | 剪贴板被拒 | 点复制 | 渲染地址原文与失败提示，地址可选中 | P0 | 新增行为，无回归基线 |
| TC-015 | 同上 | 剪贴板不可用时回落到 `execCommand` | AC-04 | 无 `navigator.clipboard` | 复制 | 走 `execCommand` 并如实返回结果 | P1 | 新增行为，无回归基线 |

## 测试执行结果

执行时间 2026-11-06，环境：本机单元测试（注入假开窗器）+ 真实上游设备码接口只读探测。

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-048-01 | 单元测试 | 通过 | 2026-11-06 | 只开占位页一次，`location.href` 被写入授权地址 |
| TC-002 | FNOS-048-01 | 单元测试 | 通过 | 2026-11-06 | 调用序列为 `about:blank` → 真实地址 |
| TC-003 | FNOS-048-01 | 单元测试 | 通过 | 2026-11-06 | 返回 `null` 时不抛错，不阻断 |
| TC-004 | FNOS-048-01 | 源码级断言 | 通过 | 2026-11-06 | 占位页调用位于 `await startDeviceLogin()` 之前 |
| TC-005 | FNOS-048-01 | 单元测试 | 通过 | 2026-11-06 | `closed=true` 时返回 false 且不写入 |
| TC-006 | FNOS-048-01 | 单元测试 | 通过 | 2026-11-06 | 抛错被收敛成 `null`（实现因此加了 try/catch） |
| TC-007 | FNOS-048-01 | 单元测试 | 通过 | 2026-11-06 | 取消时 `close()` 被调用一次 |
| TC-008 | FNOS-048-01 | 单元测试 | 通过 | 2026-11-06 | 登录失败分支关闭占位页 |
| TC-009 | FNOS-048-02 | 单元测试 | 通过 | 2026-11-06 | 优先 `verification_uri_complete` |
| TC-010 | FNOS-048-02 | 真实上游 | 通过 | 2026-11-06 | 实测返回 `/console/device?user_code=MZJT-WMTC&client_id=opencode-cli` |
| TC-011 | FNOS-048-03 | 源码级断言 | 通过 | 2026-11-06 | 组件与产物均无旧键 |
| TC-012 | FNOS-048-03 | 单元测试 | 通过 | 2026-11-06 | 九语言键集合一致 |
| TC-013 | FNOS-048-04 | 源码级断言 | 通过 | 2026-11-06 | 成功态复用「已复制」文案 |
| TC-014 | FNOS-048-04 | 源码级断言 | 通过 | 2026-11-06 | 失败分支渲染 `challenge.verificationUri` 与提示 |
| TC-015 | FNOS-048-04 | 单元测试 | 通过 | 2026-11-06 | 无 clipboard 时走 `execCommand` |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | [TC-006](#fnos-048-01-自动打开授权页) | 开窗编排未防御注入的 opener 抛错 | P2 | 已修复 | 单测暴露：`openAuthorizationPlaceholder` 直接调用 `opener.open`，CSP 或跨源限制抛错会冒泡到组件（客户端未处理异常会沿宿主链路放大）。已在编排层收敛为 `null`，调用点无需再包 try/catch |
| BUG-02 | [TC-014](#fnos-048-04-复制失败可兜底) | 地址复制失败复用了验证码的失败文案 | P2 | 已修复 | 原实现与「复制验证码」共用 `copyFailed`，地址复制失败时提示「请手动选中验证码复制」，而地址并未显示在页面上，用户无从复制。改为独立状态并渲染地址原文 |

## 测试结论

**结论：通过。** 15 条用例全部通过（0 失败 / 0 阻塞 / 0 未执行）。

覆盖情况：

- [FNOS-048-01](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-01-自动打开授权页) 至 [FNOS-048-04](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-04-复制失败可兜底) 四个功能点与 [AC-01](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-01-自动打开授权页) 至 [AC-04](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-04-复制失败可兜底) 四条验收条件均有对应用例。
- 浏览器与 Desktop 两条开窗路径都有独立用例，Desktop 的 `null` 语义单独钉住，避免回归到「`null` = 被拦截」的旧结论。

遗留风险：

1. **弹窗拦截与壳接管无法区分**：两者都表现为 `window.open` 返回 `null`。因此界面不提示「被拦截」，而是始终提供「复制授权地址」作为兜底；这是刻意取舍，避免 Desktop 用户被错误提示惊扰。
2. **本轮未做双客户端界面目视**：开窗行为依赖真实浏览器手势与 Electron 壳，自动化环境无法完整复现点击链；逻辑层已由单元与接线断言覆盖，建议在 UI 验收时两个客户端各点一次登录确认。
