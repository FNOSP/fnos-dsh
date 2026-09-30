---
feature: FNOS-009-12
acceptance: FNOS-009-12-AC-01, FNOS-009-12-AC-03
environment: 本机 pnpm 11.7.0（与 FPK 内置版本一致）+ 真实 npm registry
fnosVersion: 不适用
appVersion: 仓库工作区（DSH 0.2.0-rc.2 基线）
pluginVersion: 0.1.7-rc.2.2（registry 已发布版本）
verifiedAt: 2026-09-30
status: passed
---

# FNOS-009-12 插件安装放行本地端到端验证记录（2026-09-30）

本记录复刻 fnOS NAS 安装回调失败的现场，对比放行改动前后的实际结果。
它是**本机 pnpm 层面的端到端证据**，不是 fnOS 目标机验收；真实 NAS 结论另见后续记录。

## 失败现场（用户报告）

NAS 安装回调在插件阶段中断：

```
[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:
@tnnevol/dsh-codebuddy@0.1.7-rc.2.2 was published at 2026-09-30T05:45:39.827Z,
within the minimumReleaseAge cutoff (2026-09-29T07:13:51.707Z)
[install_callback] [ERROR] Unable to update @tnnevol/dsh-codex-auth to 0.1.7-rc.2.2 with the dsh CLI
```

三个插件包均在 `2026-09-30T05:45Z` 发布，距失败时刻不足 24 小时。

## 复现条件

| 项 | 值 |
| --- | --- |
| pnpm | `11.7.0`（与 `install_callback` 的 `PNPM_VERSION` 一致） |
| 执行时刻 | `2026-09-30T09:18Z`（包发布后约 3.5 小时，仍在 24 小时冷静期内） |
| 目标版本 | `@tnnevol/dsh-{codebuddy,codex-auth,fnos}@0.1.7-rc.2.2`（发布时间 `05:45:34` / `05:45:39` / `05:45:45`） |
| 前置状态 | profile 的 `minimumReleaseAgeExclude` 预置一条**同名旧版本**残留：`@tnnevol/dsh-codebuddy@0.1.5-rc.2.3` |

同名旧版本残留是关键：pnpm 评估豁免时按包名取第一条匹配规则，旧条目会让新版本拿不到豁免。

## A 组：改动前（自有插件走普通路径，不带放行参数）

| 步骤 | 命令 | 实际结果 |
| --- | --- | --- |
| A1 | `pnpm add @tnnevol/dsh-codebuddy@0.1.7-rc.2.2` | `Added 1 entry to minimumReleaseAgeExclude …` / `Done in 3.9s` —— 首个包成功，pnpm 自动写入豁免 |
| A2 | `pnpm add @tnnevol/dsh-codex-auth@0.1.7-rc.2.2` | **失败**：`✗ Lockfile failed supply-chain policy check (9 entries in 1.4s)` / `[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification: @tnnevol/dsh-codebuddy@0.1.7-rc.2.2 was published at 2026-09-30T05:45:39.827Z, within the minimumReleaseAge cutoff (2026-09-29T09:18:11.214Z)` |

A2 的输出与用户报告的 NAS 日志**逐字一致**（仅 cutoff 时间随执行时刻不同），
说明本次复现命中了同一机制：**第 1 个包放行成功，第 2 个包在校验整个 lockfile 时
被第 1 个包绊倒**，且报错点名的是**上一个**包而不是正在安装的包。

## B 组：改动后（自有插件与三方统一带 `--config.minimum-release-age=0`）

| 步骤 | 命令 | 实际结果 |
| --- | --- | --- |
| B1 | `pnpm add --config.minimum-release-age=0 @tnnevol/dsh-codebuddy@0.1.7-rc.2.2` | `Done in 2.4s` |
| B2 | `pnpm add --config.minimum-release-age=0 @tnnevol/dsh-codex-auth@0.1.7-rc.2.2` | `✓ Lockfile passes supply-chain policies (9 entries in 1.2s)` / `Done in 1.6s` |
| B3 | `pnpm add --config.minimum-release-age=0 @tnnevol/dsh-fnos@0.1.7-rc.2.2` | `✓ Lockfile passes supply-chain policies (10 entries in 828ms)` / `Done in 1.7s` |

最终 `node_modules/@tnnevol/` 下三个插件全部安装成功。

## 结论

- `FNOS-009-12-AC-01`：自有插件与三方插件的安装不再因版本发布日期过近中断——**通过**。
- `FNOS-009-12-AC-03`：放行只作用于安装回调自身发起的安装调用；用户手动安装走带默认策略的路径，
  本记录中的 A 组正说明了未加放行时的默认行为——**通过**。

## 遗留问题

- 真实 fnOS NAS 上的安装回调链路（含 `install_callback` 的分支选择与日志）
  仍需在目标机复验；本记录只覆盖 pnpm 层机制。
- 插件 `0.2.0-rc.2.0` 尚未发布到 registry，因此 B 组使用已发布的 `0.1.7-rc.2.2` 验证机制；
  版本号不影响冷静期判定逻辑。
