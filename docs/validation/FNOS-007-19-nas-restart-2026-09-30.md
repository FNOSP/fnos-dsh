---
feature: FNOS-007-19
acceptance: FNOS-007-19-AC-01, FNOS-007-19-AC-02, FNOS-007-19-AC-03, FNOS-007-19-AC-04, FNOS-007-19-AC-05
environment: 真实 fnOS NAS，Chrome 桌面端 + trim-cli 重启
fnosVersion: 1.2.0800
appVersion: 5.4.3
pluginVersion: 5.4.3
verifiedAt: 2026-09-30
status: passed
---

# FNOS-007-19 终端 Shell 与字符集环境真机复核记录（2026-09-30）

本记录**追加**在 [`FNOS-007-nas-2026-09-30`](/validation/FNOS-007-nas-2026-09-30) 之后，
不改动该记录。追加原因：那份记录中 FNOS-007-19 的功能结论由验收人确认（标 `[验收]`），
其中 **AC-05「应用重启后终端仍然可用」** 当时没有留下设备侧的操作痕迹。本记录补齐这一段，
并提供可复现的命令级证据。

## 与旧记录的差异

| 项 | 旧记录 | 本记录 |
| --- | --- | --- |
| 证据性质 | 验收人操作确认 | 设备侧命令输出 + 截图，可复现 |
| 覆盖 | 01、03、07、08、10、13、19 | 只做 FNOS-007-19（含 AC-05 的重启环节） |
| AC-05 | 结论为通过，未留重启痕迹 | 执行真实重启并复核重启后的终端 |

旧记录中 FNOS-007-19 的结论**不因本记录而失效**；本记录是同一结论的独立证据补强。

## 设备与环境

| 项 | 值 | 来源 |
| --- | --- | --- |
| 设备型号 | TianBei WTR PRO | `[采集]` `system hardware` |
| 平台 | `x86` | `[采集]` `system trim-version` |
| 内核 | `6.18.18.c1126-trim` | `[采集]` `system kernel-version` |
| fnOS 版本 | `1.2.0800`（Mainland-PE） | `[采集]` `system trim-version` |
| 应用 | `fn-deepseek-harness` `5.4.3` | `[采集]` `app list` |
| 挂载路径 | `/app/fn-deepseek-harness` | `[采集]` `app list` |
| 客户端 | Chrome `155.0.8059.12`，经 NAS 桌面端进入应用 | `[采集]` |

## 重启环节（AC-05）

重启是写操作，按 `trim-cli` 规范显式传 `--yes`：

```text
$ trim-cli --host 192.168.119.6 --port 5666 --profile home --scheme http \
    --allow-insecure-http app restart fn-deepseek-harness --yes
Restarted app-center app fn-deepseek-harness        # 退出码 0
```

| 时间 | 事件 |
| --- | --- |
| `11:24:10` | 发出重启 |
| `11:24:22` | 命令返回成功 |
| `11:24:27` – `11:25:09` | 每 8 秒轮询一次，6 次全部 `status=running`、`version=5.4.3` |

重启后重新进入应用并**新建**终端（不是沿用重启前的会话），在其中执行命令。

## 命令级证据

重启后终端内的实际输出：

```text
fn-deepseek-harness@fnos-nas:/vol1/1000/harness工作区/日志分析$ id
uid=934(fn-deepseek-harness) gid=938(fn-deepseek-harness)
groups=938(fn-deepseek-harness),44(video),105(render),947(TrimApiUsers)
fn-deepseek-harness@fnos-nas:/vol1/1000/harness工作区/日志分析$ printenv SHELL
/usr/bin/bash
fn-deepseek-harness@fnos-nas:/vol1/1000/harness工作区/日志分析$ printenv LANG
C.UTF-8
```

Shell 选择下拉（重启后）只有 `bash` 与 `zsh` 两项：不含 `nologin`，不含 `/usr/sbin`，
`bash` 未重复出现。

## 逐条对照

| 验收 | 证据 | 结论 |
| --- | --- | --- |
| AC-01 网关统一注入、`cmd/main` 不再重复适配 | 重启后 `SHELL=/usr/bin/bash` 仍成立；注入随每次启动发生，不依赖进程残留 | 通过 |
| AC-02 `SHELL` 为 PATH 解析出的 bash，无重复 bash、不显示 nologin | 下拉仅 `bash`/`zsh`；`printenv SHELL` = `/usr/bin/bash` | 通过 |
| AC-03 UTF-8 locale，中文不乱码 | `LANG=C.UTF-8`；`LC_ALL` 为空；中文路径与会话工作区显示正常 | 通过 |
| AC-04 运行身份与应用服务一致，不提权不切用户 | `uid=934(fn-deepseek-harness)`，非 `uid=0(root)` | 通过 |
| AC-05 真实 NAS 可打开/执行/关闭，应用重启后仍可用 | 重启 12 秒完成后应用回到 `running`；重新新建终端并成功执行 `id`、`printenv` | 通过 |

**重启前后的关键值完全一致**（`uid=934`、`SHELL=/usr/bin/bash`、`LANG=C.UTF-8`、同一工作目录），
说明这些环境由网关在启动 DSH Web 时注入，而非上一进程的残留状态。

## 证据文件

截图保留在本地临时目录，未纳入版本管理（含 NAS 会话内容）：

- `qa-11-after-restart-term.png` —— 重启后新建终端
- `qa-12-ac05-restart.png` —— 重启后终端内 `id` / `printenv` 输出

如需长期留存，应另行决定存放位置与脱敏方式。

## 已知的非本记录问题

重启后进入应用时，会话区曾显示一次启动脚本异常输出，与会话中一条历史命令（`find /` 扫描根目录）
有关。该现象**不属于 FNOS-007-19 的范围**，本记录不据此作出任何结论，也不影响上述五项验收。

## 遗留问题

无阻塞项。
