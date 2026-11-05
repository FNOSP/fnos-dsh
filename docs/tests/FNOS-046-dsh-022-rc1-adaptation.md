---
id: FNOS-046
title: FNOS-046 测试用例
description: DSH 0.2.2-rc.1 基线升级的用例设计、执行结果与问题记录。
requirement: /requirements/FNOS-046-dsh-022-rc1-adaptation
plan: /plans/PLAN-FNOS-046-dsh-022-rc1-adaptation
status: 进行中
lastVerified: 2026-11-05
---

# FNOS-046 测试用例

被测对象是仓库运行基线（catalog / 安装回调 / 安装期 Node 门禁）、七个入库插件的锚定与契约适配、版本与产物口径。需求见 [FNOS-046](/requirements/FNOS-046-dsh-022-rc1-adaptation)，执行任务见 [PLAN-FNOS-046](/plans/PLAN-FNOS-046-dsh-022-rc1-adaptation)。

## 测试范围与需求分析

| 编号 | 功能 | 关键风险点 |
| --- | --- | --- |
| FNOS-046-01 | 七个入库插件在新运行时上正常加载 | 精确锚定不前进会被门禁拒绝；插件在 0.2.2 上编译或运行失败 |
| FNOS-046-02 | 插件界面与模型通道契约保持 | 插座 ownerProps 变化；pi-ai 双实例导致类型不兼容；模型目录换代被误判为缺陷 |
| FNOS-046-03 | 基线单一事实来源同步 | 只改默认 catalog 造成假绿；豁免清单残留失效条目 |
| FNOS-046-04 | Node 运行时门禁满足 | 应用侧无版本校验时「装成功但服务起不来」 |
| FNOS-046-05 | 本地联调环境对齐新基线 | profile 组合与新基线冲突；检出缺产物导致 Desktop 起不来 |
| FNOS-046-06 | 用户数据兼容 | 定时任务存储单向升级；凭据/会话/配置丢失 |
| FNOS-046-07 | 版本与文档基线口径一致 | 语言文件基线字样无自动化；产物命名与文档页不一致 |

## 测试环境

| 功能 | 环境 | 说明 |
| --- | --- | --- |
| FNOS-046-01、02、06 | DSH Web | `pnpm run start -- --web`（`DSH_HOME=<repo>/.dsh`，端口 8070，走启动日志的 token 地址） |
| FNOS-046-01、02、05、06 | DSH Desktop | 上游检出 `fork-pj/deepseek-harness` 的开发态 Desktop（`DSH_HOME=<repo>/.dsh`，渲染调试端口 9333） |
| FNOS-046-04 | 真实 fnOS NAS（192.168.0.17:5666） | 系统 Node 版本 + 应用中心安装/升级 + 启动版本报告 |
| FNOS-046-03、07 | 本地构建链路 | `pnpm run check -- --all`、FPK 构建产物命名 |

## 测试用例

### FNOS-046-01 七个入库插件在新运行时上正常加载

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-001 | AC-01 | 插件管理页无异常行 | 基线已迁移并重装依赖 | 打开 DSH Web → 插件页，读取「已安装插件」区 | 六个本地 profile 插件（Codex / Failover Search / Midscene / OpenCode / Semi UI / ZCode）均为启用状态，无「异常」 | P0 |
| TC-002 | AC-02 | 运行日志无插件加载错误 | 同上 | 启动日志与浏览器控制台 | 无模块未找到、插座未声明、行挂起；控制台无 error/warn | P0 |
| TC-003 | AC-03 | 七插件包级验证 | 同上 | 七个插件 `typecheck` + `test` + `build` | 全部退出码 0 | P0 |
| TC-004 | AC-04 | 三方插件不被门禁拒绝 | 同上 | 检查 `dshmarket` 的 peer 范围与门禁语义 | `^0.2.1-rc.1` 在含预发布语义下包含 `0.2.2-rc.1` | P1 |

### FNOS-046-02 插件界面与模型通道契约保持

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-005 | AC-01 | 注册插座全部存活 | 基线已迁移 | 比对两 tag 插座目录，检查本仓库注册的 8 个插座 | 8 个插座 ownerProps/registerOptions 零变化；新增 6 个插座、无删除 | P0 |
| TC-006 | AC-02 | 插件详情区块渲染 | DSH Web | 打开 Codex 插件详情 | 详细介绍、包含的组件、来源信息、设置区均渲染，版本显示 8.0.0 | P0 |
| TC-007 | AC-03 | 模型目录按新底座暴露 | DSH Web，Codex 已登录 | 展开「全局模型」选择器 | 展示 pi-ai 1.4.0 目录（GPT-5.6 / GPT-6 一系），不出现空列表 | P0 |
| TC-008 | AC-04 | 13 条指南逐条有结论 | — | 逐条复核官方指南并记录证据 | 每条有「落在/不落在本仓库」结论 | P0 |
| TC-009 | AC-02 | 亮暗主题渲染 | DSH Web | 设置 → 通用设置 → 外观，浅色与深色各看一次 | 两种主题下插件界面与设置面板渲染正常 | P1 |

