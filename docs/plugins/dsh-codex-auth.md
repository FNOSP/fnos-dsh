# Codex 身份验证

`@tnnevol/dsh-codex-auth` 为 DSH 提供 ChatGPT/Codex 登录、模型目录和账号用量。当前版本见[插件总览](/plugins/)，适配 DSH `0.1.7-rc.2`。

## 安装

`fn-deepseek-harness` 会在安装和升级时自动安装 npm `rc` 标签对应的版本。其他 DSH 环境可以执行：

```sh
dsh plugin --profile web add @tnnevol/dsh-codex-auth@0.1.7-rc.2
dsh --profile web --dump-config
```

安装后重启 Web profile。旧版 `dsh-codex-connect` 不应与本插件同时启用，否则可能重复注册 Codex 模型和设置插槽。

## 登录与用量

打开侧栏「插件」→ 已安装分组 → `Codex Auth` 组合包详情页，点击「登录」。插件会生成一次性授权码并打开 Codex 授权页面，不需要选择工作空间。

自 DSH `0.1.7-rc.2` 起，插件配置统一挂在插件管理页的组合包详情页；设置弹框不再提供 Codex Auth 导航分区，配置数据的读写路径与位置没有变化。

授权码右端有一个复制图标，点它即把授权码写入剪贴板，成功后就地显示勾选标记。

插件**不做主动复制**。早期版本在打开授权页时自动复制，但浏览器会把焦点和用户手势交给新窗口，此时写入剪贴板必然失败——用户侧表现就是每次都提示「复制失败」。所以复制只由用户点击触发，那时主页面仍有焦点，HTTP 页面下同样可用。若浏览器仍阻止复制，页面会提示手动选中。

等待授权期间，按钮变成「取消」；点它会放弃本次登录并退回未登录状态，同时把还开着的授权窗口一并关掉（重复点「打开授权页面」开出的多个窗口也会全部关闭）。取消**不会**删除已经登录的账号，只有「退出登录」才清除凭据。

### 在 DSH Desktop 中运行

Desktop 是 Electron 壳，加载的是同一套 Web 界面，并把页面请求转发给同一个 Host；因此登录、账号状态、用量、模型目录同步与「全局模型」在 Desktop 中的行为与 Web 端一致。

区别只在授权页的打开方式：Desktop 把 `window.open` 交给系统浏览器（`shell.openExternal`），授权页照常在系统默认浏览器中打开，但返回值是 `null`。这个 `null` 只表示**没有窗口句柄**，不代表窗口没打开——插件因此不依据它判定失败，登录会继续请求设备码。相应地，Desktop 下「取消时一并关掉授权窗口」不适用（没有可操作的外部浏览器窗口），但取消本身、以及「已登录账号不被删除」的行为完全一致。

取一次性授权码的等待上限是两分钟。这个上限只管「向 OpenAI 要授权码」这一步，拿到码之后就不再计时——用户在浏览器里完成授权的时间由 Codex 自己的设备码有效期兜底（约 15 分钟）。

关掉授权窗口**不算**取消。Codex 授权成功后那个窗口会由页面自己关闭，把它当成放弃信号会让插件中止正在进行的轮询，刚拿到的凭据随之丢失。

登录成功后，账号用量不再在设置页展示；对话输入区右侧的紧凑用量状态保留，优先显示五小时窗口，没有五小时窗口时显示每周窗口。点击该状态可展开查看剩余额度与重置时间。

![用量弹层：五小时与每周使用限额](/images/plugins/dsh-codex-auth/usage.jpg)

这个图标只在**当前选中模型属于 Codex 供应商**时出现。选中 CodeBuddy 或其它供应商的模型时它不显示，也不会在后台继续轮询用量；切换模型即时跟随，不需要刷新页面。CodeBuddy 插件在同一个位置也放了一个用量图标，两个按各自供应商显隐，因此同一轮对话里不会出现两个图标并存。

![Codex Auth 设置页](/images/plugins/dsh-codex-auth/settings.jpg)

## 全局模型

「全局模型」用于设置 DSH 会话默认使用的 Codex 模型和思考强度。选择器中的模型来自当前 Codex 模型目录；未配置时显示「请选择模型」。保存后，新建会话会采用这组默认值，仍可在对话输入区临时切换模型。

## 模型目录同步

登录成功后，Codex Auth 会自动读取当前 ChatGPT 账号**实际可用**的 Codex 模型与思考强度，并同步到 DSH 的 OpenAI Codex 模型配置。同步成功后，消息框的「可用模型」弹框与全局模型选择器都会重新读取同一份最新目录。内部服务型条目（如自动审查、预留位）不会写入，思考级别只保留 DSH 支持的范围。

模型设置页中的「获取可用模型」弹框也使用这份 DSH 动态目录，不再单独显示 pi-ai 内置的旧 Codex 静态目录。

