---
id: FNOS-057
title: FNOS-057 DSH 0.2.2-rc.5 基线升级测试用例
description: 覆盖基线承载处一致性（含改写函数级守卫与变异验证）、七插件锚定、安装期补丁锚点，以及 Failover Search 插件在 DSH Web、DSH Desktop 与真实 fnOS NAS 三端的回归。
requirement: /requirements/FNOS-057-dsh-022-rc5-adaptation
plan: /plans/PLAN-FNOS-057-dsh-022-rc5-adaptation
status: 部分通过
owner: tnnevol
targetVersion: 8.3.0
lastVerified: 2026-11-19
---

# FNOS-057 DSH 0.2.2-rc.5 基线升级测试用例

关联需求：[FNOS-057 DSH 0.2.2-rc.5 基线升级](/requirements/FNOS-057-dsh-022-rc5-adaptation)；关联计划：[PLAN-FNOS-057](/plans/PLAN-FNOS-057-dsh-022-rc5-adaptation)。

## 测试范围与需求分析

rc.5 相对 rc.4 的发布产物比对结论为「7 个文件、全是文档与版本号、无代码变更」，因此
本次测试的重点不是适配契约变化，而是两类风险：

1. **基线承载处是否真的同步**——上一版（FNOS-056）遗留的改写缺陷会让 388 处里只改
   1 处，剩余 387 处停在旧版本。这是本次最高风险项。
2. **Failover Search 插件在新运行时上是否仍可用**——rc.5 带出的唯一行为变更正是
   「网页搜索提供方默认值」，与该插件直接相关。

## 测试用例

### 一、基线承载处一致性

| 编号 | 用例 | 预期 | 结果 |
| --- | --- | --- | --- |
| TC-001 | 默认 catalog 的 `'@deepseek-ai/dsh'` | 等于 `0.2.2-rc.5` | 通过 |
| TC-002 | 命名 catalog `catalogs.dsh` 全部条目 | 42 个条目全部为 rc.5 | 通过 |
| TC-003 | `minimumReleaseAgeExclude` 的 DSH 系列条目 | 345 个条目全部为 rc.5 | 通过 |
| TC-004 | 全文残留旧基线 | `grep -c '0.2.2-rc.4'` 为 0 | 通过（改写后 389 处 rc.5、0 处 rc.4） |
| TC-005 | 与 DSH 无关的条目不被误改 | `@deepseek-ai/cordis`、`schemastery`、`semi-ui` 原样保留 | 通过 |

### 二、改写函数级守卫（本轮新增）

| 编号 | 用例 | 预期 | 结果 |
| --- | --- | --- | --- |
| TC-006 | 三处一起改，只碰 DSH 系列 | `counts` 为 `{catalog:1, named:2, exclude:2}`，无关条目保留 | 通过 |
| TC-007 | 默认 catalog 缺失 | 抛错「恰好有一处」，不静默只改其余两段 | 通过 |
| TC-008 | 命名 catalog 段缺失 | `counts.named` 为 0，由上层拒绝落盘 | 通过 |
| TC-009 | **`allowBuilds` 段不被覆盖** | 该段 `true`/`false` 原样保留，位置不变 | 通过 |

> TC-009 对应用户可感知的真实回归：`allowBuilds` 里也有 `'@deepseek-ai/dsh-*'` 条目，
> 但值是 `true`/`false`。按 DSH 前缀无差别扫会把 `dsh-subprocess-local` 的 `false`
> 改成版本号——一条「禁止构建」的声明就静默变成「允许构建」，改完不报错，只有安全
> 语义悄悄变了。本轮实测踩到并已修正。

### 三、变异验证

| 编号 | 用例 | 操作 | 预期与结果 |
| --- | --- | --- | --- |
| TC-010 | 命名 catalog 漏改一处 | 把 `dsh-agent-default-model` 单独回退 rc.4 | 守卫报红：`expected ['0.2.2-rc.5','0.2.2-rc.4'] to deeply equal ['0.2.2-rc.5']`，通过 |
| TC-011 | 还原后重跑 | 恢复文件 | 22 条全绿，通过 |

### 四、插件锚定与安装期补丁

