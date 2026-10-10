# @tnnevol/dsh-failover-search

DSH 会话内网页搜索的多来源插件：按 **TinyFish → Tavily → 官方搜索** 顺序自动故障转移，支持同平台多账号分摊与插件详情页用量展示。官方搜索只作为链尾兜底。

面向用户的安装、配置与常见问题见文档站页面：[Failover Search](https://fnapps-doc.tnnevol.cn/plugins/dsh-failover-search)。本文件只保留 npm 包所需的简短介绍。

## 安装

插件随 `fn-deepseek-harness` 自动安装。其他 DSH 环境手动安装，要求 DSH `0.2.0-rc.2`：

```sh
dsh plugin --profile web add @tnnevol/dsh-failover-search@0.2.0-rc.2.1
```

## 这个包做什么

- 在 `ctx.web` 接缝上注册一个**复合搜索提供方**（id `dsh-failover-search`），组合包 patch 把 `searchProvider` 指到它。
- 平台顺序内遍历；同平台多账号按轮转分摊，账号失败或额度不足时先换同平台账号，再落到下一平台。
- 用量快照（Tavily 账户用量、TinyFish 钱包，均为免费查询）驱动请求前探测，并在插件详情页展示。
- 三方全不可用时沿用用户既有的官方凭据回落官方搜索。

网页抓取（fetch）不在本包范围内，仍由官方抓取提供方承担。

## 兼容性

- DSH：`0.2.0-rc.2`
- Node.js：`^22.19.0` 或 `>=24.0.0`
