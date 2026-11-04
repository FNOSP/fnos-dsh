---
id: FNOS-044
title: FNOS-044 测试用例
description: FNOS-044 FPK 平台产物选择与双包发布的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-044-fpk-platform-selection
plan: /plans/PLAN-FNOS-044-fpk-platform-selection
status: 部分通过
lastVerified: 2026-11-04
verifiedAt: 2026-11-04
---

# FNOS-044 测试用例

## 测试范围与需求分析

被测对象是 `tooling/fnos-dsh-cli` 的 FPK 构建链路、`.github/workflows/build-app.yml` 的双包核对与上传，以及构建交互。需求见 [FNOS-044](/requirements/FNOS-044-fpk-platform-selection)，执行任务见 [PLAN-FNOS-044](/plans/PLAN-FNOS-044-fpk-platform-selection)。覆盖功能：

| 编号 | 功能 | 关键风险点 |
| --- | --- | --- |
| [FNOS-044-01](/requirements/FNOS-044-fpk-platform-selection#fnos-044-01) | 构建时选择目标平台 | 非交互执行进询问会**挂住**而不是报错；取消被当成「没做选择」会绕过使用者意图 |
| [FNOS-044-02](/requirements/FNOS-044-fpk-platform-selection#fnos-044-02) | 包内平台声明与所选一致 | 就地改仓库清单再还原：进程被杀留下脏值，下次构建把脏值当原始值捕获，永远还原不回 |
| [FNOS-044-03](/requirements/FNOS-044-fpk-platform-selection#fnos-044-03) | 产物名带平台段 | 命名模板两侧（本地 / CI）不同形；多平台时把同批产物报成残留 |
| [FNOS-044-04](/requirements/FNOS-044-fpk-platform-selection#fnos-044-04) | Release 分发双平台包 | `find … -print -quit` 取第一个：两份包只传上其中一份且步骤报成功 |
| [FNOS-044-05](/requirements/FNOS-044-fpk-platform-selection#fnos-044-05) | 构建任务选项顺序 | 顺序改动无守卫，回退无人发现 |

❓ 未决：ARM 包在真实 ARM64 NAS 上能否安装（发布方无 ARM 设备，见第 2 节）。issue #28 列出的三个待验证点已核实两项：`node-pty` 带 `linux-arm64` 预编译产物、`koffi` 带 `@koromix/koffi-linux-arm64` 可选依赖（安装期原生依赖成立，运行时能否加载仍需设备反馈）；网关依赖为纯 JS 且产物内无 `.node` 二进制（成立）。**唯一剩余的硬前置**是 fnOS ARM64 是否提供 `nodejs_v24` 系统包——应用不内置 Node，这一项不成立则 ARM 包在安装依赖阶段就失败。

## 测试环境

| 功能 | 环境 | 说明 |
| --- | --- | --- |
| FNOS-044-01、02、03、05 | 本地构建链路（macOS 15 / arm64，fnpack 1.2.3） | 包级用例 + 实跑构建 + 解包核对 |
| FNOS-044-04 | GitHub Actions（ubuntu-latest，fnpack 1.2.1-linux-amd64） | 步骤脚本在本地按同形数据干跑；线上实跑随下一次发布 |
| ARM 装机 | 真实 ARM64 fnOS NAS | **本轮无法执行**：无 ARM 设备。按 issue #28 口径交社区自测 |

## 测试用例

### FNOS-044-01 构建时选择目标平台

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-001 | AC-01 | 交互追问平台且预勾清单声明值 | 平台参数未给、TTY 交互 | mock multiselect 后调用 | 选项为 `x86`/`arm`，`initialValues` 为清单声明的 `x86` | P0 |
| TC-002 | AC-01 | 双选按选择顺序返回 | 同上 | mock 返回 `['arm','x86']` | 返回 `['arm','x86']` | P0 |
| TC-003 | AC-02 | 显式参数优先且不进询问 | `--platform arm --platform x86` | 调用选择器 | 返回两平台，multiselect 未被调用 | P0 |
| TC-004 | AC-02 | 非交互不进询问、交回「没做选择」 | 无 TTY、无参数 | 调用选择器（interactive=false） | `cancelled=false`、`platforms=undefined`，不进询问 | P0 |
| TC-005 | AC-03 | 取消询问不产出任何包 | 交互 | mock 返回取消符号 | `{ cancelled: true }` | P0 |
| TC-006 | AC-05 | 非法取值报错并列出允许值 | `--platform mips` | 调用选择器 | 抛错含 `Supported platforms: x86, arm` | P0 |
| TC-007 | AC-04 | 未选 FPK 任务时不问平台 | 交互只勾 docs | 实跑 | 不出现平台询问 | P1 |
| TC-008 | — | 清单没声明平台时报错，不默认 x86 | declared=undefined | 调用解析器 | 抛错 `declares no platform` | P1 |
| TC-009 | — | 清单声明 `all` 时说明「不是构建目标」 | declared='all' | 调用解析器 | 抛错点名 `platform = all`，不谎称没声明 | P1 |

### FNOS-044-02 包内平台声明与所选一致

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-010 | AC-01 | 改写只动 platform 的值并保留对齐 | 清单文本 | 调用改写函数 | `platform              = arm`，等号空白不变 | P0 |
| TC-011 | AC-01 | 除 platform 行外逐行不变 | 清单文本 | 逐行比对 | 其余行全等 | P0 |
| TC-012 | AC-02 | 副本改写期间源目录清单不变 | 临时应用目录 | 在副本回调内断言 | 副本为 arm、源文件与进入前逐字节相同 | P0 |
| TC-013 | AC-02 | 回调失败同样删除副本且源清单不变 | 回调抛错 | 调用并捕获 | 副本不存在、源清单原样、原错误上抛 | P0 |
| TC-014 | AC-02 | 排除 tests/、node_modules/、历史 .fpk | 含这些条目的目录 | 检查副本 | fnpack 需要的在场、三者不在场 | P1 |
| TC-015 | AC-02 | 应用目录位于 tests/ 等父路径下仍完整复制 | 嵌套路径 | 检查副本 | 应用内容完整（排除按相对路径判断） | P1 |
| TC-016 | AC-02 | 保留生命周期脚本可执行位 | 0755 脚本 | 检查副本模式 | 副本仍为 755 | P0 |
| TC-017 | AC-03 | 实跑双平台：两份包内平台声明正确、名字对应 | 本地构建 | 解包读 manifest | x86 包声明 x86、arm 包声明 arm | P0 |
| TC-018 | AC-02 | 实跑后仓库清单未被改动 | 本地构建 | `git status` | manifest 无改动 | P0 |
| TC-019 | AC-03 | 双平台产物除平台行外内容一致 | 本地构建 | 比对成员清单与 app.tgz | 成员一致、app.tgz 内容一致 | P1 |

### FNOS-044-03 产物名带平台段

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-020 | AC-01 | 命名模板含平台段 | — | 单测 | `fn-deepseek-harness-x86-v7.0.0-dsh-0.2.1-rc.5.fpk` | P0 |
| TC-021 | AC-02 | 同版本不同平台名字互不相同 | — | 对两个平台取名 | 集合大小等于平台数 | P0 |
| TC-022 | AC-03 | 本地与 CI 模板同形 | — | 归一化占位符后比对 | 两侧字符串相等 | P0 |
| TC-023 | — | 同批多平台先产出的那份不算残留 | 目录含 x86 产物 | 改名 arm 产物 | `leftovers` 为空 | P1 |
| TC-024 | — | 历史旧包仍从残留报出 | 目录含旧版本包 | 改名 | 旧包名出现在 leftovers | P1 |
| TC-025 | — | 取源仍按 fnpack 固定名 | 目录含同名旧产物 | 改名 | 目标名内容是本次新包 | P0 |

### FNOS-044-04 Release 分发双平台包

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-026 | AC-01 | CI 显式传两个平台 | — | 读 workflow | 含 `--platform x86 --platform arm` 与 `for PLATFORM in x86 arm` | P0 |
| TC-027 | AC-01 | CI 不再取目录里第一个 .fpk | — | 读 workflow | 无 `find … -print -quit`；逐平台 `[ ! -f ]` 核对 | P0 |
| TC-028 | AC-01 | 缺任一平台产物即失败 | 只有一份包 | 本地干跑核对脚本 | 退出码非 0 并点名缺哪一份 | P0 |
| TC-029 | AC-01 | 上传循环覆盖全部平台且任一失败即整体失败 | — | 读 workflow + 干跑切分 | 逐个上传；失败汇总后非 0 退出 | P1 |
| TC-030 | AC-02 | ARM 未验证口径入文档 | — | 检查文档 | CI 说明、应用页、上架口径三处均写明社区自测 | P1 |

### FNOS-044-05 构建任务选项顺序

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-031 | AC-01 | 顺序为 fpk、docs、plugins | 交互 | mock 后调用 | options 值顺序为 `['fpk','docs','plugins']` | P2 |
| TC-032 | AC-01 | 实跑确认界面呈现 | 终端 | `pnpm run build` | Harness 插件在最后一行 | P2 |

## 测试执行结果

| 用例 | 结果 | 执行日期 | 证据 |
| --- | --- | --- | --- |
| TC-001～TC-006 | 通过 | 2026-11-04 | `tests/fpk-platform-selection.spec.ts`、`tests/prompts.spec.ts`；CLI 全量 144 条全绿 |
| TC-007 | 通过 | 2026-11-04 | 代码路径：`runBuild` 仅在 `selection.includes('fpk')` 时调用 `selectFpkPlatforms` |
| TC-008、TC-009 | 通过 | 2026-11-04 | `tests/fpk-platform.spec.ts` → `resolveFpkPlatforms` 两条报错用例 |
| TC-010～TC-013 | 通过 | 2026-11-04 | `tests/fpk-platform.spec.ts`；含「源清单不被写入」「失败也清理副本」 |
| TC-014～TC-016 | 通过 | 2026-11-04 | 同上；TC-015 用嵌套 `tests/node_modules` 路径验证排除按相对路径判断 |
| TC-017 | 通过 | 2026-11-04 | 实跑 `pnpm run build -- --fpk --app fn-deepseek-harness --skip-bundle-dsh-plugins --platform x86 --platform arm`；解包 `tar -xzOf <pkg> manifest` 得 x86 包 `platform = x86`、arm 包 `platform = arm` |
| TC-018 | 通过 | 2026-11-04 | 构建后 `git status --porcelain` 无 manifest 条目；仓库清单仍为 `platform              = x86` |
| TC-019 | 通过 | 2026-11-04 | 两份包成员清单 `diff` 为空；`app.tgz` 解包后 `diff -rq` 无差异；包内 manifest 逐行比对只差 `platform` 一行（`checksum` 相同，说明它覆盖的是 app.tgz 而非清单） |
| TC-020～TC-025 | 通过 | 2026-11-04 | `tests/fpk-artifacts.spec.ts`、`tests/fpk-release-naming.spec.ts` |
| TC-026、TC-027、TC-029 | 通过 | 2026-11-04 | 命名守卫用例读 workflow 断言；workflow YAML 解析通过 |
| TC-028 | 通过 | 2026-11-04 | 本地干跑核对脚本：只有一份包时退出码 1 并输出 `ERROR: …-arm-…fpk was not produced` |
| TC-030 | 通过 | 2026-11-04 | `docs/build/ci.md`、`docs/apps/fn-deepseek-harness.md`、`docs/charter/app-listing-spec.md` 三处口径 |
| TC-031 | 通过 | 2026-11-04 | `tests/prompts.spec.ts` 顺序断言 |
| TC-032 | 未执行 | — | 需要人工在终端确认视觉呈现；顺序由 TC-031 的守卫用例钉住 |
| ARM 真机装机 | 未执行 | — | 发布方无 ARM64 设备。待社区反馈，见 Bug/风险记录 |

**等价性补充验证**（暂存副本方案的决定性风险）：对同一份输入分别执行「直接打包」与「副本打包」，`app.tgz` 成员 63 项一致、解包后 `diff -rq` 无内容差异，包内 manifest 仅 `checksum` 一行不同（fnpack 自身的非确定性，与本次改动无关）。

## Bug 记录

| 编号 | 发现于 | 描述 | 状态 |
| --- | --- | --- | --- |
| BUG-01 | TC-004 前置实跑 | 非交互执行 `pnpm run build -- --fpk --app …`（不带 `--platform`）时，clack 的 multiselect 画出平台选项后**永久等待**，Node 以 exit code 13（unsettled top-level await）结束。挂住比报错难查 | 已修复：`selectFpkPlatforms` 区分「显式指定 / 没做选择 / 取消」三态，非交互不进询问、按清单声明取默认；TC-004 钉住 |
| BUG-02 | TC-023 设计阶段 | 双平台构建时，第二次改名会把第一次的产物报成「装机时容易拿错」的残留，每次双平台构建都无端告警 | 已修复：`renameFpkToRelease` 接受本次构建的目标名集合并排除 |
| BUG-03 | TC-014 设计阶段 | 排除规则若按**绝对路径**匹配 `tests`/`node_modules`，当检出本身位于同名父目录下时整个应用会被排除，产出空包 | 已修复：排除按相对应用目录的路径判断；TC-015 钉住 |

## 测试结论

FNOS-044-01、02、03、05 的包级用例与本地实跑全部通过；FNOS-044-04 的 CI 脚本逻辑已在本地按同形数据干跑验证，线上实跑随下一次发布执行。

**遗留风险（不阻塞本轮合入，但阻塞「ARM 支持已完成」的结论）**：ARM 包未经任何真实 ARM64 设备验证。issue #28 列的三个待验证点里，`node-pty` 的 aarch64 预编译产物与网关侧原生依赖已在 2026-11-04 核实为不存在障碍（前者带 `linux-arm64`，后者 `koffi` 带 `@koromix/koffi-linux-arm64`、网关自身纯 JS 且产物无 `.node`）；运行时能否加载成功仍需设备反馈。剩下的硬前置是 **fnOS ARM64 是否提供 `nodejs_v24` 系统包**——应用不内置 Node，这一项不成立则 ARM 包在安装依赖阶段就失败。文档与应用页已把 ARM 包标注为社区自测，上架仍只交已验证的 x86 包。

变异验证：临时去掉命名模板的平台段、把副本改写换成不改写、把构建任务顺序改回原样，对应 8 条用例变红；还原后 144 条全绿。
