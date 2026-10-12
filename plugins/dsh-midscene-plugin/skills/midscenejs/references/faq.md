# 常见问题与排错

## 元素定位出现偏移（最高频）

按顺序排查：

### 1. 升级到最新版本

```bash
npm install @midscene/web@latest     # Web 自动化
npm install @midscene/ios@latest     # iOS
npm install @midscene/cli@latest     # CLI
# 或其他对应平台的包
```

### 2. 使用更好的视觉模型

定位能力依赖模型的视觉理解能力。新版本、参数大的模型通常更好（如 Qwen3-VL > Qwen2.5-VL，plus > flash）。

### 3. 检查 `MIDSCENE_MODEL_FAMILY`

配置错误会影响 Midscene 对模型的适配逻辑——**这是最容易被忽略的一项**。见 [model-config.md](model-config.md)。

### 4. 优化提示词：结合视觉特征和位置

定位结果随机落在不相关元素、每次执行差异大，通常说明模型**无法理解图标按钮背后的语义**。

```typescript
// ❌ 仅功能性描述
await agent.aiTap('个人中心');

// ✅ 视觉性描述
await agent.aiTap('人形头像 icon');

// ✅ 视觉特征 + 位置
await agent.aiTap('页面右上角的人形头像图标');
```

### 5. 开启 `deepLocate`

定位落在目标元素**附近但有几像素偏移**——说明模型大概率已识别对目标，只是定位有偏差：

```typescript
await agent.aiTap('登录按钮', { deepLocate: true });
```

### 6. Web 端把 dpr 提到 2

CI 环境默认 dpr 往往是 `1`，提到 `2` 后页面更清晰，小元素定位效果更好。⚠️ 会消耗更多 token。

### 7. 截图尺寸（GPT 场景）

OpenAI 观察到 `1440x900` 和 `1600x900` 效果较好。用 Agent 的 `screenshotShrinkFactor` 控制压缩倍率，浏览器自动化还可用 `viewport` 指定尺寸。

## Azure OpenAI 点击坐标偏移

用 Azure OpenAI 的 **Chat Completions** API 时，`"detail": "original"` 可能未被正确处理，造成点击坐标偏移。**解法：切换到 Responses API**（设 `MIDSCENE_MODEL_PROTOCOL="openai-responses"`）。

## `aiAct` 规划了错误的滚动/滑动方向

原因是自然语言方向描述有歧义。以"向下滚动"为例，可能表示：

- **鼠标滚轮向下滚动**：按 Windows 常见设置，页面内容**向上**移动
- **手指向下滑动**：页面内容**跟随手指向下**移动
- **期望看到页面下方内容**：需结合设备操作方式确定方向

## Chrome 扩展报 `Cannot access a chrome-extension:// URL of different extension`

通常由其他扩展与 Midscene 冲突引起（其他扩展注入了 `<iframe />` 或 `<script />`）：

1. 打开 DevTools，找 URL 以 `chrome-extension://` 开头的 `<iframe />` 或 `<script />`，复制扩展 ID。
2. 打开 `chrome://extensions/`，按 ID 禁用对应扩展。
3. 刷新页面重试。

## Ollama 模型报 403

设置 `OLLAMA_ORIGINS="*"`，允许 Chrome 扩展访问 Ollama。

## 操作 VNC 等桌面客户端时丢失大写字母或修饰键

远程桌面客户端（如 VNC）常通过 X11 键盘映射传递按键，修饰键和大写字母容易丢失。官方 FAQ 给出了 `MIDSCENE_...` 相关的键盘输入间隔类配置来缓解；详见官方 FAQ「操作 VNC 等桌面客户端」章节。

发送组合键时应按客户端要求的方式构造，而非直接按本地键位。

## Windows 上点击对某些程序不生效

**UIPI 权限级别隔离**：未提权进程无法向管理员权限窗口发送输入，会**静默丢弃**——光标移动到正确位置，但点击和按键不生效。

解法：

1. 优先让目标程序**不要**以管理员权限运行。
2. 若必须提权，就让**启动 Midscene 的终端或 Node.js 也以管理员身份运行**，使两个进程处于相同权限级别。

## WebDriverAgent 已连接但仍无法控制设备

排查 `WDA_HOST`/`WDA_PORT` 是否正确、真机是否做了**端口转发**（模拟器不需要）、WebDriverAgent 会话是否有效。

## iOS 输入后键盘未隐藏或页面返回

- `autoDismissKeyboard` 默认 `true`，会尽力触发标准工具栏的隐藏控件；部分键盘（如数字键盘）无隐藏控件，此时**不判为失败**只记警告。
- App 自定义输入工具栏可能含 Save/Submit 等业务操作，对非标准结构的工具栏 Midscene 会**主动拒绝点击**。此时关闭自动隐藏并显式指定控件：

```typescript
const device = new IOSDevice({ autoDismissKeyboard: false });
await device.hideKeyboard(['Close Keyboard']);
```

## 配置 `midscene_run` 目录

运行产物（报告、日志、缓存）默认保存在当前工作目录的 `midscene_run` 下。可用环境变量 `MIDSCENE_RUN_DIR` 改位置（支持相对/绝对路径）：

```bash
export MIDSCENE_RUN_DIR="./my_custom_dir"
export MIDSCENE_RUN_DIR="/tmp/midscene_output"
```

子目录：`report/`（HTML 报告）、`log/`（调试日志）、`cache/`（缓存）。

## 提升运行效率

1. 用即时操作接口替代 `aiAct`：`agent.aiTap('Login Button')` 优于 `agent.aiAct('Click Login Button')`
2. 尽量用较低分辨率，降低输入 token 成本
3. 换更快的模型服务
4. 使用缓存加速调试（Midscene 缓存 AI Planning 和 DOM 定位信息；DOM 定位缓存目前仅 Web 且有限制）

## 报告播放器参数

在报告链接后加查询参数：

| 参数 | 作用 |
| --- | --- |
| `focusOnCursor` | 是否聚焦鼠标位置（`true`/`false`/`1`/`0`） |
| `showElementMarkers` | 是否显示元素标记 |
| `player-only=1` | 隐藏外围界面（顶栏、侧边栏、时间线、详情面板），只保留回放播放器，便于嵌入 `iframe` |

## 会发送哪些信息到 AI 模型

页面数据（**包括截图**）会**直接发送给你选择的 AI 模型提供商**。Midscene 是 MIT 开源项目，代码公开，但**没有任何第三方平台能访问这些数据**——你只需关心模型提供商的数据隐私政策。

## 模型服务商需要自定义 header

两种方式：

- `MIDSCENE_MODEL_INIT_CONFIG_JSON` 配置 SDK 客户端，用 `defaultHeaders`（`extra_headers`/`extraHeaders` 为兼容别名）
- 每条命令/每次请求携带特定 header 时，配合代理配置

见 [model-config.md](model-config.md)。
