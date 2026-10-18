---
id: PLAN-FNOS-017
title: PLAN-FNOS-017 fnOS 插件路由 403 误拒修复
description: 实施 FNOS-017：把 fnOS 插件的同源判定收敛到网关实际转发的权威（host），不再让外部可注入的 x-forwarded-host 参与比较；补齐三类场景的回归用例，并在真实 fnOS NAS 远程访问下验收。
status: planned
owner: tnnevol
planDate: 2026-10-18
targetVersion: 5.9.0
lastVerified: 2026-10-18
---

# PLAN-FNOS-017 fnOS 插件路由 403 误拒修复

| 字段 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-017 |
| 计划日期 | 2026-10-18 |
| 对应需求 | [FNOS-017 fnOS 插件路由 403 误拒修复](/requirements/FNOS-017-fnos-route-403) |
| 本轮功能 | FNOS-017-01 至 FNOS-017-04 |
| 计划状态 | <Badge type="warning" text="阶段一完成；真机验收待执行" /> |

## 计划目标

让 fnOS 插件的同源判定只依赖「网关实际转发的那一套头」，消除远程域名访问下的 403 误拒，同时保持跨站拒绝强度不变。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| 请求权威来源 | `requestOrigin` 优先取 `x-forwarded-host`，其次 `host` | **只取 `host`**（网关写入的权威）；`x-forwarded-*` 不参与同源比较 | 无：网关始终会写 `host` |
| 协议来源 | `x-forwarded-proto` → socket 加密状态 | socket 加密状态 → 常量 `http`（网关到插件是 loopback 明文） | 无：第二跳恒为明文 |
| 跨站信号 | `sec-fetch-site: cross-site` 直接拒绝 | 不变 | 无 |
| 无 origin 兜底 | `localPeer(req)` | 不变 | 无 |
| 测试覆盖 | 仅 loopback 直通与路由封装 | 增加转发头同源、伪造 Origin、cross-site、非回环无 origin 四类 | 需新增用例 |

### 为什么不是「多信任一种来源」

另一种看似更省事的写法是：只要 `x-forwarded-host` 与 `Origin` 一致就放行。这会让**任何能设置该头的中间层**获得放行能力——而该头在本仓库内零写入（网关不设），完全来自外部。等于把同源校验交给请求方自证，属于安全倒退。

正确方向是让两侧都读同一个权威：网关已经把 `host` 改写成 loopback，插件的 `requestOrigin` 也应只认它，二者自然相等。这也符合网关代码里写明的设计意图——「translate a normal Origin to the same authority so strict same-origin plugin endpoints remain valid」。

## 影响范围分析

| 需求功能 | 代码模块 | 配置/数据 | 测试 | 文档 | 目标环境 |
| --- | --- | --- | --- | --- | --- |
| FNOS-017-01 | `plugins/dsh-fnos-plugin/src/host/authorized-directories.ts` 的 `requestOrigin` | 无 | 转发头同源用例 | 排错文档补 403 排查 | 真实 fnOS NAS 远程 |
| FNOS-017-02 | 同上（保持拒绝分支） | 无 | 三类拒绝用例 | — | 本地构测 |
| FNOS-017-03 | — | 无 | 新增 4 条用例 | — | 本地构测 |
| FNOS-017-04 | 同上 | 无 | loopback 沿用既有用例 | — | DSH Web 内网 |

不涉及：网关转发头行为、DSH 宿主路由框架、授权目录 ACL 与路径校验、其它插件。

## 分阶段任务

### 阶段一：修复与本地验证

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-017-T01-01 | FNOS-017-01 / AC-01 | `requestOrigin` 只用 `host` 构造权威，协议取 socket 加密状态（第二跳恒明文）；保留对 `x-forwarded-*` 的**忽略**并写明原因 | 无 | 仿真脚本：带 `x-forwarded-host` 时判定由 403 变通过 |
| PLAN-FNOS-017-T01-02 | FNOS-017-02 / AC-01～AC-03 | 三处拒绝分支保持不变并补注释，说明各自拦截的攻击面 | T01-01 | 三类拒绝用例全绿 |
| PLAN-FNOS-017-T01-03 | FNOS-017-03 / AC-01、AC-02 | 新增用例：带 `x-forwarded-*` 的同源请求放行、外部 Origin 拒绝、cross-site 拒绝、非回环无 origin 拒绝 | T01-01 | 用例在修复前失败、修复后通过（逐条确认） |
| PLAN-FNOS-017-T01-04 | FNOS-017-04 / AC-01 | 核对内网直连路径未受影响（既有用例 + loopback 直通断言） | T01-01 | 插件全部用例绿 |