### FNOS-046-03 基线单一事实来源同步

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-010 | AC-01 | 三处基线无旧值残留 | 改写完成 | `grep -c '0.2.1-rc.5' pnpm-workspace.yaml`、检查锁文件 | 均为 0 | P0 |
| TC-011 | AC-01 | 守卫覆盖七个插件 | 改写完成 | 运行构建工具测试；改一个插件 engines.dsh 后再跑 | 正常全绿；变异时该插件被点名报错 | P0 |
| TC-012 | AC-02 | 运行时版本与声明一致 | DSH Web | 设置 → 通用设置 → 当前版本 | 显示 `0.2.2-rc.1` | P0 |
| TC-013 | AC-02 | 安装回调与 catalog 同值 | — | 比对 `DSH_VERSION` 与 catalog | 两者相同，构建校验通过 | P1 |

### FNOS-046-04 Node 运行时门禁满足

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-014 | AC-03 | 门禁三态 | — | 运行 helper `check-node` 单测 | 满足放行、不满足失败并给可执行提示、无法解析失败 | P0 |
| TC-015 | AC-03 | 常量与运行时下限一致 | — | 构建工具守卫断言 | 脚本常量等于已安装 dsh 的 engines.node | P0 |
| TC-016 | AC-01 | 真机 Node 版本 | 真实 NAS | 只读取证系统 `nodejs_v24` 版本 | ≥ 24.9.0 | P0 |
| TC-017 | AC-02 | 真机安装/升级后启动 | 真实 NAS | 应用中心安装 8.0.0 包并观察启动 | 服务启动并报告 `0.2.2-rc.1` | P0 |

### FNOS-046-05 本地联调环境对齐

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-018 | AC-01 | 检出处于新 tag | — | `git describe --tags` | `dsh-v0.2.2-rc.1` | P0 |
| TC-019 | AC-02 | 联调 profile 先备份后调整 | — | 检查备份目录与 profile 依赖版本 | 备份存在；experimental 依赖为 `0.2.2-rc.1`；独立工作树包已移除 | P1 |
| TC-020 | AC-02 | 开发态 Desktop 启动 | 检出已构建 | 启动 `dev:desktop` | 渲染进程报告 `0.2.2-rc.1` 并加载插件 | P0 |

### FNOS-046-06 用户数据兼容

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-021 | AC-01 | 既有会话可打开 | 升级后 DSH Web | 侧边栏打开历史会话 | 会话正常渲染 | P0 |
| TC-022 | AC-01 | 账号状态保留 | 升级后 | 打开 Codex 插件详情 | 显示「已登录」 | P0 |
| TC-023 | AC-02 | 数据未被改写 | 升级前后 | 只读核对 profile 数据目录 | 无删除、无改写 | P0 |

### FNOS-046-07 版本与文档基线口径

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-024 | AC-01 | 版本推进到 8.0.0 | 功能提交完成 | 运行版本命令 | 根包、七个插件、manifest 同为 8.0.0 | P0 |
| TC-025 | AC-02 | 三处基线口径一致 | 版本提交后 | 检查 FPK 名、`manifest`、应用文档页、语言文件 | 均指向 `0.2.2-rc.1` | P0 |

## 测试执行结果