- 打开已登录的 Codex Auth 页面时也会自动同步一次。
- 同步失败（网络异常、接口不可用、写入被拒绝）会保留上一次有效的模型列表，并在页面显示错误提示。
- 账号接口与内置静态目录不一致时（例如上游发布了新模型而 DSH 内置表尚未更新），以账号返回的目录为准。
- 内置的默认模型条目自带完整能力（图文输入、上下文窗口、每个模型各自的思考等级），因此未登录或账号同步失败时，「恢复默认模型」回到的也是模型的真实能力，而不是只剩 `id` 和名称的空壳条目。
- 同步会把账号返回的最大上下文窗口写入 DSH 模型目录；如果账号接口未提供最大值，才回退使用默认上下文窗口。这样可以避免 Codex 后端实际接受更长上下文时，被 pi-ai 按较小默认窗口误判为溢出。
- 「获取可用模型」弹框中的每个候选项都自带能力（图文输入、上下文窗口、最大输出、思考等级），因此勾选添加的模型会保留这些能力，不会变成只有名称的空壳条目。
- 如果历史版本已经保存过一份缺少能力字段的模型列表，插件启动时会自动补齐缺失的字段：只填空缺，不会覆盖你手动设置的值，也不会增删模型、改变顺序或名称。

## 上下文管理

上下文压缩和溢出恢复由 DSH 官方的 `dsh-compaction-basic` 与 `dsh-llm-pi-ai` 负责，插件只负责从 ChatGPT Codex 账号目录提供准确的模型上下文窗口：

1. DSH 会在上下文接近模型窗口时自动压缩历史消息，并保留必要的最近内容。
2. 供应商报告上下文溢出时，DSH 会执行强制压缩并重试当前请求。
3. Codex Auth 自动同步模型目录时优先写入 `max_context_window`，避免 pi-ai 使用过小的 `contextWindow` 把成功的长上下文响应误判为 `CONTEXT_WINDOW_EXCEEDED`。

如果升级插件前已经出现 `pi-ai detected context overflow for model`，升级后请重新登录 Codex Auth 或重新打开已登录的 Codex Auth 页面，触发自动同步，让修正后的窗口值写入当前 Web profile；必要时刷新 Web 页面后再继续原会话。

## 图片能力

图片能力默认关闭，可在 Codex Auth 页面中分别启用：

| 配置 | 作用 |
| --- | --- |
| 图片识别 | 注册 `view_image` 工具，让支持图片输入的 Codex 模型读取本地 PNG、JPEG、WebP 或 GIF |
| 图片上传 | 允许支持图片输入的 Codex 模型接收粘贴或上传到对话的图片 |

当前版本（DSH `0.1.7-rc.2`）不提供图像生成或图像输出，仅支持图片识别和图片上传。模型本身未声明图片输入能力时，即使打开开关也不能处理图片。

## 凭据与请求

OAuth 凭据保存在 `$DSH_HOME/.openai-codex-auth.json`，文件权限为 `0600`。插件会把有效访问令牌同步到 DSH 的通用凭据接口，退出登录时同时清理同步结果。

Web 设置通过同源插件路由访问 Host。使用 `fn-deepseek-harness` 时应从应用入口打开页面，不要绕过应用网关直接访问 DSH 监听端口。

## 排查

### 看不到 Codex Auth 设置页

确认组合配置包含插件：

```sh
dsh --profile web --dump-config | grep -n -C 3 'dsh-codex-auth'
```

如果出现 `cannot resolve profile bundle`，请重新执行 `dsh plugin --profile web add @tnnevol/dsh-codex-auth@0.1.7-rc.2`，不要只在 `package.json` 中手动补 bundle。插件安装后，侧栏「插件」的已安装分组会出现 `Codex Auth` 组合包，其配置位于该组合包的详情页。

### 登录后模型目录没有变化

- 确认页面显示「已登录」，并等待自动同步完成。
- 同步成功后，DSH 会通过设置变更事件刷新消息框模型选择器和全局模型选择器；若弹框已经打开，请关闭后重新打开。
- 若显示错误提示，说明上游接口或配置写入暂时失败，当前仍保留上一次有效模型列表。

## 本地开发

在仓库根目录执行检查：

```sh
pnpm --filter @tnnevol/dsh-codex-auth run check
```

将源码包安装到本地 Web profile 后启动 DSH：

```sh
dsh plugin --profile web add /absolute/path/to/fn-os-apps/plugins/dsh-codex-auth-plugin
dsh web --no-open
```

## 链接

- [npm](https://www.npmjs.com/package/@tnnevol/dsh-codex-auth)
- [源码](https://github.com/FNOSP/fnos-dsh/tree/main/plugins/dsh-codex-auth-plugin)
- [问题反馈](https://github.com/FNOSP/fnos-dsh/issues)