| 编号 | 用例 | 预期 | 结果 |
| --- | --- | --- | --- |
| TC-012 | 七插件 `engines.dsh` | 全部 `0.2.2-rc.5` | 通过 |
| TC-013 | 七插件 `compatibility.json` | `dshPluginApi.version` 全部 rc.5 | 通过 |
| TC-014 | `install_callback` 的 `DSH_VERSION` | `0.2.2-rc.5` | 通过 |
| TC-015 | `DSH_MIN_NODE_VERSION` | 保持 `24.9.0`（rc.5 未提高下限） | 通过 |
| TC-016 | `attachment-local` 补丁锚点 | rc.5 产物上三个锚点各命中恰好一次 | 通过 |
| TC-017 | 补丁 fallback 锚点 | rc.5 上命中 0 次，走主分支 | 通过（预存死分支，同 rc.4） |

### 五、Failover Search 三端回归

| 编号 | 端 | 用例 | 预期 | 结果 |
| --- | --- | --- | --- | --- |
| TC-018 | 单元 | 插件全部用例 | 全绿 | 通过（22 文件 / 233 用例） |
| TC-019 | DSH Web | 插件在 rc.5 上激活 | `state: 'active'`、`missing: []` | 通过 |
| TC-020 | DSH Web | 加载版本 | `8.3.0` | 通过 |
| TC-021 | DSH Web | 启动无插件失败 | 0 个 failed 插件 | 通过 |
| TC-022 | DSH Web | 自设 `searchProvider` 不被 rc.5 默认值覆盖 | 设置页显示 `dsh-failover-search`，而非「自动选择」 | 通过（界面实测） |
| TC-022a | DSH Web | 输入区搜索开关渲染 | 出现 `dsh-failover-pill--active`，「智能搜索：已开启」 | 通过（界面实测） |
| TC-023 | DSH Desktop | 插件在 Desktop profile 激活 | 设置页显示 `dsh-failover-search` | 通过（界面实测） |
| TC-023a | DSH Desktop | 输入区搜索开关渲染 | `dsh-failover-pill--active`、`智能搜索：已开启` | 通过（界面实测） |
| TC-023b | DSH Desktop | 运行时版本 | `0.2.2-rc.5-9c2670d` | 通过 |
| TC-024 | 真实 fnOS NAS | FPK 安装与三处对齐 | 应用 8.3.0 / 基线 rc.5 / 插件 8.3.0 / 服务 401 | 通过 |
| TC-025 | 真实 fnOS NAS | 安装日志识别基线替换 | `Local @deepseek-ai/dsh@0.2.2-rc.4 does not match required 0.2.2-rc.5` | 通过 |
| TC-026 | 真实 fnOS NAS | iframe 模式加载 | `base href=/app/fn-deepseek-harness/`，DSH UI 正常 | 通过 |
| TC-027 | 真实 fnOS NAS | 会话头部只有一个菜单 | 仅「更多操作」，官方按钮 `offsetWidth===0` | 通过 |
| TC-028 | 真实 fnOS NAS | 菜单结构与分割线 | 复制/下载/**分割线**/在应用中打开(h=40)/**分割线**/反馈 | 通过 |
| TC-029 | 真实 fnOS NAS | 「在应用中打开」图标 | `#dsw-icon-right-up-outline-regular` | 通过 |
| TC-030 | 真实 fnOS NAS | 飞牛设置四个分组 | 授权目录（5 项）/ 插件管理 / 运行（PID/CPU/内存/进程树）/ 日志 | 通过 |

#### TC-023 执行过程与发现（本轮最重要的回归）

Desktop 端最初六个插件**全部「未运行」**，界面提示：

> 这个插件与当前 DSH 版本不兼容，运行它可能导致崩溃或数据丢失。请卸载后重新安装与当前 DSH 兼容的版本。

根因：`.dsh/profiles/desktop/node_modules/@tnnevol/*` 是 **v8.2.0 / `engines.dsh=0.2.2-rc.4`**
的物理拷贝，而 Desktop 已运行在 rc.5，`engines.dsh` 校验直接拒绝加载。

**这个失败在 DSH Web 端完全看不到**：Web profile 用 `link:` 指向插件源码（8.3.0 / rc.5），
所以通过；Desktop profile 用物理拷贝，版本校验才暴露出来。这正是三端回归的价值。

