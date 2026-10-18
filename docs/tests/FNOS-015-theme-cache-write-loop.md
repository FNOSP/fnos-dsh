---
id: FNOS-015
title: FNOS-015 测试用例
description: FNOS-015 主题缓存写入死循环修复的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-015-theme-cache-write-loop
plan: /plans/PLAN-FNOS-015-theme-cache-write-loop
status: 规划中
lastVerified: 2026-10-18
verifiedAt: 2026-10-18
---

# FNOS-015 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-015 |
| 关联需求 | [FNOS-015 主题缓存写入死循环修复](/requirements/FNOS-015-theme-cache-write-loop) |
| 关联计划 | [PLAN-FNOS-015 主题缓存写入死循环修复](/plans/PLAN-FNOS-015-theme-cache-write-loop) |
| 测试状态 | <Badge type="info" text="规划中" /> |

## 测试范围与需求分析

覆盖 [功能列表](/requirements/FNOS-015-theme-cache-write-loop#功能列表) 中 FNOS-015-01 至 FNOS-015-05 全部功能：

- 主题缓存写入收敛（[FNOS-015-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01)）。
- unset 不生效的一次性降级（[FNOS-015-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02)）。
- 主题缓存与首屏防闪保持（[FNOS-015-03](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03)）。
- 连带重渲染与请求放大消除（[FNOS-015-04](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04)）。
- 0.2.1-rc.2 上的写入门槛适配协同（[FNOS-015-05](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05)）。

**关键风险点**：

- **修复可能把循环换成"不写"**：抑制一旦过强，主题缓存不再更新，表现为首屏闪一次（功能退化而非报错），必须由 TC-007/TC-008 强制守住「主题变化必须写」「显式偏好必须清缓存」。
- **交付耦合**：FNOS-014-15 恢复写入门槛后循环会重新暴露，中间态不得上线；TC-013 专门核对发布批次是否携带最小守卫。
- **量化口径必须与 issue #13 一致**：浏览器 Performance API、20 秒窗口、同一组请求端点，否则结论不可比。
- 判定与写入均在客户端，因此**双客户端（DSH Web 与 DSH Desktop）都要覆盖**；首屏注入需要真实 fnOS 宿主桥接。

## 测试环境

目标环境按[需求的验收环境范围](/requirements/FNOS-015-theme-cache-write-loop#验收环境范围)划分；执行方式遵循[测试环境执行方式](/charter/tests-spec#测试环境执行方式)：

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| [01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01)、[02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02)、[04](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04)、[05](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | DSH Web、DSH Desktop | Web：`pnpm run start -- --web`（`DSH_HOME=<repo>/.dsh`）；Desktop：项目 `.dsh/profiles/desktop`；两者均需覆盖 |
| [03](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | DSH Web + 真实 fnOS NAS | Web 部分走本地；首屏注入与主题事件走真实 NAS 安装后的应用 |

**版本三元组**（执行前记录，缺记录不得作为结论依据）：

| 环境 | 必须记录 |
| --- | --- |
| DSH Web | DSH 运行时版本、`@tnnevol/dsh-fnos` 版本 |
| DSH Desktop | Desktop 客户端版本、内置 DSH 运行时版本、实际加载的插件版本 |
| 真实 fnOS NAS | fnOS 版本、FPK 应用版本、插件版本 |

**复现构型**（TC-001/TC-002 用）：本地以可注入的 config-form 桩构造「unset 返回成功但视图仍返回原值」的宿主行为，按 issue #13 的口径记录 `sync()` 调用与 `settings/mutate` 次数；桩代码放 `tmp/`，不入仓库。

## 测试用例

### [FNOS-015-01 主题缓存写入收敛](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01)

实现见 [PLAN-FNOS-015 T01-02](/plans/PLAN-FNOS-015-theme-cache-write-loop#阶段一修复与本地验证t01-01t01-04)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-015-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | unset 不收敛时不再重复写 | [AC-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 桩构型：unset 返回成功但下一份视图仍返回 `systemTheme: 'light'` | 1.启动本地 DSH Web 2.用 Performance API 采集 20 秒窗口 3.统计 `POST /api/settings/mutate` 次数 | `settings/mutate` 次数为真实目标变化次数（稳态 **0**），不再出现每 300–400ms 一次的重复 unset | P0 | 基线：[issue #13 报告值 30+ 次/20 秒](https://github.com/FNOSP/fnos-dsh/issues/13) |
| TC-002 | [FNOS-015-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 抑制按 revision 而非值比较解除 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 单测环境 | 1.连续触发 20 次设置通知 2.观察写入次数 3.模拟宿主 revision 前进后再触发 | 20 次通知只写 1 次；宿主 revision 未前进前不重发；revision 前进后才允许下一次 | P0 | 新增行为，无回归基线 |
| TC-003 | [FNOS-015-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 目标值真实变化必须立即写入 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 单测环境 | 1.先按 light 写入 2.目标切到 dark 3.观察写入 | 立即发起一次写入（抑制不吞掉真实变化） | P0 | 新增行为，无回归基线 |
| TC-004 | [FNOS-015-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 传输失败不形成重试风暴 | [AC-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 桩构型：写入 reject | 1.触发一次写入并令其 reject 2.持续注入设置通知 3.统计写入次数 | 失败后进入最小间隔，不在每轮通知重试；间隔内写入次数不随通知线性增长 | P1 | 新增行为，无回归基线 |

### [FNOS-015-02 unset 不生效的一次性降级](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02)

实现见 [PLAN-FNOS-015 T01-03](/plans/PLAN-FNOS-015-theme-cache-write-loop#阶段一修复与本地验证t01-01t01-04)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-005 | [FNOS-015-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02) | 降级后本次会话不再回写 | [AC-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02) | 桩构型：unset 后视图仍返回原值 | 1.触发 unset 2.注入更多设置通知与 theme 事件 3.统计该字段写入 | 首次 unset 后该字段被标记不可写，后续不再发起写入；日志可识别降级状态 | P0 | 新增行为，无回归基线 |
| TC-006 | [FNOS-015-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02) | 降级不阻塞其它写入与主题跟随 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02) | TC-005 现场 | 1.降级后切换 fnOS 主题 2.观察主题投影与其它字段写入 | 主题跟随仍生效；其它设置字段写入不受影响 | P0 | 新增行为，无回归基线 |

### [FNOS-015-03 主题缓存与首屏防闪保持](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03)

实现见 [PLAN-FNOS-015 T01-04](/plans/PLAN-FNOS-015-theme-cache-write-loop#阶段一修复与本地验证t01-01t01-04)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-007 | [FNOS-015-03](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | 主题变化后缓存被更新 | [AC-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | 真实 fnOS NAS（或可注入 fnOS theme 事件的桩） | 1.fnOS 主题 light→dark 2.读取 `dsh-fnos` 设置的 `systemTheme` 3.再切回 light 复核 | 缓存被更新为最新主题；宿主下次响应 `index.html` 注入新主题 | P0 | 基线：[既有主题缓存行为](/requirements/FNOS-015-theme-cache-write-loop#调研结论) |
| TC-008 | [FNOS-015-03](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | 跟随系统时首屏按缓存主题渲染 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | DSH 偏好为「跟随系统」，缓存存在 | 1.打开 DSH Web 2.观察首屏绘制 3.核对注入的 bootstrap 主题 | 首屏即为 fnOS 主题，无 light/dark 闪烁；注入脚本中的主题等于缓存值 | P0 | 基线：[首屏注入实现](/requirements/FNOS-015-theme-cache-write-loop#调研结论) |
| TC-009 | [FNOS-015-03](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | 显式偏好不使用/不残留旧缓存 | [AC-03](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | 缓存存在且为 fnOS 主题 | 1.DSH 切换为显式 light 2.重新打开页面 3.核对首屏主题与缓存字段 | 首屏按 DSH 显式偏好渲染，不使用 fnOS 缓存；缓存被清除（或按修复后的既定语义不再影响渲染） | P0 | 新增行为，无回归基线 |

### [FNOS-015-04 连带重渲染与请求放大消除](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-010 | [FNOS-015-04](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04) | 请求量回落到正常量级 | [AC-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04) | TC-001 现场 | 1.同一 20 秒窗口统计 `settings/describe`、`credentials/describe`、`session/modelCatalog` 2.统计 DOM 变更次数 | 三项请求量与 DOM 变更不再由循环驱动；量级与写入收敛后一致 | P1 | 基线：[issue #13 报告值 79/62/63 与 DOM 41](https://github.com/FNOSP/fnos-dsh/issues/13) |
| TC-011 | [FNOS-015-04](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04) | 模型选择器不再卡在刷新 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04) | DSH Web（已登录可用模型） | 1.打开模型选择器 2.观察 10 秒 | 正常展示模型列表，不再持续显示「正在刷新模型列表」 | P1 | 基线：issue #13 现象 |
| TC-012 | [FNOS-015-04](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04) | 其它插件组件不再高频挂载/卸载 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04) | 已装第三方用量类插件 | 1.保持页面 20 秒 2.观察该插件组件的挂载/卸载 | 不再出现 300ms 级反复挂载/卸载 | P1 | 基线：issue #13 现象 |

### [FNOS-015-05 写入门槛适配协同](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05)

实现见 [PLAN-FNOS-015 T02-01](/plans/PLAN-FNOS-015-theme-cache-write-loop#阶段二与-fnos-014-的协同t02-01)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-013 | [FNOS-015-05](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | 新运行时上写入恢复 | [AC-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | DSH `0.2.1-rc.2` + 适配后的插件 | 1.主题切换一次 2.读取 `dsh-fnos.systemTheme` | 缓存被写入（不再被已移除的快照字段拦掉） | P0 | 基线：[0.2.1-rc.2 移除 `ConfigFormSnapshot.mode`](/requirements/FNOS-015-theme-cache-write-loop#调研结论) |
| TC-014 | [FNOS-015-05](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | 门槛恢复后不复发循环 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | TC-013 环境 | 1.按 TC-001 的口径采集 20 秒窗口 2.核对写入次数 | 写入收敛，不出现重复 unset | P0 | 新增行为，无回归基线 |
| TC-015 | [FNOS-015-05](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | 交付批次含最小守卫 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | FNOS-014-15 先于 FNOS-015 落地 | 1.核对发布批次（插件版本对应的提交/产物）2.确认门槛适配携带 [PLAN-FNOS-015 T01-03](/plans/PLAN-FNOS-015-theme-cache-write-loop#阶段一修复与本地验证t01-01t01-04) 的守卫 | 发布产物不含 issue #13 的循环；无「先恢复后修」的中间态上线 | P0 | 新增行为，无回归基线 |

## 测试执行结果

> 执行后回填；不修改上方用例定义。FNOS-015-01、02、04、05 需在 **DSH Web 与 DSH Desktop 各执行一次**，仅单一客户端的结果不构成完成结论；FNOS-015-03 的注入部分需真实 fnOS NAS。

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | 尚未执行 |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| — | — | 尚无记录 | — | — | — |

## 测试结论

**尚未执行。** 用例已登记（15 条）；TC-001/TC-010 的量化口径与 issue #13 一致，执行证据登记 `docs/validation/`，本页结论引用该证据。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-18 | 初始登记 | 建立 FNOS-015 测试用例文档，覆盖 FNOS-015-01~05 共 15 条用例：写入收敛与失败退避（TC-001~004）、unset 降级（TC-005~006）、主题缓存与首屏防闪三态（TC-007~009）、连带影响消除（TC-010~012）、新运行时门槛与交付批次（TC-013~015）。量化口径沿用 issue #13 的 Performance API 方法。 |
