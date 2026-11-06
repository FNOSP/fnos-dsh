---
id: FNOS-049
title: FNOS-049 把 Codex Auth 与 Failover Search 移出 FPK 内置清单
description: 把 @tnnevol/dsh-codex-auth 与 @tnnevol/dsh-failover-search 从 FPK 内置插件清单中移除，改为由用户从插件市场自行安装；两者继续发布到 npm。
status: in-review
owner: tnnevol
targetVersion: 8.1.4
lastVerified: 2026-11-06
---

# FNOS-049 把 Codex Auth 与 Failover Search 移出 FPK 内置清单

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-049 |
| 提出日期 | 2026-11-06 |
| 需求状态 | 待验收 |
| 关联计划 | [PLAN-FNOS-049 移出 FPK 内置清单](/plans/PLAN-FNOS-049-unbundle-plugins) |
| 适用范围 | `apps/fn-deepseek-harness/app/published-dsh-plugins.json`、`tooling/fnos-dsh-cli` 的内置白名单与基线测试、应用文档 |
| 明确排除 | 两个插件自身的源码与功能；它们继续发布到 npm，也仍出现在插件市场索引中 |

## 需求背景

`@tnnevol/dsh-codex-auth` 与 `@tnnevol/dsh-failover-search` 目前随 FPK 内置，安装应用时自动装进 Web profile。当初内置 Codex Auth 有明确的技术原因：其 registry 版本在 DSH `0.2.0-rc.2` 上会因 `@deepseek-ai/dsh-settings` 不再导出 `settingsNamespace` 而使 DSH Web 启动失败，只能靠「随包内置特定版本」绕过。

该依赖现已不存在（两个插件源码中均无 `settingsNamespace` 引用），内置的技术前提消失。同时内置带来两个持续成本：

- 每个随包插件都会增加 FPK 体积与安装时长，且其版本必须与 npm 上已发布版本严格对齐，漏发即导致整次安装失败。
- 用户无法按需选择：不需要 ChatGPT 登录或三方搜索的用户也会被装上这两个插件。

## 需求目标

| 编号 | 功能 | 用户可观察结果 |
| --- | --- | --- |
| FNOS-049-01 | 移出内置清单 | 新装应用后 Web profile 里只自动包含 `dsh-fnos` 与 `dshmarket` |
| FNOS-049-02 | 保留可安装性 | 两个插件仍在 npm 发布、仍在插件市场索引中，用户可从「插件 → 发现」安装 |
| FNOS-049-03 | 升级不误动 | 已装过这两个插件的老用户升级后，插件、凭据与配置均保留 |
| FNOS-049-04 | 构建门禁一致 | 内置白名单与发布清单一致；把插件重新加回清单时构建会报错点名 |

### FNOS-049-01 移出内置清单

`published-dsh-plugins.json` 只保留 `@tnnevol/dsh-fnos` 与三方 `dshmarket`；`FPK_REQUIRED_BUNDLED_PLUGIN_NAMES` 只剩 `dsh-fnos`，`FPK_OPTIONAL_BUNDLED_PLUGIN_NAMES` 清空。

### FNOS-049-02 保留可安装性

移除的是「随 FPK 内置」，不是「发布」。两个插件照常执行 `pnpm run publish`、照常进入插件市场索引，用户可自助安装。

### FNOS-049-03 升级不误动

安装回调只处理清单内的插件：清单里没有的插件不会被安装、也不会被卸载。老用户已装的 Codex Auth / Failover Search 及其 `.openai-codex-auth.json` 凭据、Failover 的账号配置与 profile bundle 保持不变。

### FNOS-049-04 构建门禁一致

白名单与清单必须同步：若清单里出现未登记的内置插件，构建期报错并点名，避免「清单被改、白名单没改」的半改状态。

## 验收条件

| 编号 | 验收条件 | 判定方式 |
| --- | --- | --- |
| [AC-01](/requirements/FNOS-049-unbundle-plugins#fnos-049-01-移出内置清单) | 清单只含 fnos 与 dshmarket；两个白名单常量如预期 | `tests/fnos-007-baseline.spec.ts` |
| [AC-02](/requirements/FNOS-049-unbundle-plugins#fnos-049-02-保留可安装性) | 两插件仍在 npm 与市场索引中 | registry 查询 + 索引文件核对 |
| [AC-03](/requirements/FNOS-049-unbundle-plugins#fnos-049-03-升级不误动) | 安装回调不会卸载清单外插件 | `bundled-plugin-install.spec.ts` 既有用例 |
| [AC-04](/requirements/FNOS-049-unbundle-plugins#fnos-049-04-构建门禁一致) | 清单含未登记插件时构建失败 | 构建校验逻辑与 CLI 测试 |

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-06 | 建立需求并实现：两个插件移出 FPK 内置清单，保留 npm 发布与市场索引，同步文档与基线测试 |
