---
id: FNOS-043
title: FNOS-043 测试用例
description: FNOS-043 可信访问地址校验（向导正则、安装拦截、启动日志）的用例、执行结果与遗留项。
requirement: /requirements/FNOS-043-trusted-hosts-validation
plan: /plans/PLAN-FNOS-043-trusted-hosts-validation
status: 部分通过
lastVerified: 2026-11-03
verifiedAt: 2026-11-03
---

# FNOS-043 测试用例

## 测试范围与需求分析

被测对象是「可信访问地址」在三处的判定：向导正则、安装回调、启动日志。基准来自 DSH 的 `assertTrustedAuthority`。执行任务见 [PLAN-FNOS-043](/plans/PLAN-FNOS-043-trusted-hosts-validation)。

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-043-01](/requirements/FNOS-043-trusted-hosts-validation#fnos-043-01) | 向导接受/拒绝面 | 正则过宽放行 `http://`；过严误拒合法主机 |
| [FNOS-043-02](/requirements/FNOS-043-trusted-hosts-validation#fnos-043-02) | 安装期中止 | 只记日志不中止，用户仍装上跑不起来 |
| [FNOS-043-03](/requirements/FNOS-043-trusted-hosts-validation#fnos-043-03) | 启动日志 | 日志不点明真因，仍被误读成依赖问题 |
| [FNOS-043-04](/requirements/FNOS-043-trusted-hosts-validation#fnos-043-04) | 规则单一来源 | 两边各写一套后漂移 |

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-043-01、04 | 包级（Node / vitest） | `packages/fnos-gateway/tests/trusted-hosts.spec.ts`（判定表 + 向导正则比对） |
| FNOS-043-02 | 包级 + shell 冒烟 | 用真实 helper 与真实函数体，跑合法/非法样本 |
| FNOS-043-03 | 包级 + shell 冒烟 | 同上，检查日志行 |
| FNOS-043-01~03 | 真实 fnOS NAS | 安装向导填 `http://...` 应被拒；填对可安装（**未执行**） |

## 测试用例

### [FNOS-043-01 向导层拦截](/requirements/FNOS-043-trusted-hosts-validation#fnos-043-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-043-01 | 接受裸 host / host:port / IPv6 / punycode | AC-02 | 无 | 1.对 10 个样本调用 `validateTrustedHosts` | 全部 ok | P0 | DSH 接受面 |
| TC-002 | FNOS-043-01 | 拒绝协议头、路径、userinfo、空白 | AC-01 | 无 | 1.逐条校验并比对原因码 | `scheme`/`path`/`userinfo`/`whitespace` | P0 | issue #30 |
| TC-003 | FNOS-043-01 | 拒绝裸 IPv6、非法/补零端口 | AC-01 | 无 | 1.`::1`、`nas:05666`、`nas:65536` | `ipv6-unbracketed`/`port-leading-zero`/`port-invalid` | P0 | 常见误解 |
| TC-004 | FNOS-043-01 | 多条目逐个判定 | AC-01 | 无 | 1.`nas:5666,http://bad,other:1` | 仅 1 条 issue，且指向 `http://bad` | P1 | 好值不掩盖坏值 |
| TC-005 | FNOS-043-01 | 空条目被拒 | AC-01 | 无 | 1.`a,,b`、`a,`、`,a` | `empty` | P1 | 多余逗号 |

### [FNOS-043-02 安装期中止](/requirements/FNOS-043-trusted-hosts-validation#fnos-043-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-006 | FNOS-043-02 | 非法值中止安装 | AC-01 | 真实 helper + 真实函数体 | 1.`wizard_trusted_hosts=http://192.0.2.10` 调 `validate_trusted_hosts` | 退出码 1，输出包含原值与「协议头」 | P0 | 已执行 |
| TC-007 | FNOS-043-02 | 合法值继续 | AC-02 | 同上 | 1.`192.0.2.10:5666` | 退出码 0 且日志记录 accepted | P0 | 已执行 |
| TC-008 | FNOS-043-02 | 校验挂在安装主流程之前 | — | 源码 | 1.断言 `validate_install_configuration` 内含 `validate_trusted_hosts` | 成立 | P0 | 避免装到一半才失败 |

### [FNOS-043-03 启动日志](/requirements/FNOS-043-trusted-hosts-validation#fnos-043-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-009 | FNOS-043-03 | 非法值写出原因 | AC-01 | 真实 helper + 真实函数体 | 1.`TRUSTED_HOSTS=http://...` | stderr 含 `[trusted-hosts] "值"：原因` 与「不是 Node.js 依赖问题」 | P0 | 已执行 |
| TC-010 | FNOS-043-03 | 合法值不刷噪声 | AC-01 | 同上 | 1.合法值 | 无输出 | P1 | 已执行 |
| TC-011 | FNOS-043-03 | 空值视作未配置 | — | 同上 | 1.空值 | 仅一行 info 说明 | P2 | 升级场景 |

### [FNOS-043-04 规则单一来源](/requirements/FNOS-043-trusted-hosts-validation#fnos-043-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-012 | FNOS-043-04 | 向导正则与校验器一致 | AC-01 | 读取 `wizard/config` | 1.用同一组 accept/reject 样本跑两侧 | 判定完全一致，空串两侧都拒绝 | P0 | 防漂移 |

## 执行结果

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| TC-001 ~ TC-005、TC-008、TC-012 | 通过 | `tests/trusted-hosts.spec.ts`（11 条）；`vitest run` 全量 166 条通过 |
| TC-006、TC-007、TC-009、TC-010、TC-011 | 通过 | 用真实 helper 与真实函数体跑样本：非法 → exit 1 + 原因；合法 → exit 0 + accepted；空值 → 仅 info；启动侧非法 → 两行 ERROR |
| 真机：向导拦截非法值（TC 端到端） | 通过 | NAS 手动安装 7.0.14 → 升级向导填 `http://192.0.2.10` → 字段报「只能填 host 或 host:port（可多个…）：不要带 http:// 或 https://，不要带路径，端口 1-65535 且不能有前导零」，向导停在原页不进入安装 |
| 真机：安装回调拦截（FNOS-043-02） | 通过 | 首轮 FPK 未含新向导时用同样非法值继续，安装被中止：`[install_callback] [ERROR] 「可信访问地址」填写有误："http://192.0.2.10"：带了 http:// 或 https:// 之类的协议头…`，应用保持 7.0.1 运行未受损 |
| 真机：合法值不误拦 | 通过 | 同一向导用 `192.0.2.10:5666,nas.example` 可进入安装流程（后续失败在插件未发布，与本需求无关） |

构建与静态检查：

- `packages/fnos-gateway`：`tsc --noEmit` 通过；`eslint` 0 error；`vitest` 166 条通过。
- `tsdown --config tsdown.app.config.ts`：`app/scripts/install-callback-helper.mjs` 重建，`validate-trusted-hosts` 已进包；对 `http://x` 实跑输出原因并 exit 1。
- `bash -n cmd/main`、`bash -n cmd/install_callback`：语法通过。

## 问题记录

| 编号 | 现象 | 定位 | 处置 |
| --- | --- | --- | --- |
| BUG-043-01 | `cmd/main` 里用了不存在的 `APP_DEST` | 该脚本用的是 `TRIM_APPDEST` | 改用 `${TRIM_APPDEST}/scripts/install-callback-helper.mjs` |
| BUG-043-02 | 校验器触发 `regexp/prefer-d`、`prefer-includes` 等 lint 规则 | 规则要求 `\d` 与 `.includes` | `eslint --fix` 修正，语义等价；复跑用例仍全绿 |
| BUG-043-03 | 真机：升级向导仍显示旧文案、`http://` 被放行 | 向导有 `config`/`install`/`upgrade` 三份，首版只改 `config` | 三份同步同一规则 + 新增一致性守卫用例；重建 FPK 后真机复验：新文案生效、非法值被向导拒绝 |

## 最终结论

包级结论：三处判定已接通且共用一套规则，向导正则与校验器在同一组样本上完全一致；安装期非法值会中止安装并指明原因，启动期非法值会写进日志并点明不是依赖问题。

真机结论待补：需构建 FPK 后在真实 fnOS NAS 走一次安装向导（填 `http://...` 应被当场拒绝、填对可安装），并验证从旧版本升级的非法配置会在日志里给出 `[trusted-hosts]` 原因。