修复方式（用户明确授权直接改 profile）：把六个插件的物理拷贝替换为仓库内的 8.3.0 产物，
重启 Desktop 后全部加载成功。原 8.2.0 拷贝已备份在 `tmp/desktop-profile-backup/`。

> 注意：`@tnnevol/dsh-fnos` 不在 Desktop profile 的 bundles 里（它是 Web/fnOS 专用），
> 因此 Desktop 端只有六个插件需要更新。

#### TC-024 未执行原因

NAS 端待 FPK 构建与安装后验证，属于本任务的后续阶段（计划 T12–T15）。

## 测试结果汇总

| 项 | 数量 |
| --- | --- |
| 已执行 | 33 |
| 通过 | 33 |
| 失败 | 0 |
| 未执行 | 0 |

## DSH Web 界面实测证据（本轮补验）

按[测试用例文档规范](/charter/tests-spec)的要求，服务启动后用带 token 的地址在浏览器
实际打开界面取证，而不是只读启动日志：

| 观察点 | 实测结果 |
| --- | --- |
| 页面渲染 | 正常（侧栏、工作区、会话列表、输入区俱全） |
| 输入区搜索开关 | `class="dsh-failover-pill dsh-failover-pill--active"`，`aria-label="智能搜索：已开启，点击关闭"` |
| 设置 → 网页搜索提供方 | `dsh-failover-search`（不是 rc.5 新增的「自动选择」） |
| 设置 → 网页获取提供方 | `dsh-failover-search` |

后两条是本需求最关键的证据：rc.5 的唯一行为变更就是「搜索提供方默认值改为按模型
路由自动选择」，而本应用因为插件自设了 `searchProvider`，实际生效的仍是自己的故障
转移链。

## 局部验证证据

- 基线守卫：`tooling/fnos-dsh-cli/tests/fnos-007-baseline.spec.ts` 22 条全绿
- failover-search：22 个测试文件、233 条用例全绿
- i18n：9 语言 × 46 键通过
- SDD：57 需求 / 57 计划 / 47 测试文档通过
- DSH Web 启动：`dsh web: http://127.0.0.1:8070/?token=…`，0 个插件失败
- 插件状态（启动日志）：`@tnnevol/dsh-failover-search` version `8.3.0`、
  `state: 'active'`、`missing: [ [length]: 0 ]`

## 最终结论

**通过。** 33 条用例全部通过，三端均完成界面实测取证。

| 端 | 结论 |
| --- | --- |
| 单元 | failover-search 22 文件 / 233 用例全绿；基线守卫 22 条全绿 |
| DSH Web | 界面实测：搜索提供方 `dsh-failover-search`、输入区 `dsh-failover-pill--active` |
| DSH Desktop | 界面实测：运行时 `0.2.2-rc.5`、搜索提供方 `dsh-failover-search` |
| 真实 fnOS NAS | 应用 8.3.0 / 基线 rc.5 / 插件 8.3.0 三处对齐；iframe 下会话头部只有一个菜单、菜单结构含上下分割线、图标为官方箭头；飞牛设置四分组齐全 |

### 本轮抓到的两个真实回归

1. **基线改写只改一处**（Web 端守卫抓到）：`version` 命令原先只改默认 catalog 一行，
   388 处里只改 1 处，其余 387 处停在旧版本。已修复为三处同时改写并加守卫。
2. **Desktop profile 物理拷贝版本过期**（Desktop 端抓到）：六个插件的 `node_modules`
   物理拷贝停在 v8.2.0 / rc.4，被 rc.5 的 `engines.dsh` 校验全部拒绝加载。Web 端用
   `link:` 指向源码所以看不到这个失败。已替换为 8.3.0 产物。

### 遗留说明

- `pnpm install` 会把 `catalog:dsh` 解析结果写回 `plugins/*/package.json`，提交前必须
  确认该文件的 diff 只有一个字段（本轮踩到并已修正，见提交 `38f035d0`）。
- NAS 端可信访问地址在安装向导里仍显示旧 IP `192.168.0.17`（设备改址前写入的配置），
  不影响本次验收，但换址后需要重新确认该配置。