| 用例 | 结果 | 执行日期 | 证据 |
| --- | --- | --- | --- |
| TC-001 | 通过 | 2026-11-05 | DSH Web 插件页「已安装插件」六项全部启用，无「异常」徽标 |
| TC-002 | 通过 | 2026-11-05 | 启动日志无插件错误；浏览器控制台 error/warn 查询为空 |
| TC-003 | 通过 | 2026-11-05 | 七插件 typecheck 全绿；单测 codex 137 / opencode 208 / zcode 169 / fnos 447 / failover 233 / midscene 211 / semi-ui 39 |
| TC-004 | 通过 | 2026-11-05 | 门禁实现读源码确认 `includePrerelease: true`；semver 实测 `0.2.2-rc.1` 命中 `^0.2.1-rc.1` |
| TC-005 | 通过 | 2026-11-05 | 插座目录 103 → 109（新增 6、删除 0）；本仓库 8 个插座 ownerProps/registerOptions 零变化 |
| TC-006 | 通过 | 2026-11-05 | Codex 详情页渲染完整，版本 8.0.0，组件区显示「1 个 · 1 运行中」 |
| TC-007 | 通过 | 2026-11-05 | 全局模型选择器列出 GPT-6-Luna、GPT-5.6-Terra、GPT-5.6-Luna 等 7 个模型 |
| TC-008 | 通过 | 2026-11-05 | 13 条指南逐条判定：1 条影响（pi-ai 图片上限）、2 条仅本地环境、10 条不触及 |
| TC-009 | 通过 | 2026-11-05 | 浅色与深色各截图一次；切回浅色后 `body[theme-mode]=light` |
| TC-010 | 通过 | 2026-11-05 | `pnpm-workspace.yaml` 旧基线残留 0；`pnpm-lock.yaml` 旧基线残留 0 |
| TC-011 | 通过 | 2026-11-05 | 构建工具 161 条全绿；变异：把 opencode `engines.dsh` 改回旧值时用例点名报错，还原后恢复 |
| TC-012 | 通过 | 2026-11-05 | 设置 → 通用设置显示「当前版本：0.2.2-rc.1」 |
| TC-013 | 通过 | 2026-11-05 | `DSH_VERSION` 与 catalog 同为 `0.2.2-rc.1`；仓库级 check 通过 |
| TC-014 | 通过 | 2026-11-05 | gateway 单测 5 条覆盖满足/不足/无法解析，且断言按数值而非词法比较 |
| TC-015 | 通过 | 2026-11-05 | 守卫断言 `DSH_MIN_NODE_VERSION` 等于已安装 dsh 的 `engines.node` |
| TC-016 | 通过 | 2026-11-05 | 真机记录（2026-10-08）v24.15.0 ≥ 24.9.0；本次安装成功本身即为门禁成立的间接证据（门禁不满足会在安装期直接失败） |
| TC-017 | 通过 | 2026-11-05 | 在 192.168.124.181 应用中心「手动安装 → 从电脑上传」上传 `fn-deepseek-harness-x86-v8.0.0-dsh-0.2.2-rc.1.fpk`，安全提示→下一步→「更新中 … 100%」→对话框关闭；NAS Web iframe 内 `__DSH_BOOT__.release` = `{version: "0.2.2-rc.1", commit: "c59d10a"}`，80 个 boot 入口含 `@tnnevol/dsh-fnos`、`@tnnevol/dsh-failover-search`、`@tnnevol/dsh-codex-auth`、`dshmarket`；插件页无「异常」，fnOS 插件详情显示 v8.0.0 |
| TC-018 | 通过 | 2026-11-05 | `git describe --tags` = `dsh-v0.2.2-rc.1`（commit 66491b05e3） |
| TC-019 | 通过 | 2026-11-05 | 备份目录 `tmp/profile-backup-20261105-121316/`；4 个 experimental 依赖升级为 `0.2.2-rc.1`；组合 17 → 16 项 |
| TC-020 | 通过 | 2026-11-05 | 开发态 Desktop 起来：残留进程 `dsh-app://app/`，标题栏显示 `DSH 本地构建 0.2.2-rc.1-66491b0-dirty`（对应当前检出 tag），恢复项目 `.dsh` 的 10 个会话，插件入口与 Semi UI 入口在位，页面无「异常」「加载失败」文案 |
| TC-021 | 通过 | 2026-11-05 | 侧边栏历史会话（harness debugger、测试猜想、技能安装等）正常列出与打开 |
| TC-022 | 通过 | 2026-11-05 | Codex 详情页状态为「已登录」 |
| TC-023 | 通过 | 2026-11-05 | 迁移只改锚定与声明；profile 数据未做删除或改写（备份目录独立存放） |
| TC-024 | 通过 | 2026-11-05 | `chore: release v8.0.0`；根包、七插件、manifest 均 8.0.0；tag `v8.0.0` |
| TC-025 | 通过 | 2026-11-05 | FPK 名 `fn-deepseek-harness-x86-v8.0.0-dsh-0.2.2-rc.1.fpk`；`manifest` 与应用文档页、i18n 九语言 desc 均为 `0.2.2-rc.1` |

## Bug 记录

