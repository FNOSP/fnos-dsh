---
id: FNOS-045
title: FNOS-045 测试用例
description: FNOS-045 应用与插件多语言支持的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-045-app-plugin-i18n
plan: /plans/PLAN-FNOS-045-app-plugin-i18n
status: 部分通过
lastVerified: 2026-11-04
verifiedAt: 2026-11-04
---

# FNOS-045 测试用例

## 测试范围与需求分析

被测对象是应用包的多语言资源（`i18n/` 目录，以及 `manifest`、`app/ui/config`、`wizard/*` 的占位符）、六个随包插件的语言包注册，以及飞牛界面语言到 DSH 界面语言的同步。需求见 [FNOS-045](/requirements/FNOS-045-app-plugin-i18n)，执行任务见 [PLAN-FNOS-045](/plans/PLAN-FNOS-045-app-plugin-i18n)。

覆盖功能：

| 编号 | 功能 | 关键风险点 |
| --- | --- | --- |
| [FNOS-045-01](/requirements/FNOS-045-app-plugin-i18n#fnos-045-01) | 应用元数据本地化 | 某份语言文件缺键：界面不崩，但那一种语言里突然冒出英文，只有校验能发现 |
| [FNOS-045-02](/requirements/FNOS-045-app-plugin-i18n#fnos-045-02) | 桌面入口本地化 | 产品名被翻译成目标语言，入口名与文档、Release 对不上 |
| [FNOS-045-03](/requirements/FNOS-045-app-plugin-i18n#fnos-045-03) | 向导本地化 | 把 `field`、`initValue`、`rules.pattern` 一起「翻译」：字段名变了，既有配置读不到 |
| [FNOS-045-04](/requirements/FNOS-045-app-plugin-i18n#fnos-045-04) | 插件九种语言 | 语言 id 被重复注册抛错；或字典键集合漂移，界面出现键名 |
| [FNOS-045-05](/requirements/FNOS-045-app-plugin-i18n#fnos-045-05) | fnOS 语言同步切换 DSH | 同步到尚未注册的语言把界面切空；非飞牛环境下误订阅 |

❓ 未决：本轮无 fnOS 设备，应用中心/向导/插件在真实系统语言切换下的表现只能由使用方验证（见第 2 节）。

## 测试环境

| 功能 | 环境 | 说明 |
| --- | --- | --- |
| FNOS-045-01、02、03 | 本地构建链路（macOS 15 / arm64，fnpack 1.2.3） | 校验脚本 + 构建产物解包核对 |
| FNOS-045-04 | 本地 CLI 与插件单测（Node 22） | 键集合由类型系统在编译期约束，另有资源校验脚本 |
| FNOS-045-05 | 插件单测（注入的 SDK 桩） | 不依赖真实 `@trimjs/web-app` |
| 真机语言切换 | 真实 fnOS NAS | **本轮无法执行**：无 fnOS 设备 |

## 测试用例

### FNOS-045-01 应用元数据本地化

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-001 | AC-01 | 清单三个用户可见字段改为占位符 | — | 读 `manifest` | `display_name` / `desc` / `changelog` 均为 `${common.*}` | P0 |
| TC-002 | AC-02 | 九份语言文件 section 与 key 完全一致 | 九份文件存在 | 跑 `check --i18n` | 无缺键、无多余键；少一份或多一个键即失败 | P0 |
| TC-003 | AC-03 | 构建产出的 FPK 内含 `i18n/` 与各语言文件 | 本地构建 | 解包列成员 | `i18n/<locale>` 全部在包内，包内 `manifest` 仍是占位符 | P0 |

### FNOS-045-02 桌面入口本地化

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-004 | AC-01 | 入口标题使用占位符 | — | 读 `app/ui/config` | `title` 为 `${entry.title}` | P0 |
| TC-005 | AC-02 | 产品名在各语言中保持原样 | — | 检查九份语言文件 | `displayName` / `title` 均为 `DeepSeek Harness` | P1 |

### FNOS-045-03 向导本地化

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-006 | AC-01 | 四个向导的用户可见文本全部占位符化 | — | 扫四个 wizard 文件的文本字段 | 无残留中文；`stepTitle`/`label`/`message`/`helpText`/选项 `label` 均为 `${section.key}` | P0 |
| TC-007 | AC-02 | 字段名、默认值、校验正则不被本地化 | — | 比对改造前后 | `field`、`initValue`、`rules.pattern` 逐字节不变 | P0 |
| TC-008 | AC-03 | 占位符引用的键在每份语言文件里都存在 | — | 跑 `check --i18n` | 无「缺少被引用的键」 | P0 |

### FNOS-045-04 插件九种语言

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-009 | AC-01 | 六个插件都有七份新增语言字典 | — | 跑 `check --i18n` | 42 个文件齐全，且各自 `export const <locale>` | P0 |
| TC-010 | AC-02 | 字典键集合与权威字典一致 | — | 类型检查 | `{ [Key in XLocaleKey]: string }` 声明使缺键/多项成为编译错误 | P0 |
| TC-011 | AC-01 | 语言定义不重复注册 | 语言已被其它插件注册 | 调用 `ensurePluginLanguages` | 不抛错；只注册缺失的语言 | P0 |
| TC-012 | AC-04 | 技术标识不被翻译 | — | 抽查字典 | 命令、路径、URL、模型 ID、环境变量保持原样 | P1 |
| TC-013 | AC-03 | 切换语言后文案立即变化 | DSH Web | 在设置里切换语言 | 插件文案即时切换，无需刷新 | P1 |

### FNOS-045-05 fnOS 语言同步切换 DSH

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-014 | AC-01 | 启动时按当前飞牛语言对齐 | 桩 SDK 返回 `ja-JP` | 调用同步安装 | 调 `setLocale('ja')` | P0 |
| TC-015 | AC-02 | 飞牛语言变化后立即同步 | 已订阅 | 触发 `os/language` | 依次调 `setLocale` 对应语言 | P0 |
| TC-016 | AC-04 | 目标语言未注册时跳过 | 只注册中英 | 桩返回 `ja-JP` | 不调 `setLocale`，不抛错 | P0 |
| TC-017 | — | 非飞牛 Web 宿主不订阅 | `isWeb=false` | 安装同步 | 不调 `setLocale`、不订阅 | P0 |
| TC-018 | — | 清理后不再响应变化 | 已安装 | 调释放函数后触发事件 | 订阅数归零，`setLocale` 不再增加 | P1 |
| TC-019 | AC-03 | 未知语言回退英文 | — | `resolveDshLocale('th-TH')` | 返回 `en` | P0 |

## 测试执行结果

| 用例 | 结果 | 执行日期 | 证据 |
| --- | --- | --- | --- |
| TC-001 | 通过 | 2026-11-04 | 清单三字段为 `${common.displayName}` / `${common.desc}` / `${common.changelog}` |
| TC-002 | 通过 | 2026-11-04 | `check --i18n`：`9 locale(s) × 46 key(s)`，九份文件键集合无差异 |
| TC-003 | 通过 | 2026-11-04 | 实跑构建后 `tar -tzf` 列出 9 个 `i18n/<locale>` 成员；包内 `manifest` 仍是占位符 |
| TC-004 | 通过 | 2026-11-04 | `app/ui/config` 的 `title` 为 `${entry.title}` |
| TC-005 | 通过 | 2026-11-04 | 九份语言文件的 `displayName` 与 `title` 均为 `DeepSeek Harness` |
| TC-006 | 通过 | 2026-11-04 | 四个 wizard 文件的中文字符串扫描：0 处残留 |
| TC-007 | 通过 | 2026-11-04 | `git diff` 中触及 `field` / `initValue` / `pattern` / `required` 的行数：0 |
| TC-008 | 通过 | 2026-11-04 | `check --i18n`：46 个占位符引用在九份文件里全部可解析 |
| TC-009 | 通过 | 2026-11-04 | `check --i18n` 报 `6 plugin(s)`；42 份字典齐全且各自导出 `const <locale>` |
| TC-010 | 通过 | 2026-11-04 | 六个插件 `tsc --noEmit` 全部通过；`{ [Key in XLocaleKey]: string }` 使缺键/多键成为编译错误 |
| TC-011 | 通过 | 2026-11-04 | `tests/client/language-pack.spec.ts` 六条用例（含「已存在则跳过」「只回收自己加的」） |
| TC-012 | 通过 | 2026-11-04 | 抽查 ja/ru：`127.0.0.1`、`@deepseek-ai/dsh`、`/var/log/apps/fn-deepseek-harness.log`、`0.2.1-rc.5`、`192.0.2.10:5666`、`[fd00::1]:5666` 均原样保留 |
| TC-013 | 未执行 | — | 需在 DSH Web 中人工切换语言确认文案即时变化 |
| TC-014～TC-019 | 通过 | 2026-11-04 | `tests/client/language-sync.spec.ts` 九条用例全绿 |
| 真机语言切换 | 未执行 | — | 无 fnOS 设备 |

## Bug 记录

| 编号 | 发现于 | 描述 | 状态 |
| --- | --- | --- | --- |
| BUG-01 | TC-014 设计阶段 | 语言同步模块最初静态 `import` 飞牛 SDK，导致该模块的单测在 Node 下因 `window is not defined` 无法加载 | 已修复：SDK 工厂改为调用方注入（`createSdk`），模块本身不依赖浏览器全局；单测用桩驱动 |
| BUG-03 | TC-012 抽查 | 应用描述的「服务默认仅监听 126.0.0.1」是历史笔误：代码实际绑定 `127.0.0.1`（`gateway-proxy.mjs` 的 `DSH_UPSTREAM_HOST` / `DSH_WEB_HOST` 默认值）。该错误随翻译复制到九份语言文件 | 已修复：九份语言文件统一改为 `127.0.0.1` |
| BUG-02 | TC-002 设计阶段 | 只用「能跑起来」判断多语言资源是否完整时，某份语言文件缺键不会报错——界面回退英文，表现是「这一块突然变成英文」 | 已修复：`check --i18n` 以键集合完全相等为判定；插件侧改用 `{ [Key in XLocaleKey]: string }` 让缺键成为编译错误 |

## 测试结论

**本文件的结果表随实施进度更新；未验证的条目一律标为「待执行」，不预设通过。**

**遗留风险（不阻塞本轮合入，但阻塞「多语言已验收」的结论）**：本轮无 fnOS 设备，真实系统的语言切换、应用中心与向导的本地化渲染、插件在真实宿主中的语言跟随都未在设备上验证。平台是否接受 `ko-KR`、`de-DE`、`fr-FR`、`es-ES`、`it-IT`、`ru-RU` 这些语言文件名，也是按官方文档「按 BCP 47 增加语言文件」推断的，**未经真机确认**——若平台只认文档示例里的三种，其余语言会回退 `en-US`。翻译质量无法自动化验证，只能靠人工抽查与用户反馈。

变异验证：

1. 删掉 `i18n/ja-JP` 里任意一个键 → `check --i18n` 报出具体缺失键名。
2. 把某份插件字典的键改错 → 类型检查失败（`{ [Key in XLocaleKey]: string }` 约束）。
3. 把语言同步的 `setLocale` 调用去掉 → `language-sync.spec.ts` 三条用例变红。
