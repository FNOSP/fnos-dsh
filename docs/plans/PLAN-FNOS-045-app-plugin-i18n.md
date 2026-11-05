---
id: PLAN-FNOS-045
title: PLAN-FNOS-045 应用与插件多语言支持
description: 用 fnOS 包内 i18n 目录本地化元数据、入口与向导；用 DSH 客户端语言包为随包插件补齐九种语言；用飞牛 JS SDK 把系统语言同步到 DSH 语言。
status: completed
owner: tnnevol
targetVersion: 7.1.0
lastVerified: 2026-11-04
---

# PLAN-FNOS-045 应用与插件多语言支持

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-045 |
| 关联需求 | [FNOS-045 应用与插件多语言支持](/requirements/FNOS-045-app-plugin-i18n) |
| 计划状态 | 已完成（2026-11-05 真机验收通过） |
| 适用范围 | 应用包 i18n 目录、向导与入口占位符、六个随包插件语言包、fnOS 语言同步 |

## 现状与目标

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| 应用元数据 | `manifest` 的 `desc` / `display_name` / `changelog` 为中文文本 | 三字段改为 `${common.*}` 占位符，文本移入 `i18n/<locale>` | 平台按界面语言解析；语言文件缺失时回退 `en-US` |
| 桌面入口 | `app/ui/config` 的 `title` 硬编码 `DeepSeek Harness` | `title` 改 `${entry.title}`，补 `desc` 的本地化 | 入口标题随语言；产品名九种语言保持一致 |
| 向导 | 四个向导文件的 `stepTitle` / `label` / `message` / `helpText` / 选项 `label` 为中文 | 全部改为 `${<section>.<key>}` 占位符；`field`、`initValue`、`rules.pattern` 不动 | 用户可见文本随语言；收集到的字段与环境变量完全不变 |
| 插件文案 | `src/client/locales.ts` 只有 `zh` / `en`，注册走类型化双语言形式 | 每种语言一个 `locales.<locale>.ts`，走单语言非类型化注册 | 语言列表从 2 种变为 9 种；缺键回退英文 |
| 语言联动 | 无。fnOS 语言与 DSH 语言互不相干 | 飞牛插件注册九种语言，并把 fnOS 界面语言同步为 DSH 语言；提供关闭开关 | 用户不再需要手动切换；显式选择仍可保留 |

### 已核实的平台事实（2026-11-04）

| 事实 | 依据 |
| --- | --- |
| 应用包支持 `i18n/` 目录，语言文件用 INI 语法，引用形式为 `${section.key}`，同时覆盖 `manifest`、`app/ui/config` 与 wizard 文件 | 飞牛应用开发文档「国际化」页（`/core-concepts/i18n`）：manifest 三字段、入口 `title`/`desc`、向导 `stepTitle`/`label`/`message`/`helpText`/选项 `label` |
| 存在 `i18n/` 时 `en-US` 为必需文件；其余语言按 BCP 47 形式增加，各语言文件必须 section 与 key 完全一致 | 同上「文件结构」「检查清单」 |
| 飞牛 JS SDK 提供 `getPlatformConfig()`（含 `language`，如 `zh-CN`）与 `$on('os/language', cb)` | `@trimjs/web-app` 类型 `PlatformConfig.language`；飞牛文档「页面交互」语言变化监听 |
| DSH 客户端内置语言只有 `zh` / `en`，插件可 `addLanguage({id,label,fallback})` 增加可选语言，并用 `register(ns, locale, dict)` 注册单语言字典 | `@deepseek-ai/dsh-client-locale` 的 `LocaleRuntime`：`LOCALE_IDS = ['zh','en']`、`LocaleId = string`（BCP 47 风格）、`addLanguage`、`setLocale`、单语言 `register` |
| `setLocale(id)` 是唯一的偏好写入入口，会持久化到 Host 设置；`locale/change` 事件在切换时发出 | 同上类型注释与事件定义 |
| 同一语言 id 只能被注册一次，重复注册会抛错 | `addLanguage` 注释「throws when … the id is occupied」 |

