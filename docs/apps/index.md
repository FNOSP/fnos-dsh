# 应用目录

本项目按应用目录维护 fnOS 应用的打包配置。项目/FPK 版本由根目录 `version` 任务和 `bumpp` 维护，插件版本独立处理，具体运行依赖以各应用的 `manifest` 为准。

| 图标 | 应用 | <span style="white-space: nowrap">应用目录</span> | 类型 / 平台 | 运行依赖 | 项目源码 |
| --- | --- | --- | --- | --- | --- |
| <AppIcon name="fn-deepseek-harness" alt="DeepSeek Harness 图标" :size="30" /> | [DeepSeek Harness](./fn-deepseek-harness) | [GitHub](https://github.com/tnnevol/fn-os-apps/tree/main/apps/fn-deepseek-harness) | Native / x86 | nodejs_v24 | [源码](https://github.com/deepseek-ai/deepseek-harness) |

## 安装方式

应用可以从 [GitHub Releases](https://github.com/tnnevol/fn-os-apps/releases) 下载 `.fpk` 文件后，在 fnOS 应用中心手动安装；开发调试时可使用 `appcenter-cli install-local`。涉及应用专属配置时，以对应应用页面为准。

## 下载

应用安装包可在 [GitHub Releases](https://github.com/tnnevol/fn-os-apps/releases) 页面下载。
