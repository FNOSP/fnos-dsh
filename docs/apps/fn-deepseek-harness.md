<AppIcon name="fn-deepseek-harness" alt="DeepSeek Harness 图标" />

# DeepSeek Harness 应用

在飞牛 fnOS 上以应用形式运行 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，通过 NAS Web 的统一网关打开 dsh Web UI，不需要对外开放端口。

## 应用介绍

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（简称 DSH）是 DeepSeek AI 开源的插件化智能代理工具，提供可扩展的会话、工具调用与插件体系。它本身是通用工具，不感知 fnOS。

本应用把 DSH 打包为 fnOS Native 应用，并补齐它在 NAS 环境中缺失的部分：

- **统一网关访问**：通过 fnOS 应用入口以 iframe 打开 dsh Web UI，Web 服务只监听本机回环地址，不单独暴露端口。
- **开箱可用**：安装时自动准备 Node.js 运行时、DSH CLI、pnpm 及所需插件；版本已满足时直接复用，无需手工配置环境。
- **fnOS 系统集成**：适配 fnOS 主题切换，接入 NAS 目录授权与文件访问，支持会话日志导出和文件应用打开。
- **数据留在 NAS**：会话、配置与工作区保存在应用数据目录；升级保留用户数据，卸载可自行选择是否清空。

为跑通这些能力所做的适配（网关转发、插件挂载、主题与权限对接等）集中在[应用适配说明](./adaptation)中。

| 项目 | 值 |
| --- | --- |
| 应用版本 | `5.4.3` |
| 目标平台 | x86 |
| 运行依赖 | `nodejs_v24` |
| DSH 基线 | `0.1.5-rc.2` |
| 入口形态 | iframe / `/app/fn-deepseek-harness` |
| 分发 | [GitHub Releases](https://github.com/FNOSP/fnos-dsh/releases) |

## 安装

从 [GitHub Releases](https://github.com/FNOSP/fnos-dsh/releases) 下载 `.fpk` 文件，在 fnOS 应用中心选择手动安装，按向导完成配置即可。

开发调试时也可以在 fnOS 设备上进入应用目录执行：

```bash
appcenter-cli install-local
```

安装向导会提示监听地址、监听端口、可信访问地址和可选 npm 镜像源。下面按向导中的两项分别说明。

## 运行设置

![运行设置向导：监听地址、监听端口与可信访问地址](/images/apps/fn-deepseek-harness/runtime-settings.jpg)

应用运行后，可在 fnOS 应用中心对该应用打开**运行设置**，修改后保存会按新配置重启。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| 监听地址 | `127.0.0.1` | DSH 暂不支持 `0.0.0.0`，保持默认即可，由 fnOS 网关转发 |
| 监听端口 | `3080` | DSH Web 的监听端口；iframe 入口要求固定端口，不能填 `0` |
| 可信访问地址 | — | 填浏览器打开 NAS Web 时地址栏里的 host 或 host:port，多个用英文逗号分隔 |

可信访问地址的作用是让 DSH 接受来自该来源的请求。例如通过 `192.168.119.6:5666` 访问 NAS Web，就填 `192.168.119.6:5666`；不确定端口时只填 host。**不要填 `3080`**，那是 DSH 自身的监听端口，不是 NAS Web 的地址。

## 安装选项

安装向导中还有一项可选配置：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| npm 镜像源 | 留空（官方源） | 网络受限时选择可用镜像，安装失败不会自动切换，需重新选择后重试 |

选择的源会持久化到 `${DSH_HOME}/.npmrc`，由 npm、pnpm 和 DSH CLI 统一读取。

## 内置插件

FPK 安装和升级时会按发布清单以精确版本准备插件：

| 插件 | 版本 | 提供能力 |
| --- | --- | --- |
| [`@tnnevol/dsh-fnos`](/plugins/dsh-fnos) | `0.1.5-rc.2` | fnOS 主题、授权目录、NAS 文件访问、会话日志导出 |
| [`@tnnevol/dsh-codex-auth`](/plugins/dsh-codex-auth) | `0.1.5-rc.2` | ChatGPT 账号登录 Codex、模型目录、用量与图片输入 |
| [`@tnnevol/dsh-codebuddy`](/plugins/dsh-codebuddy) | `0.1.5-rc.2.3` | CodeBuddy 账号、用量面板与成长任务 |
| `dshmarket` | `1.46.1` | 三方插件市场；不进入 FPK，安装阶段由 DSH CLI 单独安装，已安装时不会覆盖用户版本 |

Codex 插件必须随 FPK 内置：registry 上可用版本在 DSH `0.1.5-rc.2` 上会因 `@deepseek-ai/dsh-settings` 不再导出 `settingsNamespace` 而导致 DSH Web 启动失败。升级老用户时不会卸载或覆盖已有的凭据、模型配置和 profile bundle。

插件功能与兼容版本的细节维护在[插件总览](/plugins/)中，本页不重复记录插件内部实现。

## 数据与卸载

应用使用 `${DSH_HOME}` 保存 dsh 相关数据，并通过 fnOS 的共享目录声明管理。卸载时可以选择保留数据，或卸载 `@deepseek-ai/dsh` 并清空应用数据目录。

## 相关链接

- [应用适配说明](./adaptation)
- [上游项目](https://github.com/deepseek-ai/deepseek-harness)
- [应用源码](https://github.com/FNOSP/fnos-dsh/tree/main/apps/fn-deepseek-harness)
- [问题排查](/troubleshooting)