## 影响范围分析

| 需求功能 | 代码/资源 | 配置与数据 | 测试 | 文档 | 目标环境 |
| --- | --- | --- | --- | --- | --- |
| FNOS-045-01 | `apps/fn-deepseek-harness/manifest`、新增 `apps/fn-deepseek-harness/i18n/*` | 九份语言文件 | 键集合一致性检查脚本 + 构建产物核对 | 本计划、[Manifest 清单配置](/development/manifest) | 应用中心 |
| FNOS-045-02 | `apps/fn-deepseek-harness/app/ui/config` | 同上 | 同上 | [应用结构](/development/app-structure) | 桌面入口 |
| FNOS-045-03 | `apps/fn-deepseek-harness/wizard/{install,upgrade,config,uninstall}` | 同上 | 占位符覆盖率检查 + 字段名不变断言 | [向导](/development/wizard) | 安装/升级/配置/卸载 |
| FNOS-045-04 | `plugins/*/src/client/locales.<locale>.ts`（新增）、`src/client/index.tsx`（注册）、`src/client/locale-pack.ts`（新增共享形状） | 六个插件 × 七种新语言 | 键集合一致性单测 + 注册用例 | [插件开发](/development/plugin-development) | DSH Web |
| FNOS-045-05 | `plugins/dsh-fnos-plugin/src/client/`：语言同步模块 | 飞牛 SDK 语言事件 | 用桩 SDK 驱动：初始化、语言变化、关闭开关、未知语言 | [本地 DSH Web](/development/local-dsh-web) | 飞牛内嵌页面 |

## 技术方案

### 应用包：i18n 目录与占位符

- 新增 `apps/fn-deepseek-harness/i18n/{en-US,zh-CN,ja-JP,ko-KR,de-DE,fr-FR,es-ES,it-IT,ru-RU}`，INI 语法，section 固定为 `[common]`（manifest 三字段）、`[entry]`（入口）、`[install]`、`[upgrade]`、`[config]`、`[uninstall]`（四个向导）。
- 中文文案取自现有硬编码文本，是其他语言的语义基准；英语为必需基线。
- `manifest` 的 `desc` / `changelog` 是富文本（HTML），占位符替换后仍按 HTML 渲染，语言文件里需要保留标签。
- 向导里 `rules[].message` 属用户可见文本，一并占位符化；`rules[].pattern`、`field`、`initValue` 保持原样。
- 新增仓库内校验：九份语言文件 section/key 完全一致、向导与入口文件中不再有未占位符化的用户可见中文、占位符引用的 key 在每份语言文件里都存在。校验放在 CLI 的 `check` 子命令或独立单测中，保证 CI 可跑。

### 插件：语言包形状

每个插件新增 `src/client/locale-pack.ts`，导出统一形状：

```ts
/** 语言包：id 用 BCP 47 主标签，label 用该语言自称，fallback 固定英文。 */
export const PLUGIN_LANGUAGES = [
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'it', label: 'Italiano' },
  { id: 'ru', label: 'Русский' },
] as const
```

注册顺序与容错：

1. 先读 `ctx.locale.getLocale().locales`，已存在同名 id 就不再 `addLanguage`（重复注册会抛错，且六个插件都可能先加载）。
2. 每种语言用单语言非类型化形式注册自己的命名空间：`ctx.locale.register(NS, locale, dict)`。
3. 所有注册都通过 `ctx.effect(...)` 持有，插件卸载时自动回收。

类型上保持现有 `zh` / `en` 的类型化注册不变（保证键集合由编译器约束），新语言文件以 `LocaleDict`（`Record<string, string>`）声明，并用单测断言其键集合与 `zh` 完全一致。

### 插件：语言同步（飞牛 → DSH）

在 `dsh-fnos-plugin` 客户端新增语言同步模块，复用现有 `theme-bridge` 的 SDK 接入方式：

