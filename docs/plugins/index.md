# Harness 插件

本仓库维护的 DeepSeek Harness 插件与共享 UI 包。功能说明以文档站为准，插件目录里的 README 只保留 npm 包所需的简短介绍。

三类内容的性质不同，注意区分：

| 类别 | 是否进 DSH profile | 用途 |
| --- | --- | --- |
| 运行时插件 | 是 | 提供模型供应商、fnOS 系统集成等实际能力 |
| 共享 UI 包 | 否 | 被插件依赖的组件层，随插件构建进入产物 |
| 展示插件 | 是（可选） | 仅用于检查组件与主题状态 |

## 运行时插件

| 包名 | 版本 | 适用场景 | 文档 | 源码 |
| --- | --- | --- | --- | --- |
| `@tnnevol/dsh-codex-auth` | `0.1.5-rc.2` | 使用 ChatGPT 账号登录 Codex，并把模型、用量和图片输入能力接入 DSH | [Codex 身份验证](/plugins/dsh-codex-auth) | [GitHub](https://github.com/FNOSP/fnos-dsh/tree/main/plugins/dsh-codex-auth-plugin) |
| `@tnnevol/dsh-codebuddy` | `0.1.5-rc.2.3` | 使用腾讯 CodeBuddy 多账号登录，接入模型目录、额度和 Token 统计 | [CodeBuddy](/plugins/dsh-codebuddy) | [GitHub](https://github.com/FNOSP/fnos-dsh/tree/main/plugins/dsh-codebuddy-plugin) |
| `@tnnevol/dsh-fnos` | `0.1.5-rc.2` | 在 fnOS 中补充主题、授权目录、NAS 文件访问和会话日志导出 | [fnOS](/plugins/dsh-fnos) | [GitHub](https://github.com/FNOSP/fnos-dsh/tree/main/plugins/dsh-fnos-plugin) |

DSH 运行时和插件兼容性基线为 `0.1.5-rc.2`；运行时插件的发布版本与该基线同号，CodeBuddy 因独立修复再递增一位（`0.1.5-rc.2.3`）。手动安装请使用精确版本，不使用 `latest`、`next` 或范围版本。

`dsh-fnos` 是 [DeepSeek Harness 应用适配](/apps/adaptation)的核心部分，负责 DSH 与 fnOS 之间的系统集成。

## 共享 UI

[`@tnnevol/dsh-semi-ui`](/plugins/dsh-semi-ui) 统一封装插件使用的 Semi Design 组件，并将亮色、深色、交互色和浮层样式映射到 DSH 主题变量。它**不是**需要单独安装到 Web profile 的运行时插件，而是被插件依赖的包。

查看组件效果有两种方式：

- [组件预览](/plugins/semi-ui)：文档站内静态预览，无需安装。
- [`@tnnevol/dsh-semi-ui-showcase`](/plugins/dsh-semi-ui-showcase)：运行时展示插件，可在 DSH 中检查真实交互与主题状态。

## 在 fnOS 应用中安装

`fn-deepseek-harness` 安装或升级时，会按照 [`published-dsh-plugins.json`](https://github.com/FNOSP/fnos-dsh/blob/main/apps/fn-deepseek-harness/app/published-dsh-plugins.json) 将已发布插件安装到 Web profile。应用启动阶段只检查插件是否可解析，不会临时从工作空间源码构建插件。

在其他 DSH 环境中可以手动安装：

```sh
dsh plugin --profile web add @tnnevol/dsh-fnos@0.1.5-rc.2
dsh plugin --profile web add dshmarket@1.46.1
dsh --profile web --dump-config
```

安装完成后重启 Web profile。不要直接编辑 `profiles/web/package.json` 添加 bundle；使用 `dsh plugin` 命令可以同时维护依赖和 profile 配置。

## 兼容要求

- DSH：`0.1.5-rc.2`
- Node.js：`^22.19.0` 或 `>=24.0.0`
- fnOS 专用能力：需要在 fnOS 应用 iframe 中运行
- 问题反馈：[GitHub Issues](https://github.com/FNOSP/fnos-dsh/issues)
