# 开发环境

本页说明开发这台机器需要准备什么。工具版本以仓库配置为准，不要凭记忆填写。

## 版本要求

项目根目录是 pnpm workspace，版本约束由配置文件声明：

| 工具 | 当前要求 | 配置来源 |
| --- | --- | --- |
| Node.js | 24，最低 `>=24.0.0` | `.nvmrc`、根 `package.json#engines` |
| pnpm | `>=11.16.0`，项目固定 `11.16.0` | 根 `package.json#packageManager`、CI |
| [fnpack](https://developer.fnnas.com/docs/cli/fnpack/) | 本地 `1.2.3`；CI 构建工作流当前使用 `1.2.1` | 开发机 `PATH`、`.github/workflows/build-*.yml` |
| [dsh](https://github.com/deepseek-ai/deepseek-harness) | 与插件兼容声明和锁定版本一致（当前 `0.1.7-rc.2`） | 根 `package.json`、`pnpm-lock.yaml` |

## 初始化

```bash
nvm use
pnpm install
node --version
pnpm --version
```

`pnpm install` 会同时安装 Lefthook 的 Git hooks。需要手动重新安装时执行：

```bash
pnpm exec lefthook install
```

## 设备与工具

除开发机环境外，部分工作依赖外部条件：

| 项目 | 用途 |
| --- | --- |
| [`fnnas-docs` Skill](https://github.com/tnnevol/skills/tree/main/skills/fnnas-docs) | 查询 Manifest、生命周期、权限、资源和向导的平台约束 |
| [fnOS 应用开放平台](https://developer.fnnas.com/) | 平台规则、开放 API 和 fnpack 参考 |
| fnOS 测试设备 | 验证安装、升级、启动、停止、权限和卸载 |
| `appcenter-cli` | 在 fnOS 设备上安装和检查应用 |

普通开发机只负责构建，应用的**真实行为必须在 fnOS 设备上验证**。

## DSH Desktop 联调

DSH Desktop 的开发与联调**一律使用上游源码检出的开发态应用**（`fork-pj/deepseek-harness`），
**不使用系统安装的 `/Applications/DeepSeek Harness.app`**：发行版壳无法替换成待测插件版本，
而开发态启动器天然暴露渲染进程调试端口，取证可以脚本化。验收口径见
[测试用例文档规范](../charter/tests-spec.md#dsh-desktop-测试)。

```bash
# 检出位置由环境变量指定，不写进受版本管理的文件
export DSH_DESKTOP_APP_DIR="<工作区根>/fork-pj/deepseek-harness"

# 启动前必须置空：宿主/父进程注入该变量会让 Electron 以 Node 模式启动
unset ELECTRON_RUN_AS_NODE

DSH_HOME="$PWD/.dsh" DSH_DESKTOP_RENDERER_DEBUG_PORT=9333 \
  pnpm --dir "$DSH_DESKTOP_APP_DIR" run dev:desktop
```

三个容易误判成「插件坏了」的环境事实：

| 现象 | 实际原因与处置 |
| --- | --- |
| 启动即退出，报 `Electron: bad option: --remote-debugging-port=…` | `ELECTRON_RUN_AS_NODE` 被注入，Electron 退化成 Node。启动前置空该变量 |
| 构建报 `EPERM`（`.dsh-build` 写入被拒） | 检出在沙箱工作区之外，请在放行的会话里运行，而不是判定构建或插件缺陷 |
| 插件页显示「不兼容 / 异常」 | 该 profile 把仓库插件以 `link:` 指向源码，源码 `peerDependencies` 是 pnpm 工作区协议（`catalog:dsh`），独立 profile 解析不出语义化版本。改用实体副本并把 `catalog:dsh` 规范化为运行时基线版本；**不要**为此改源码的 peer 声明 |

开发态 Desktop 与发行版是**相互独立**的进程：测试结束只需退出开发态实例，不要为「交还 profile」去启动或重启发行版。
另外，结束进程只能按检出路径精确匹配（如 `pkill -f "fork-pj/deepseek-harness"`）——用 `dsh-desktop` 这类宽模式会
误杀使用者日常运行的发行版（其子进程命令行含 `@deepseek-ai/dsh-desktop`）。

## 调整版本要求时

改动 Node.js、pnpm、fnpack 或 dsh 版本时，同时检查这几处并保持同步：

- `.nvmrc`
- 根 `package.json` 的 `engines`、`packageManager`、catalog
- 相关工作流
- 本页的版本表

CI 的 fnpack 版本目前与本地版本**不一致**，不要在未同步工作流的情况下自行假定两者相同。

## 相关页面

- [命令与脚本](./commands-and-scripts)
- [仓库结构](../guide/repository-structure)
- [Package 任务与 Turbo](./turbo-tasks)