### 阶段二：目标环境验收

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-017-T02-01 | FNOS-017-01 / AC-01～AC-03 | 真实 fnOS NAS 经 `https://<设备>.fnos.net` 远程访问，验证授权目录、`/fn` 引用与插件详情页 | 发布新版本并安装到设备 | 接口返回 200 + 界面走查；证据登记 `docs/validation/` |
| PLAN-FNOS-017-T02-02 | FNOS-017-04 / AC-01 | 同设备内网直连对照组 | T02-01 | 行为与修复前一致 |

## 数据、权限和错误处理

- 本次只改「如何判断请求可信」，不改变任何数据读写路径与权限语义。
- 拒绝分支保留精确错误码 `remote-web-origin-not-trusted`，便于排错时区分「被判定为跨站」与「路由内部失败」。
- 若修复后仍出现 403，说明是另外两种预期拒绝（cross-site 或非回环无 origin），可据错误码与请求头直接定位。

## 依赖、风险和决策

### 已决定事项

1. **不信任 `x-forwarded-*`**：本仓库零写入该头，它属外部输入；信任它等于让请求方自证同源。
2. **不做「两者取其一即可」的宽松判定**：那会同时引入两种放行路径，攻击面翻倍。
3. **不动网关**：网关改写 origin 的行为是刻意设计（注释已写明），缺陷在插件侧的取值优先级。
4. **保留 `sec-fetch-site` 直接拒绝**：它由浏览器设置、不可被脚本伪造，是比 Origin 更强的信号。

### 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 某些部署下网关不写 `host` | 判定退化为无权威，可能 403 或走 localPeer | 网关代码恒定设置 `host`；补一条「host 缺失时回退 localPeer」的用例 |
| 平台侧另有反代直接打到 8787（不经网关） | 该路径下 origin 未被改写，可能仍不一致 | 属部署差异；本次按「经网关」的标准链路修复，其它链路另议 |
| 修复被误读为「放宽同源」 | 后续维护者照此扩大信任 | 需求与代码注释都写明「收敛来源」而非「新增信任」 |

### 回退方案

单文件函数级回退，恢复 `x-forwarded-host` 优先后行为即回到缺陷态；无数据迁移、无配置变更。

## 测试、打包、发布和回滚

- **本地**：插件 `check`（typecheck + 单测），四类新增用例 + 既有 230 条用例。
- **发布**：补丁版本发布 `@tnnevol/dsh-fnos`，同步 `published-dsh-plugins.json` 与文档安装命令。
- **目标环境**：真实 fnOS NAS 远程访问验收，登记 `docs/validation/`。
- **回滚**：见上节。

## 参考资料

- 插件判定实现：`plugins/dsh-fnos-plugin/src/host/authorized-directories.ts`
- 网关头改写：`packages/fnos-gateway/src/middleware/request-headers.ts`
- 既有用例：`plugins/dsh-fnos-plugin/tests/host/authorized-directories-persist-route.spec.ts`
- 相关需求：[FNOS-001](/requirements/FNOS-001-dsh-fnos-adaptation)、[FNOS-008](/requirements/FNOS-008-plugin-config-in-plugin-manager)（授权目录与 `/fn` 引用能力来源）

## 完成状态

| 阶段 | 任务 | 状态 |
| --- | --- | --- |
| 一：修复与本地验证 | T01-01～T01-04 | <Badge type="tip" text="已完成" /> |
| 二：目标环境验收 | T02-01～T02-02 | <Badge type="info" text="规划中" /> |

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-18 | 初始登记 | 建立 PLAN-FNOS-017，两阶段 6 个任务。已写明「收敛来源而非新增信任」的方向选择与三种替代方案的否决理由、平台侧其它链路的边界、以及「host 缺失」的兜底用例要求。 |
