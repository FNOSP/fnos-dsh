# 开发环境

本页说明开发这台机器需要准备什么。工具版本以仓库配置为准，不要凭记忆填写。

## 版本要求

项目根目录是 pnpm workspace，版本约束由配置文件声明：

| 工具 | 当前要求 | 配置来源 |
| --- | --- | --- |
| Node.js | 24，最低 `>=24.0.0` | `.nvmrc`、根 `package.json#engines` |
| pnpm | `>=11.16.0`，项目固定 `11.16.0` | 根 `package.json#packageManager`、CI |
| [fnpack](https://developer.fnnas.com/docs/cli/fnpack/) | 本地 `1.2.3`；CI 构建工作流当前使用 `1.2.1` | 本机 `PATH`、`.github/workflows/build-*.yml` |
| [dsh](https://github.com/deepseek-ai/deepseek-harness) | 与插件兼容声明和锁定版本一致（当前 `0.1.5-rc.2`） | 根 `package.json`、`pnpm-lock.yaml` |

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

除本机环境外，部分工作依赖外部条件：

| 项目 | 用途 |
| --- | --- |
| [`fnnas-docs` Skill](https://github.com/tnnevol/skills/tree/main/skills/fnnas-docs) | 查询 Manifest、生命周期、权限、资源和向导的平台约束 |
| [fnOS 应用开放平台](https://developer.fnnas.com/) | 平台规则、开放 API 和 fnpack 参考 |
| fnOS 测试设备 | 验证安装、升级、启动、停止、权限和卸载 |
| `appcenter-cli` | 在 fnOS 设备上安装和检查应用 |

普通开发机只负责构建，应用的**真实行为必须在 fnOS 设备上验证**。

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
