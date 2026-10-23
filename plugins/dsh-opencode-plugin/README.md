# @tnnevol/dsh-opencode

DSH 的 OpenCode Console 账号登录、OpenCode Go 模型目录与套餐用量插件。

## 安装

插件发布在 npm，要求 DSH `0.2.1-rc.2`。安装命令：

```sh
dsh plugin --profile web add @tnnevol/dsh-opencode@0.2.1-rc.2.19
```

装完重启 Web profile 即可。

## 功能

- 浏览器设备码登录 OpenCode Console 账号，也可用 Console 服务账号 API Key 登录
- 用 Auth token 读取**用户工作空间启用的 OpenCode Go 模型**，并全部接入 DSH 模型选择器
- 逐模型适配协议族、上下文窗口、最大输出、图片输入与思考等级
- 插件详情页集中管理账号、套餐额度、模型目录与刷新策略
- 对话输入区右侧常驻套餐用量胶囊（5 小时 / 每周 / 每月）

更完整的说明见线上文档：<https://fndsh-doc.tnnevol.cn/plugins/dsh-opencode>
