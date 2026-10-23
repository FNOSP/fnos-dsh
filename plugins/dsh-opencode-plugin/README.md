# @tnnevol/dsh-opencode

DSH 的 OpenCode Console 账号登录、OpenCode Go 模型目录与套餐用量插件。

## 安装

插件发布在 npm，要求 DSH `0.2.1-rc.2`。安装命令：

```sh
dsh plugin --profile web add @tnnevol/dsh-opencode@0.2.1-rc.2.21
```

装完重启 Web profile 即可。

## 功能

- 浏览器设备码登录 OpenCode Console 账号，也可用 Console 服务账号 API Key 登录
- 登录后模型选择器出现两组供应商：**OpenCode**（Zen 按量，约 85 个模型）与 **OpenCode Go**（套餐，约 36 个模型）
- 逐模型适配协议族、上下文窗口、最大输出、图片输入与思考等级；图片生成模型不纳入
- 插件详情页集中管理账号、套餐额度、模型目录（分组筛选、能力图标、隐藏开关）与刷新策略
- 对话输入区右侧显示 Go 套餐用量胶囊（5 小时 / 每周 / 每月）

## 已知限制

- Zen 按量模型需要 Console 余额；免费模型上游只允许在 OpenCode 客户端内使用，在 DSH 中调用会返回 403。
- Go 套餐额度只对 OpenCode Go 组的模型有意义，按量模型不显示套餐额度。
- 路由 id 为 `dsh-opencode` / `dsh-opencode-go`，不会覆盖你手工配置的 `opencode` / `opencode-go` 路由。

## 图标

插件图标取自 OpenCode 官方站点 `https://opencode.ai/web-app-manifest-512x512.png`，
只用于标识本插件接入的 OpenCode 服务。

更完整的说明见线上文档：<https://fndsh-doc.tnnevol.cn/plugins/dsh-opencode>
