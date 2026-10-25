# @tnnevol/dsh-failover-search

DSH 会话内网页搜索的多来源插件：按 **TinyFish → Tavily → 官方搜索** 顺序自动故障转移，支持同平台多账号分摊与插件详情页用量展示。官方搜索只作为链尾兜底。

面向用户的安装、配置与常见问题见文档站页面：[Failover Search](https://fnapps-doc.tnnevol.cn/plugins/dsh-failover-search)。本文件只保留 npm 包所需的简短介绍。

## 安装

插件随 `fn-deepseek-harness` 自动安装。其他 DSH 环境手动安装，要求 DSH `0.2.0-rc.2`：

```sh
dsh plugin --profile web add @tnnevol/dsh-failover-search@0.2.1-rc.2.50
```

## 这个包做什么

- 在 `ctx.web` 接缝上注册一个**复合搜索提供方**（id `dsh-failover-search`），组合包 patch 把 `searchProvider` 指到它。
- 平台顺序内遍历；同平台多账号按轮转分摊，账号失败或额度不足时先换同平台账号，再落到下一平台。
- 用量快照（Tavily 账户用量、TinyFish 钱包，均为免费查询）驱动请求前探测，并在插件详情页展示。
- 三方全不可用时沿用用户既有的官方凭据回落官方搜索。
- 网页抓取（`web_fetch`）同样接管：本地 HTTP 抓取为第一跳，本地失败且平台有账号时按 TinyFish Fetch → Tavily Extract 转取（平台侧取回，不受本机 DNS/代理影响）。

## 注意：官方「网络搜索」设置页会覆盖本插件

本插件通过 `web` 行的 `searchProvider` / `fetchProvider` 接管搜索与抓取，而接缝是**固定选择**语义：配了哪个 provider id 就只用那个，其它 provider 即使注册成功也不会被走到。

官方「设置 → 插件 → 内置插件设置 → 网络搜索」页保存时会把这两个键写成官方 id，于是插件虽然已加载、账号与用量都正常，网页工具却走官方端点（官方余额耗尽时直接返回 HTTP 402）。因此：

- **安装本插件前**先关掉官方的搜索/抓取通道，安装后不要再去那页保存；
- 已经被覆盖时，把消息框左下角的「智能搜索」开关**关闭再打开**即可写回本插件，无需重装；
- 也可以手改 profile 的 `cordis.patch.yml` 中 `- id: web` 的两个键（整行替换，必须一起写）后重启。

## 兼容性

- DSH：`0.2.0-rc.2`
- Node.js：`^22.19.0` 或 `>=24.0.0`