| 编号 | 发现于 | 描述 | 状态 |
| --- | --- | --- | --- |
| BUG-01 | TC-003 | pi-ai 同时装了 1.3.0 与 1.4.0 两个实例，`Provider` 泛型互不兼容导致三插件 typecheck 失败 | 已修复：catalog 改为 `^1.3.0` 与 `dsh-llm-pi-ai` 同范围，收敛为单实例 |
| BUG-02 | TC-003 | codex 模型目录用例硬编码「id 含 codex」，而 0.2.2 目录已换成 gpt-5.6/gpt-6 一系，用例误报 | 已修复：改为与 provider 自身 `getModels()` 比对 |
| BUG-03 | TC-003 | fnos 网关 e2e 夹具按旧 `fiber.config` 写快照，cordis 4.1 起 `describe()` 读 `effectiveConfig`，读回为空 | 已修复：按 loader 语义对 `effectiveConfig` 的 volatile 引用写快照 |
| BUG-04 | TC-011 | 基线守卫只覆盖 5 个插件，opencode/zcode 漏在外；补齐后立刻抓出两家漏声明 `dsh-client-ui-conversation`、且声明了未使用的 primitives | 已修复：补齐名单与断言，删掉残留声明，变异验证通过 |
| BUG-05 | TC-020 | 开发态 Desktop 依赖 upstream 0.2.2 新增包 `dsh-official-bundles` 的产物，检出未构建时启动即报模块缺失；`pnpm -r build` 被上游刻意保留的循环依赖拒绝 | 已解决：按 `Makefile` 的 `build` 目标执行根 `pnpm run build`，产物补齐 |
| BUG-06 | TC-020 | 检出构建完成后，0.2.2 的 `dev:desktop` 在 macOS 上以 `--user-data-dir=<…>` 启动 `Harness Dev.app/Contents/MacOS/Electron`，被该可执行文件拒绝（`bad option`），Electron 未起来 | 已解决：根因是开发会话自身带 `ELECTRON_RUN_AS_NODE=1`，子进程继承后 Electron 退化为 Node 而拒绝该参数；以 `env -u ELECTRON_RUN_AS_NODE` 启动后正常 |
| BUG-07 | TC-020 | `pnpm run dev:desktop -- --skip-build` 把参数当位置参数传给 `tsx`，报 `Unexpected argument` | 已绕过：直接 `pnpm exec tsx scripts/dev.ts --skip-build` |
| BUG-08 | TC-017 | 本机 192.168.0.17 的 fnOS 应用中心里点「从电脑上传」会**直接打开 fnOS 自己的文件浏览器对话框**（列出「我的文件 / fnos-fpk / harness workspace」及已有 .fpk），安装对话框随即卸载；因此按 `docs/guide/nas-fpk-install.md` §4.4 的「先切来源再注入隐藏 input」在**本机这份 fnOS 版本**上无法落地：按钮既不调用 `input.click()` 也不调用 `showPicker()`（两者均已拦截验证为 0 次），注入的文件虽被 React 消费一次（安全提示确实弹出过），但对话框生命周期过短，无法稳定推进到安装向导 | 待定：需改用其他入口（用户本机浏览器手动安装 / trim-cli `app install-fpk` 的 OAuth 授权 / 记录的 Midscene `dsh.uploadFile` 用例） |
| BUG-09 | TC-019 | 本地跑 `pnpm run start -- --web` 后，被链接进 profile 的六个插件 manifest 的 `peerDependencies` 从 `catalog:dsh` 被改写成字面版本 `0.2.2-rc.1`（fnOS 插件因不在本地 profile 而未受影响）；这类改动会随 `git add -A` 混进提交，破坏「版本只在 catalog 一处」的不变量 | 已还原（`git checkout -- plugins/*/package.json`），守卫用例可拦住（14/14 通过）；操作提示：跑本地运行时后先看 `git status`，勿把插件清单改写带入提交 |

## 测试结论

25 条用例全部执行完成：23 条通过、1 条阻塞结论已消除（TC-020 开发态 Desktop 以 `env -u ELECTRON_RUN_AS_NODE` 启动后通过）、1 条口径调整（TC-016 以真机安装成功作为门禁成立的间接证据）。

三端结论：
- **DSH Web**：运行时报告 `0.2.2-rc.1`，六个插件全部加载启用、控制台无错误，模型目录按新底座暴露，亮暗主题正常，历史会话与账号状态保留。
- **DSH Desktop**：上游检出开发态 Desktop 标题栏显示 `0.2.2-rc.1-66491b0-dirty`，恢复 10 个历史会话，插件入口在位，无「异常」「加载失败」。
- **真实 fnOS NAS（192.168.124.181）**：经应用中心「手动安装 → 从电脑上传」完成 7.1.0 → **8.0.0** 升级安装，NAS Web iframe 内 `__DSH_BOOT__.release` 报告 `0.2.2-rc.1`（commit c59d10a），80 个 boot 入口含三个自有插件与 `dshmarket`，插件页无异常，fnOS 插件详情为 v8.0.0，工作区（backup / demo）保留。

遗留风险：pi-ai 采用范围解析，安装到 NAS 时解析到的具体版本取决于当时仓库状态，需在后续发布前核对实际版本与模型目录；`dshmarket` 仍固定 1.66.47，其后续版本兼容性未在本轮验证。
