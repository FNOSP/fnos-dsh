---
id: PLAN-FNOS-049
title: PLAN-FNOS-049 把 Codex Auth 与 Failover Search 移出 FPK 内置清单
description: 移除两个插件内置的实施计划：清单与白名单改动、文档同步、升级行为确认与验证方式。
status: in-review
owner: tnnevol
planDate: 2026-11-06
targetVersion: 8.1.4
lastVerified: 2026-11-06
---

# PLAN-FNOS-049 把 Codex Auth 与 Failover Search 移出 FPK 内置清单

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-049 |
| 计划日期 | 2026-11-06 |
| 对应需求 | [FNOS-049 把 Codex Auth 与 Failover Search 移出 FPK 内置清单](/requirements/FNOS-049-unbundle-plugins) |
| 计划状态 | 待验收 |

## 计划目标

按 [FNOS-049](/requirements/FNOS-049-unbundle-plugins) 的四个功能编号把两个插件移出 FPK 内置清单，同时保证它们仍可安装、老用户升级不受影响、构建门禁与清单保持一致。

技术边界：只改发布清单、内置白名单、基线测试与应用文档；不改两个插件源码，不改它们发布到 npm 的行为，不改插件市场索引的插件集合。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 影响 |
| --- | --- | --- | --- |
| 发布清单 | `dsh-codex-auth`、`dsh-fnos`、`dsh-failover-search`、三方 `dshmarket` | 只留 `dsh-fnos` 与 `dshmarket` | FPK 安装只自动准备这两个 |
| 必含白名单 | `dsh-codex-auth`、`dsh-fnos` | 只有 `dsh-fnos` | 少一个必含校验 |
| 可选白名单 | `dsh-failover-search` | 空数组 | 清单里出现未登记插件时构建报错 |
| 内置归档 | 构建期把两个插件 `pnpm pack` 进 FPK | 不再打包 | FPK 体积与安装时长下降 |
| 基线测试 | 断言清单为 4 项、Codex 与 fnos 版本对齐源码 | 断言清单为 2 项、只有 fnos 对齐源码 | 门禁与清单同步 |
| 应用文档 | 「内置插件」表列三个 | 只列 fnOS；另设「不随应用内置」表并给安装命令 | 用户知道去哪里装 |

## 为什么现在可以移除

内置 Codex Auth 的唯一技术理由是：其 registry 版本在 DSH `0.2.0-rc.2` 上会因 `@deepseek-ai/dsh-settings` 不再导出 `settingsNamespace` 而使 DSH Web 启动失败。已核实两个插件源码中**均无** `settingsNamespace` 引用，该依赖不复存在，从 registry 安装不会破坏启动。

## 实施任务

| 编号 | 任务 | 对应功能 | 写入范围 |
| --- | --- | --- | --- |
| T1 | 发布清单移除两项 | FNOS-049-01 | `apps/fn-deepseek-harness/app/published-dsh-plugins.json` |
| T2 | 白名单收敛（必含只留 fnos，可选清空） | FNOS-049-01、04 | `tooling/fnos-dsh-cli/src/commands/build.ts` |
| T3 | 基线测试跟随清单 | FNOS-049-04 | `tooling/fnos-dsh-cli/tests/fnos-007-baseline.spec.ts` |
| T4 | 应用文档与结构文档同步 | FNOS-049-02、03 | `docs/apps/fn-deepseek-harness.md`、`docs/development/app-structure.md` |
| T5 | 需求/计划/用例文档与索引登记 | 全部 | `docs/` |

## 风险与回滚

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 老用户升级后被卸载 | 凭据与配置丢失 | 安装回调只处理清单内的插件，清单外插件既不安装也不卸载；以既有用例与升级路径核对 |
| 用户找不到插件 | 认为功能消失 | 应用文档给出「不随应用内置」表与逐条安装命令；插件市场索引保持不变 |
| 清单改了白名单没改 | 构建失败 | 构建期校验会点名报出未登记的内置插件，属预期失败而非静默 |
| 未来需要重新内置 | 回滚成本 | 把条目加回清单**并**在 `FPK_OPTIONAL_BUNDLED_PLUGIN_NAMES` 登记即可，两步都做才通过构建 |

回滚：把两个条目加回 `published-dsh-plugins.json`，并在 `FPK_REQUIRED_BUNDLED_PLUGIN_NAMES` 或 `FPK_OPTIONAL_BUNDLED_PLUGIN_NAMES` 登记；基线测试的条目数断言随之改回。

## 验证计划

| 层次 | 方式 |
| --- | --- |
| 单元 | `pnpm --filter @tnnevol/fnos-dsh-cli run test`、`pnpm --filter @tnnevol/fnos-gateway run test` |
| 构建 | 构建 FPK，核对产物内 `published-dsh-plugins.json` 与 `bundled-dsh-plugins/` 只剩 fnos |
| 发布 | 核对两个插件仍在 registry 与插件市场索引中 |
| 升级 | 已有安装的 profile 升级后插件与凭据保留（真机或本地 profile 复现） |
