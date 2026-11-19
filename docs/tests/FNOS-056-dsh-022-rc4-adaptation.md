---
id: FNOS-056
title: FNOS-056 DSH 0.2.2-rc.4 插件适配与基线升级测试用例
description: 覆盖基线承载处一致性、插件锚定、安装升级链路与双入口（iframe / 独立 DSH Web）在真实 fnOS NAS 上的验收。
requirement: /requirements/FNOS-056-dsh-022-rc4-adaptation
plan: /plans/PLAN-FNOS-056-dsh-022-rc4-adaptation
status: 部分通过
owner: tnnevol
targetVersion: 8.2.0
lastVerified: 2026-11-19
verifiedAt: 2026-11-19
---

# FNOS-056 DSH 0.2.2-rc.4 插件适配与基线升级测试用例

关联需求：[FNOS-056 DSH 0.2.2-rc.4 插件适配与基线升级](/requirements/FNOS-056-dsh-022-rc4-adaptation)；关联计划：[PLAN-FNOS-056](/plans/PLAN-FNOS-056-dsh-022-rc4-adaptation)。

## 测试范围与需求分析

被测对象：仓库运行基线（catalog 与安装回调）、七个入库插件的锚定与兼容声明、FPK 安装升级链路、fnOS 插件在两种入口下的加载。

覆盖功能：FNOS-056-01、FNOS-056-02、FNOS-056-03、FNOS-056-04、FNOS-056-07。

关键风险点：
- 命名 catalog 与发布龄期豁免清单无守卫，漏改会导致「顶层 rc.4、依赖按 rc.1 解析」的静默错位
- 安装期对上游 `attachment-local` 产物的字符串补丁逐字节匹配，失配即安装失败
- fnOS 插件的会话头部与侧栏入口受 `isFnosHosted()` 门控，本地 Web 与 Desktop 都不覆盖

## 测试环境

| 功能 | 目标环境 |
| --- | --- |
| FNOS-056-03 | 本地仓库状态 + 本地运行时版本报告 |
| FNOS-056-01、02 | DSH Web 与 DSH Desktop；fnOS 专属部分在真实 fnOS NAS |
| FNOS-056-04、07 | 真实 fnOS NAS（应用中心安装/升级） |

设备：内网 fnOS NAS，x86 平台，系统 Node `nodejs_v24` v24.22.3。

## 测试用例

### FNOS-056-03 基线承载处一致

| 编号 | 用例 | 预期 | 结果 |
| --- | --- | --- | --- |
| TC-001 | 默认 catalog 取值为 rc.4 | `0.2.2-rc.4` | 通过 |
| TC-002 | 命名 catalog 42 条一致 | 全部 rc.4 | 通过 |
| TC-003 | 发布龄期豁免清单一致 | 全部 rc.4 | 通过 |
| TC-004 | 安装回调 `DSH_VERSION` 一致 | `0.2.2-rc.4` | 通过 |
| TC-005 | 变异：故意把命名 catalog 一处改回 rc.1 | 守卫报红 | 通过（`expected ['0.2.2-rc.4','0.2.2-rc.1'] to equal ['0.2.2-rc.4']`） |
| TC-006 | 变异：豁免清单漏改一处 | pnpm 拒绝安装 | 通过（`MINIMUM_RELEASE_AGE_VIOLATION`） |

### FNOS-056-01 插件锚定

| 编号 | 用例 | 预期 | 结果 |
| --- | --- | --- | --- |
| TC-010 | 七个插件 `engines.dsh` 为 rc.4 | 全部 rc.4 | 通过 |
| TC-011 | 七个插件 `compatibility.json` 为 rc.4 | 全部 rc.4 | 通过 |
| TC-012 | 基线守卫用例 | 18 条全绿 | 通过 |

### FNOS-056-04 安装与升级链路（真实 NAS）

