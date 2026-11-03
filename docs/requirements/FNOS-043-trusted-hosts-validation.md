---
id: FNOS-043
title: FNOS-043 可信访问地址的校验与错误透出
description: 向导层用与 DSH 一致的正则拦住带协议头/路径的「可信访问地址」；安装回调校验失败即中止安装；启动脚本把非法值与原因写进应用日志，避免只显示「DSH Web exited with code 1」。
status: in-progress
owner: tnnevol
targetVersion: 7.0.15
lastVerified: 2026-11-03
---

# FNOS-043 可信访问地址的校验与错误透出

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-043 |
| 提出日期 | 2026-11-03（来自 issue #30） |
| 需求状态 | 实施中（包级用例通过；真实 NAS 验收待执行） |
| 关联计划 | [PLAN-FNOS-043 可信访问地址的校验与错误透出](/plans/PLAN-FNOS-043-trusted-hosts-validation) |
| 适用范围 | 安装向导（`wizard/config`）、安装回调（`cmd/install_callback`）、启动脚本（`cmd/main`）、安装帮助器（`packages/fnos-gateway`） |

## 需求背景

issue #30：全新安装在向导「可信访问地址」里填 `http://192.168.1.112`，安装成功，但打开应用只有网关错误页「**DSH Web exited with code 1**，请确认 Node.js v24 等依赖已安装」。重启无效，`127.0.0.1:3080` 始终没有监听。

真实原因是 DSH 的 `client-connection` 对 `trustedHosts` 做严格校验（只接受裸 `host[:port]`），而 `connection` 是 required 插件——它加载失败导致 `dsh web` 直接退出。用户看到的错误信息指向「Node.js 依赖」，与真因无关；该字段只在安装时填写，应用中心里没有编辑入口，用户只能卸载重装，而重装按同样填法会再踩一次。

提出人要求按「方案 1」修：**向导层拦截 + 增加错误日志输出 + 安装回调校验失败即阻止安装**，不做静默改写。

## 调研结论

| 结论 | 出处 | 影响的功能 | 状态 |
| --- | --- | --- | --- |
| 旧向导正则 `^(?:[^,\s]+(?:,[^,\s]+)*)?$` 只挡逗号与空白，`http://IP`、`IP/`、`IP:5666/` 都能通过 | `apps/fn-deepseek-harness/wizard/config`（改动前） | FNOS-043-01 | 已核实 |
| DSH 接受的是**规范化裸 authority**：`host`、`host:port`、方括号 IPv6；拒绝 scheme、路径、`user@`、空白、悬空冒号、补零端口、裸 IPv6 | `@deepseek-ai/dsh-client-connection` 的 `assertTrustedAuthority` 与 `parseAuthority`（随 DSH 0.2.1-rc.5 分发） | FNOS-043-01、02 | 已核实 |
| `cmd/main` 原样透传 `wizard_trusted_hosts` 到 `DSH_TRUSTED_HOSTS`，网关只把退出码报成「DSH Web exited with code 1」 | `cmd/main`、`packages/fnos-gateway/src/server/web-process.ts` | FNOS-043-02、03 | 已核实 |
| 安装回调能读到 `wizard_trusted_hosts`（已在现有逻辑中使用），且 `fail_install` 会写入 `TRIM_TEMP_LOGFILE` 并 `exit 1`，可用于中止安装 | `cmd/install_callback` | FNOS-043-02 | 已核实 |
| 安装帮助器产物 `app/scripts/install-callback-helper.mjs` 由 `packages/fnos-gateway/tsdown.app.config.ts` 生成，新增子命令会自动进包 | 构建配置（2026-11-03） | FNOS-043-01、02 | 已核实 |

## 需求目标

- 向导层用与 DSH 一致的规则拦截：带 `http://`/路径/空白/非法端口的写法当场被拒，`helpText` 明确说明不要带协议头与路径。
- 安装回调在真正安装依赖之前校验该值，不合法即**中止安装**并给出具体原因（哪个条目、错在哪里）。
- 启动脚本在启动前再校验一次，把非法条目与原因写进应用日志，并点明「不是 Node.js 依赖问题」。
- 三处判定**共用同一套规则**，不允许漂移。

## 功能列表

