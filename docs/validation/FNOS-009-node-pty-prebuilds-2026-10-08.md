# FNOS-009-13 node-pty 免编译安装与跨平台构建（真机验收）

- 执行日期：2026-10-08
- 目标环境：飞牛 fnOS，`192.168.124.181:5666`，`x86_64`
- 应用版本：`fn-deepseek-harness` 5.5.0，DSH `0.2.0-rc.2`
- 安装位置：**存储空间 1**（`/vol1/@appcenter/fn-deepseek-harness`）
- 关联需求：[FNOS-009-13](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-13)
- 关联计划：[PLAN-FNOS-009 阶段八](/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation#阶段八node-pty-免编译安装与跨平台构建t08-01t08-03)

## 验收目标

证明 node-pty 在**没有 C++ 编译器**的 fnOS 设备上可以正常安装并创建真实 PTY：
安装流程只校验上游 npm 包自带的 `prebuilds/linux-x64/pty.node`，不编译、不复制、不内置。

## 环境前置条件

设备上不存在任何可用的 C/C++ 工具链：

| 工具 | 结果 |
| --- | --- |
| `g++` | 不存在 |
| `gcc` | 不存在 |
| `cc` | 不存在 |
| `clang` | 不存在 |
| `node-gyp` | 不存在 |
| `make` | 存在（未参与 node-pty） |
| `python3` | 存在（未参与 node-pty） |

Node.js：`/vol2/@appcenter/nodejs_v24/bin/node`（v24.15.0）。

## 证据 1：安装流程不触发编译

安装日志 `/var/log/apps/fn-deepseek-harness.log`：

```text
[10:57:05] [install_callback] [INFO] Preparing node-pty from the published platform prebuilds.
[10:57:06] [install-node-pty] [INFO] Found 1 node-pty package(s) in the installed dsh dependency tree.
[10:57:06] [install-node-pty] [INFO] Temporarily disabling lifecycle scripts for 1 node-pty package(s); other DSH dependency scripts remain enabled.
[10:57:06] [install-node-pty] [INFO] Running DSH dependency lifecycle scripts with the node-pty native build left to the published prebuilds.
[10:57:06] [install-node-pty] [INFO] START: npm rebuild --global --foreground-scripts
[10:57:07] [install-node-pty] [INFO] DONE: npm rebuild --global --foreground-scripts (1s)
[10:57:07] [install-node-pty] [INFO] DSH dependency lifecycle scripts completed.
[10:57:08] [install-node-pty] [INFO] node-pty prebuilds available at /vol1/@apphome/fn-deepseek-harness/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/node-pty/prebuilds/linux-x64.
[10:57:08] [install-node-pty] [INFO] node-pty preparation completed; the published prebuilds are used without a compiler.
```

判定：`npm rebuild` 全程 **1 秒**完成，未出现 `node-gyp`、`g++` 或编译输出；预编译目录被固定解析为
`prebuilds/linux-x64`（不做运行时平台判断）。

## 证据 2：依赖树中不存在编译产物

```text
$ ls -la .../node-pty/prebuilds/linux-x64/pty.node
-rw-r--r-- 1 fn-deepseek-harness fn-deepseek-harness 75976 Oct  8 10:56 pty.node

$ md5sum .../node-pty/prebuilds/linux-x64/pty.node
8e40ccec95b862cd6fadab18e401492a

$ ls -d .../node-pty/build    # 本地编译才会产生
（不存在）
```

`build/Release` 与 `build/Debug` 都不存在，说明 node-pty 的加载器只能回退到 `prebuilds/linux-x64`。
该文件 md5 与 npm 包内发布的产物一致，即**原样使用上游二进制**。

## 证据 3：真实 PTY 可用（侧边栏终端）

通过 DSH Web 界面的「新建终端」入口打开侧边栏终端，在真实键盘输入下执行：

```text
fn-deepseek-harness@mi-nas:~$ echo PTY_REAL_OK
PTY_REAL_OK
fn-deepseek-harness@mi-nas:~$ tty; echo "arch=$(uname -m) user=$(id -un) term=$TERM"
/dev/pts/2
arch=x86_64 user=fn-deepseek-harness term=xterm-256color
```

判定：终端分配真实伪终端设备 `/dev/pts/2`，用户与架构正确，`TERM` 生效。
Shell 为 `bash`（非 `nologin`），入口打开即可用。

## 证据 4：脱离 UI 的独立加载验证

在设备上以 dsh 自带 Node 直接加载依赖树内的 node-pty：

```text
LOAD_DIR = ../prebuilds/linux-x64
exports: native, spawn, fork, createTerminal, open

# 真实创建 PTY 并执行命令
$ node -e "pty.spawn('/bin/bash', ['-lc','echo PTY_OK; tty; uname -m'], ...)"
--- PTY 输出 ---
PTY_OK
/dev/pts/2
x86_64
exitCode = 0
```

判定：不依赖 DSH 进程，node-pty 自身即可加载并创建 PTY；这是对「加载器回退到预编译」的直接证据。

## 结论

**通过。** FNOS-009-13 的核心目标在真实无编译器设备上得到验证：

1. 安装不依赖 `g++`，`npm rebuild` 1 秒完成且无编译输出。
2. node-pty 使用上游 npm 包自带的 `prebuilds/linux-x64/pty.node`（md5 与包内一致），
   依赖树内不存在本地编译产物。
3. 侧边栏终端可打开并执行命令，`tty` 返回真实 `/dev/pts/2`。
4. FPK 于 macOS 构建、安装到 x86_64 fnOS，跨平台构建链路成立。

## 遗留与说明

- 本次验收同时确认了 FNOS-009-12（release-age 放行）在真机生效：每次插件安装均打印
  `with the minimum release age disabled` 并出现 `✓ Lockfile passes supply-chain policies`。
- 三方插件 `dshmarket` 已由 `1.66.3` 更新为 `1.66.11`，本次安装通过，不再被兼容门禁拒绝
  （见 FNOS-009-14）。
- 本记录未覆盖 FNOS-009 其余功能项（OAuth 回流、NAS 文件引用浏览器走查等）。