| 编号 | 用例 | 预期 | 结果 |
| --- | --- | --- | --- |
| TC-020 | 应用中心手动安装 FPK | 安装成功 | 通过 |
| TC-021 | 安装回调识别基线不匹配并重装 | 日志出现 `does not match required 0.2.2-rc.4; reinstalling` | 通过 |
| TC-022 | 安装期 attachment 补丁未失败 | 无补丁失配错误 | 通过 |
| TC-023 | 升级后服务启动 | `DSH Web state: running`，网关监听 app.sock | 通过 |
| TC-024 | 运行时版本 | DSH `0.2.2-rc.4` | 通过 |
| TC-025 | 内置插件版本 | `8.2.2`，`engines.dsh` 为 rc.4 | 通过 |

### FNOS-056-02 fnOS 插件双入口（真实 NAS）

| 编号 | 用例 | 预期 | 结果 |
| --- | --- | --- | --- |
| TC-030 | iframe 入口（`/` 下打开应用） | DSH 界面正常，`飞牛 OS` 入口存在 | 通过 |
| TC-031 | iframe 内 `<base>` 判定 | `env=embedded`，`isFnosHosted=true` | 通过 |
| TC-032 | 飞牛 OS 下拉菜单 | 「飞牛设置 / 刷新 / 重启」三项 | 通过 |
| TC-033 | 独立 DSH Web（`/app/fn-deepseek-harness/`） | 界面正常，`飞牛 OS` 入口存在 | 通过 |
| TC-034 | 独立页判定 | `env=standalone`，`isFnosHosted=true` | 通过 |
| TC-035 | 控制台错误 | 无插件相关错误 | 通过（仅 1 条 PWA manifest 语法错误，由 fnOS 网关代理，与插件无关） |

### FNOS-056-01 补充：fnOS 插件在真实 NAS 的功能面（本轮补验）

| 编号 | 用例 | 预期 | 结果 |
| --- | --- | --- | --- |
| TC-036 | 插件列表接口返回全部已装插件 | 5 个插件含 fnOS 8.2.2 | 通过 |
| TC-037 | 更新检测取「适配当前 DSH 的最高版本」 | dshmarket 1.73.20 → latest 1.73.21 判定有新版本 | 通过 |
| TC-038 | 运行页读取真实宿主指标 | 端口 3080、PID、CPU 1.9%、内存 519 MB、网关与 dsh web 双进程 | 通过 |
| TC-039 | 主题跟随（`data-ds-theme-source=system`） | 首屏注入值随 fnOS 主题，背景为深色 `rgb(21,21,23)` | 通过 |
| TC-040 | 授权目录在无宿主桥时的降级 | 显示「当前环境不支持 / 这些设置项需要运行在 fnOS 中」 | 通过（按设计：仅该分组降级，其余分组仍可用） |
| TC-041 | 插件管理分组在无宿主桥时仍可用 | 插件卡片、开关、npm 镜像、反代路由正常渲染 | 通过 |
| TC-042 | 飞牛 OS 下拉菜单 | 「飞牛设置 / 刷新 / 重启」三项 | 通过 |

## 测试执行结果

| 结果 | 数量 |
| --- | --- |
| 通过 | 26 |
| 失败 | 0 |
| 阻塞 | 0 |
| 未执行 | 2（`/fn` 文件引用、会话日志导出到 NAS） |

## Bug 记录

本轮无新增缺陷。发现一处既有配置差异：fnOS 插件在本地 web profile 的 `bundles` 中未启用，属提出人主动禁用，非缺陷。

## 测试结论

基线升级在真实 fnOS NAS 上成立：四处基线承载处一致、插件锚定正确、安装升级链路通过、双入口均正常加载。

**本轮补验通过**：更新检测（dshmarket 1.73.20 → 1.73.21 正确判定）、运行页真实宿主指标、主题跟随（`data-ds-theme-source=system`，深色背景 `rgb(21,21,23)`）、授权目录在无宿主桥时的按设计降级（仅该分组降级，插件管理与运行分组仍可用）。

**仍未覆盖**：
1. `/fn` 文件引用选择树与会话日志导出到 NAS —— 需在 fnOS 界面内实际点选文件
2. 会话头部两个按钮改回普通优先级后的实际视觉位置 —— 需目视确认
3. DSH Desktop 侧的完整界面走查（本轮仅验证 DSH Web 与 fnOS 双入口）