| 编号 | 优先级 | 功能 | 用户可观察结果 | 状态 |
| --- | --- | --- | --- | --- |
| FNOS-043-01 | P0 | 向导层拦截非法地址 | 填 `http://...`、`.../`、`nas:05666` 等当场提示不允许，无法继续安装 | <Badge type="warn" text="待验证" /> |
| FNOS-043-02 | P0 | 安装回调校验失败即中止安装 | 若向导被绕过（脚本安装、旧模板），安装直接失败并指出「可信访问地址填写有误」及具体原因 | <Badge type="warn" text="待验证" /> |
| FNOS-043-03 | P1 | 启动日志透出真实原因 | 升级上来的旧配置若仍非法，应用日志出现 `[trusted-hosts] "<值>"：<原因>`，并说明将被 DSH 拒绝 | <Badge type="warn" text="待验证" /> |
| FNOS-043-04 | P1 | 规则单一来源 | 向导正则与帮助器校验对同一组样本判定一致，由用例固定 | <Badge type="warn" text="待验证" /> |

## 行为约束

- **不替用户改写**输入：DSH 的取向是「typo 要大声失败」，本项目只把失败提前并说清原因。
- 空白值（升级路径上没有该字段）视为未配置，不报错。
- 校验失败信息必须包含**原始值与具体原因**，便于用户在应用中心直接改对。
- 不引入新的运行时依赖；校验器随安装帮助器分发。

## 不在本次范围内

- 把该地址迁到应用设置、支持装完后在应用中心修改（另需设计向导值与文件值的优先级）。
- 网关错误页展示子进程日志摘要（方案 3 的完整形态）。
- 自动从 fnOS 推导可信地址并预填（方案 4）。
- issue 模板「应用版本」下拉只到 5.4.3 的更新（单独处理）。

## 既有功能变更关系

收紧 [FNOS-001](/requirements/FNOS-001-dsh-fnos-adaptation) 引入的安装向导字段校验；安装回调新增一项前置校验，不改变安装/升级主流程；启动脚本只新增日志，不改变启动行为。

## 验收条件与完成状态

### FNOS-043-01

- `FNOS-043-01-AC-01`：`http://192.168.1.112`、`192.168.1.112/`、`user@nas`、`nas:05666`、`::1`、`a,,b` 在向导中被拒。
- `FNOS-043-01-AC-02`：`192.168.1.112`、`192.168.1.112:5666`、`[fd00::1]:5666`、`nas.local`、`xn--fiqs8s.example` 被接受。

### FNOS-043-02

- `FNOS-043-02-AC-01`：把非法值直接传给安装回调，安装以非零退出并输出「「可信访问地址」填写有误：<值>：<原因>」。
- `FNOS-043-02-AC-02`：合法值安装流程继续，日志记录接受结果。

### FNOS-043-03

- `FNOS-043-03-AC-01`：启动脚本遇到非法值时，应用日志含 `[trusted-hosts]` 行与「不是 Node.js 依赖问题」的说明；合法值不产生噪声。

### FNOS-043-04

- `FNOS-043-04-AC-01`：向导正则与 `validateTrustedHosts` 对同一 accept/reject 样本集判定一致（用例断言）。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-11-03 | 初始登记 | 建立 FNOS-043，源自 issue #30。按提出人选定方案：向导正则收紧（与 DSH 判定对齐）、安装回调校验失败即中止安装、启动脚本记录非法值与原因；明确**不做静默改写**。5 条调研结论，关联 PLAN-FNOS-043。 |
| 2026-11-03 | 真机验证发现只改了三份向导中的一份 | 真机装 7.0.14 后发现升级向导仍显示旧文案、`http://192.168.1.112` 照旧放行。排查：`apps/fn-deepseek-harness/wizard/` 下有 **`config`、`install`、`upgrade` 三份向导**（装/升级各用一份），首版只改了 `config`，`install`/`upgrade` 仍是 10-19 的旧正则 `^(?:[^,\s]+(?:,[^,\s]+)*)?$` —— 因此**向导层拦截实际未生效**。三份已按同一 helpText 与 rules 同步（各自步骤文案差异保留），并新增「三份必须一致且都拒绝协议头」的守卫用例。重置后真机复验：升级向导显示新文案，填 `http://192.168.1.112` 当场报「只能填 host 或 host:port…」并**不允许进入下一步**。<code>targetVersion</code> 更新为 7.0.15。 |
