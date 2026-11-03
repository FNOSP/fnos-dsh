---
id: PLAN-FNOS-043
title: PLAN-FNOS-043 可信访问地址的校验与错误透出
description: 用同一套规则在三处落地：向导正则拦截、安装回调校验失败即中止、启动脚本记录非法值与原因。
status: completed
owner: tnnevol
planDate: 2026-11-03
targetVersion: 7.0.14
lastVerified: 2026-11-03
---

# PLAN-FNOS-043 可信访问地址的校验与错误透出

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-043 |
| 计划日期 | 2026-11-03 |
| 对应需求 | [FNOS-043 可信访问地址的校验与错误透出](/requirements/FNOS-043-trusted-hosts-validation) |
| 计划状态 | 实施完成（包级用例通过；真实 NAS 验收待执行，版本提交随功能提交后执行） |

## 计划目标

按 [FNOS-043](/requirements/FNOS-043-trusted-hosts-validation) 把 issue #30 的漏洞在三处堵住，并让三处判定保持一致。

技术边界：只做校验与日志，不改写用户输入、不改安装主流程、不引入新依赖。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| 向导校验 | 只挡逗号与空白 | 与 DSH 一致：裸 host / host:port / 方括号 IPv6，拒绝协议头、路径、userinfo、空白、补零端口 | 装不上比装完起不来好 |
| 安装回调 | 不校验该值 | 调 `validate-trusted-hosts`，失败 `fail_install` 并给出具体原因 | 非法值无法完成安装 |
| 启动脚本 | 原样透传 | 启动前校验，非法则逐条写 `[trusted-hosts]` 日志并说明不是依赖问题 | 旧配置也能在日志定位 |
| 判定来源 | 无 | 帮助器 `trusted-hosts.ts` 单一实现 + 向导正则，用例断言两者一致 | 防止规则漂移 |

## 实施任务

| 阶段 | 任务 | 产物 | 状态 |
| --- | --- | --- | --- |
| 一 | 写校验器（拆分、逐条判定、原因分类、文案） | `packages/fnos-gateway/src/install-callback-helper/trusted-hosts.ts` | 已完成 |
| 二 | 帮助器新增 `validate-trusted-hosts` 子命令（非法写 stderr 并 exit 1） | 同包 `install-callback-helper/index.ts` | 已完成 |
| 三 | 向导正则与 `helpText` 更新 | `apps/fn-deepseek-harness/wizard/config` | 已完成 |
| 四 | 安装回调前置校验并中止安装 | `cmd/install_callback` | 已完成 |
| 五 | 启动脚本记录非法值与原因 | `cmd/main` | 已完成 |
| 六 | 用例：判定表、向导正则一致性、两处接线 | `packages/fnos-gateway/tests/trusted-hosts.spec.ts` | 已完成 |
| 七 | 产物重建与真实 NAS 验收（安装向导填错/填对、升级旧配置） | 验收证据 | 待执行 |

## 技术要点

- 校验器与 DSH 的 `assertTrustedAuthority` 对齐：先做「一眼可辨」的字符违规分类（空格、`://`、`/`、`@`），再解析 host 与 port；方括号 IPv6 单独处理，出现第二个冒号即判「漏了方括号」。
- 端口复用与 `wizard_port` 相同的有界正则（1-65535），并单独区分「补零端口」这种常见误解。
- 向导正则由同一套语法生成（host / bracketed-IPv6 / bounded-port / 逗号分隔），用例把两个实现放在同一组样本上比对，任何一侧漂移都会变红。
- 安装回调把 helper 的 stderr 拼成一行附在失败信息后；`fail_install` 已负责写 `TRIM_TEMP_LOGFILE` 并 `exit 1`。
- 启动脚本只记录、不改写；空值视为未配置，避免升级场景刷噪声。

## 风险与回退

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 向导正则过严（如内部域名用 `_`） | 合法值被拒 | 主机字符集放宽到 `[A-Za-z0-9._-]`（首尾仍限字母数字），并有样本用例覆盖 |
| 升级用户的旧值本就非法 | 升级后仍启动失败 | 启动脚本已把原因写进日志；如需自愈另做（方案 2/6，未纳入本次） |
| fnOS 向导对正则语法的支持与 JS 不一致 | 拦截失效 | 正则只用非捕获组、字符类与量词（与既有 `wizard_port` 同风格）；真机验收确认 |

回退：把向导 `rules` 恢复为旧正则、移除安装回调的 `validate_trusted_hosts` 调用与启动脚本的日志函数即可；帮助器子命令可保留不影响行为。