1. `sdk.getPlatformConfig()` 取当前 `language`（如 `zh-CN`、`ja-JP`）；按主标签映射到 DSH 语言 id。
2. 映射到支持列表之外的语言时回退 `en`，不报错。
3. `await sdk.$on('os/language', handler)` 订阅变化，每次变化重新映射并 `ctx.locale.setLocale(id)`。
4. 只在两种时机切换：启动对齐一次 + `os/language` 变化时；不提供关闭开关，避免与 DSH 设置里的语言选择形成两个来源。
5. 只在飞牛 Web 宿主内启用（与 `theme-bridge` 一致：`!sdk.isWeb || sdk.isStandaloneWeb` 时跳过），独立浏览器页面不受影响。

## 分阶段任务

| 任务 ID | 对应需求/验收 | 修改内容 | 前置 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-045-T01-01 | FNOS-045-01、02、03 | 抽出现有中文文案，建立 `[common]`/`[entry]`/四个向导 section 的 key 清单 | 无 | 清单与占位符一一对应 |
| PLAN-FNOS-045-T01-02 | FNOS-045-01、02、03 | 新建九份 `i18n/<locale>` 语言文件 | T01-01 | 键集合一致性校验通过 |
| PLAN-FNOS-045-T01-03 | FNOS-045-01、02、03 | `manifest`、`app/ui/config`、四个 wizard 文件改为占位符 | T01-02 | 校验脚本 + 实跑构建核对 FPK 内 `i18n/` |
| PLAN-FNOS-045-T02-01 | FNOS-045-04 | 插件统一 `locale-pack.ts` 形状与注册函数（含「已存在则跳过」判断） | 无 | 单测：重复调用不抛错 |
| PLAN-FNOS-045-T02-02 | FNOS-045-04 | 六个插件各新增七份语言字典文件 | T02-01 | 键集合与 `zh` 一致 |
| PLAN-FNOS-045-T02-03 | FNOS-045-04 | 六个插件 `index.tsx` 接线：`addLanguage` + 单语言 `register` | T02-02 | 注册用例 + 类型检查 |
| PLAN-FNOS-045-T03-01 | FNOS-045-05 | 飞牛插件新增语言同步模块，接 `getPlatformConfig` 与 `os/language` | T02-01 | 桩 SDK 单测：初始化/变化/回退/跳过非 Web 宿主 |
| PLAN-FNOS-045-T04-01 | 全部 | 文档：需求/计划/测试、索引与侧栏、相关开发文档 | T01~T03 | `check --sdd`、docs 构建 |
| PLAN-FNOS-045-T04-02 | 全部 | 全量检查、实跑构建核对 FPK 内 i18n 目录 | T04-01 | `check --all`、`fnpack` 产物核对 |

任务依赖：T01 与 T02 可并行；T03 依赖 T02-01；T04 收口。

## 数据、权限和错误处理

- **不改变收集的数据**：向导字段名、默认值、校验正则、环境变量名一律不动，只替换展示文本。升级路径上既有配置照旧读取。
- **同步不阻断启动**：SDK 不可用或语言服务异常时只记录调试日志，不影响 DSH 启动与其它功能。
- **语言文件缺失或损坏**：平台会回退到 `en-US`；构建期校验保证仓库里九份文件齐全且键一致，不让残缺包流出去。
- **未知语言**：fnOS 返回的语言若不在映射表内，同步逻辑回退 `en`，不抛错、不写偏好。
- **重复注册**：`addLanguage` 对已占用 id 会抛错，接线前必须查询现有语言列表；六个插件共用同一批语言 id，谁先加载都可能，因此每个插件都要做存在性判断。
- **插件卸载**：所有语言与字典注册都用 `ctx.effect` 包裹，卸载时回收；语言定义被回收后 DSH 回退到可用语言，不会卡在空界面。

## 依赖、风险和决策

