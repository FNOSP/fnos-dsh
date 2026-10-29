# @tnnevol/dsh-opencode

DSH 的 OpenCode Console 账号登录、OpenCode 模型目录与套餐用量插件。

## 安装

插件发布在 npm，要求 DSH `0.2.1-rc.2`。安装命令：

```sh
dsh plugin --profile web add @tnnevol/dsh-opencode@6.1.7
```

装完重启 Web profile 即可。

## 功能

- 浏览器设备码登录 OpenCode Console 账号，也可用 Console 服务账号 API Key 登录
- 登录后模型选择器出现一个 **OpenCode** 供应商：模型名带 `· zen`（按量）或 `· go`（套餐）后缀，2026-10-24 合计 122 个（zen 85 / go 37）
- 逐模型适配协议族、上下文窗口、最大输出、图片输入与思考等级；图片生成模型不纳入
- 插件详情页集中管理账号、套餐额度、模型目录（搜索、能力图标、隐藏开关）与刷新策略
- 对话输入区右侧显示 Go 套餐用量胶囊（5 小时 / 每周 / 每月）

## 已知限制

- `· zen` 模型需要 Console 余额；免费模型上游只允许在 OpenCode 客户端内使用，在 DSH 中调用会返回 403。
- Go 套餐额度只对 `· go` 模型有意义，`· zen` 模型不显示套餐额度。
- 路由 id 为 `dsh-opencode`，不会覆盖你手工配置的 `opencode` 路由。
- 部分模型受地区限制（如 `gpt-6-luna`、`muse-spark-*`、`beam-free`），上游返回 403；Gemini 模型需要工作空间在 Console Privacy 设置中允许「会用于训练的付费端点」。


## 图标

插件图标取自 OpenCode 官方站点 `https://opencode.ai/web-app-manifest-512x512.png`，
只用于标识本插件接入的 OpenCode 服务。

更完整的说明见线上文档：<https://fndsh-doc.tnnevol.cn/plugins/dsh-opencode>