| 决策 | 选择 | 否决方案 | 原因 |
| --- | --- | --- | --- |
| DSH 本体文案 | 不翻译，保持上游中英 | 在本插件里为上游命名空间补翻译 | 上游界面词条量大且随版本变动，维护成本与回归风险远超收益；缺翻译时回退英文仍可用 |
| 语言 id | 用主标签 `ja`/`ko`/`de`/… | 用 `ja-JP` 全标签 | DSH 内置为 `zh`/`en` 主标签形式，映射规则简单一致；fnOS 侧再用 `xx-YY` 映射 |
| 字典文件组织 | 每种语言一个文件 | 全部塞进 `locales.ts` | 单文件会膨胀到数千行，多人并行翻译时冲突严重 |
| 是否提供同步开关 | 不提供，固定跟随飞牛语言 | 增加「跟随飞牛界面语言」开关 | 飞牛内嵌页面里 DSH 的语言来源本就该是飞牛语言；再加一个开关会让「界面语言由谁决定」出现两个来源，且开关自身还要多语言。用户仍可在 DSH 里临时改语言 |
| 同步写入方式 | 复用 `setLocale`（会持久化） | 只改内存态 | 没有公开的「临时切换」入口；持久化让下次启动仍一致，符合「同步」语义 |

**风险**：各语言文件键集合漂移是这类改动最常见的退化方式，因此校验以「键集合完全相等」为判定，而不是「能跑起来」。翻译质量无法自动化验证，只能靠人工抽查与后续反馈。

## 测试、打包、发布和回滚

- **包级**：CLI 全量单测 + 新增的语言包键集合用例 + 语言同步桩用例。
- **构建**：本地 `pnpm run build -- --fpk --app fn-deepseek-harness --skip-bundle-dsh-plugins --platform x86` 后解包确认 `i18n/` 与九份语言文件在包内，且 `manifest` 内是占位符。
- **文档**：`pnpm run check -- --sdd` 与 `docs` 构建。
- **真机**：切换 fnOS 界面语言后看应用中心文案、安装向导、DSH 插件文案与语言是否跟随；本轮无 fnOS 设备，登记为待验证。
- **发布**：新功能，按通道规则推进 minor。
- **回滚**：删除 `i18n/` 目录并把 `manifest`、`app/ui/config`、四个向导文件恢复为硬编码文本，插件侧移除语言注册接线，同步模块停用即可回到中英两种语言。

用例与结果回填到 [FNOS-045 测试用例文档](/tests/FNOS-045-app-plugin-i18n)。

## 完成状态

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| T01 应用包本地化 | 已完成 | 九份 `i18n/<locale>`（46 键 × 9 + 六 section），`manifest` 三字段与入口标题占位符化，四个向导全部文本占位符化；`check --i18n` 通过，构建产物含 9 个语言文件 |
| T02 插件语言包 | 已完成 | 六个插件各七份字典（42 个文件），`language-pack.ts` 统一注册，`index` 接线完成，`tsc` 与插件测试全绿 |
| T03 语言同步 | 已完成 | `language-sync.ts`：`getPlatformConfig` + `$on('os/language')` + `setLocale`，未注册语言与未知语言均安全回退；15 条单测 |
| T04 文档与验证 | 已完成 | 需求/计划/用例三份 + 三处索引与侧栏 + [真机验收记录](/validation/FNOS-045-nas-2026-11-05)；`check --sdd`、`check --i18n`、`check --all` 与 docs 构建通过；真机验收通过（x86_64，九种语言） |

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-11-04 | 初始登记 | 建立 PLAN-FNOS-045：应用侧走 fnOS 包内 `i18n/` 与占位符，插件侧走 DSH 语言包注册，联动走飞牛 JS SDK 的 `getPlatformConfig` 与 `os/language`。核实了四处平台事实（应用 i18n 目录、SDK 语言接口、DSH 语言包 API、`setLocale` 语义），并据此确定语言 id 用主标签、字典一语言一文件、同步默认开启但可关闭。 |
